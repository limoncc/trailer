"""Graph assembly pipeline shared by tracker.log_model.

Keeps static/traced assembly in one tested place: extract -> (trace)
remap edges onto the repeat-merged tree -> attach real I/O shapes.

The traced path remaps the COMBINED edge list (hook edges + the routing
edges injected by extract_graph/enrich_moe_routing). Remapping only the raw
hook edges would silently drop every routing edge and orphan the synthetic
combine node.
"""
from __future__ import annotations

from typing import Any, Optional

from .extract import extract_graph
from .hooks import attach_io, trace_edges
from .remap import remap_edges


def build_model_graph(
    model,
    name: str = "model",
    input_shape=(1, 128),
    trace: bool = False,
    merge_repeats: bool = True,
    output_spec: Optional[str] = None,
    extra_meta: Optional[dict[str, Any]] = None,
) -> dict:
    """Build the viewer graph JSON for an nn.Module.

    trace=True runs one forward pass with hook tracing; the returned edge
    list is the union of traced tensor edges and the static routing edges,
    remapped onto the repeat-merged tree.
    """
    if trace:
        import torch

        x = torch.randn(*input_shape)
        edges, io_map = trace_edges(model, x)
        graph = extract_graph(
            model, name=name, merge_repeats=merge_repeats,
            edges=edges, input_spec=f"{input_shape}",
        )
        graph["edges"] = remap_edges(graph["tree"], graph["edges"])
        attach_io(graph["tree"], io_map)
        graph["meta"]["trace_mode"] = "hooks"
    else:
        graph = extract_graph(
            model, name=name, merge_repeats=merge_repeats,
            input_spec=f"tensor {input_shape}",
        )
    if output_spec:
        graph["meta"]["output_spec"] = output_spec
    if extra_meta:
        graph["meta"].update(extra_meta)
    return graph
