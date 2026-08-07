"""Load HuggingFace transformers models on the meta device (zero memory,
no weight download/read, no forward pass) and extract their structure."""
from __future__ import annotations

import torch


def load_meta_model(path: str):
    """Build the model skeleton on the meta device from config only."""
    import transformers
    from transformers import AutoConfig

    cfg = AutoConfig.from_pretrained(path, trust_remote_code=True)
    archs = getattr(cfg, "architectures", None) or []
    model = None
    err = None
    for arch in archs:
        cls = getattr(transformers, arch, None)
        if cls is None:
            continue
        try:
            with torch.device("meta"):
                model = cls(cfg)
            break
        except Exception as e:  # noqa: BLE001
            err = e
    if model is None:
        from transformers import AutoModel
        try:
            with torch.device("meta"):
                model = AutoModel.from_config(cfg, trust_remote_code=True)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"cannot build model from config: {err or e}") from e
    return model, cfg


def hf_input_spec(cfg) -> str:
    text_cfg = getattr(cfg, "text_config", cfg)
    hidden = getattr(text_cfg, "hidden_size", "?")
    vocab = getattr(text_cfg, "vocab_size", "?")
    return f"input_ids (B, T) int64, vocab={vocab}, hidden={hidden}"


def hf_output_spec(cfg) -> str:
    text_cfg = getattr(cfg, "text_config", cfg)
    vocab = getattr(text_cfg, "vocab_size", "?")
    return f"logits (B, T, {vocab})"


def annotate_layer_badges(graph: dict, model, cfg) -> None:
    """Annotate transformer layer nodes with their layer type / variant.

    Many modern transformers (e.g. DeepSeek-V4) use heterogeneous layers:
    sliding attention, compressed sparse attention, heavily compressed attention,
    etc. The variant is stored in ``cfg.layer_types`` but is not visible on the
    module itself, so the viewer cannot tell the user why otherwise-similar
    decoder layers are not merged. This helper adds a ``variant`` field to each
    layer node that the viewer renders in the sub-label.
    """
    layer_types = getattr(cfg, "layer_types", None)
    if not layer_types:
        return

    def find_layers(n: dict):
        if n.get("name") == "layers" and n.get("kind") == "container":
            return n
        for c in n.get("children", []):
            r = find_layers(c)
            if r:
                return r
        return None

    layers_node = find_layers(graph["tree"])
    if not layers_node:
        return

    orig_layers = None
    try:
        orig_layers = list(model.model.layers)
    except Exception:
        pass

    def range_from_name(nm: str):
        if ".." in nm:
            a, b = nm.split("..")
            return range(int(a), int(b) + 1)
        return [int(nm)]

    for child in layers_node.get("children", []):
        names = child.get("repeat", {}).get("names", [child["name"]])
        idxs = []
        for nm in names:
            try:
                idxs.extend(range_from_name(nm))
            except Exception:
                continue
        if not idxs:
            continue

        types = {layer_types[i] for i in idxs if 0 <= i < len(layer_types)}
        variant = " · ".join(sorted(types)) if len(types) > 1 else types.pop()

        # Also note the router flavour when it is consistent across the group.
        routers = set()
        if orig_layers:
            for i in idxs:
                if i < 0 or i >= len(orig_layers):
                    continue
                try:
                    gcls = type(orig_layers[i].mlp.gate).__name__
                    gcls = gcls.replace("DeepseekV4", "").replace("Router", "")
                    if gcls:
                        routers.add(gcls)
                except Exception:
                    pass
        if routers:
            variant += " · " + ("/".join(sorted(routers)) if len(routers) > 1 else routers.pop())

        child["variant"] = variant
