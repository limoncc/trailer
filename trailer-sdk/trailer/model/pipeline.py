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


def _trace(model, input_shape):
    """Run one traced forward; return (edges, io_map, mode).

    默认走 FakeTensorMode 符号追踪:Python 控制流执行但张量全为 fake——零真实
    计算、零权重需求(meta 模型可用),io 的 shape/dtype 真实,模块外残差算子
    照常被 TorchDispatchMode 捕获。fake 失败(数据依赖控制流、不支持的算子)
    时回退真实 randn/long forward,mode 相应为 "fake" / "hooks"。
    """
    import torch
    from torch._subclasses.fake_tensor import FakeTensorMode

    try:
        dtype = next(model.parameters()).dtype
    except StopIteration:
        dtype = torch.float32
    try:
        device = next(model.parameters()).device
    except StopIteration:
        device = torch.device("cpu")

    try:
        with FakeTensorMode(allow_non_fake_inputs=True):
            # 先 float(Linear 打头)后 Long(Embedding 打头),两种输入都在 fake
            # 模式内试完才回退真实 forward
            for make in (
                lambda: torch.randn(*input_shape, dtype=dtype, device=device),
                lambda: torch.zeros(*input_shape, dtype=torch.long, device=device),
            ):
                try:
                    edges, io_map = trace_edges(model, make())
                    return edges, io_map, "fake"
                except Exception:
                    continue
    except Exception:
        pass

    last: Optional[Exception] = None
    for make in (
        lambda: torch.randn(*input_shape, dtype=dtype),
        lambda: torch.zeros(*input_shape, dtype=torch.long),
    ):
        try:
            edges, io_map = trace_edges(model, make())
            return edges, io_map, "hooks"
        except RuntimeError as exc:
            last = exc
    raise RuntimeError(
        f"could not synthesize a trace input for shape {input_shape}: {last}"
    )


def build_model_graph(
    model,
    name: str = "model",
    input_shape=(1, 128),
    trace: bool = False,
    merge_repeats: bool = True,
    input_spec: Optional[str] = None,
    output_spec: Optional[str] = None,
    extra_meta: Optional[dict[str, Any]] = None,
) -> dict:
    """Build the viewer graph JSON for an nn.Module.

    trace=True 跑一次符号追踪(FakeTensor,零真实计算):返回边为 traced 数据流
    边 + 静态路由边的并集,重映射到 repeat 折叠后的树。
    """
    if trace:
        edges, io_map, mode = _trace(model, input_shape)
        graph = extract_graph(
            model, name=name, merge_repeats=merge_repeats,
            edges=edges, input_spec=input_spec or f"{input_shape}",
        )
        graph["edges"] = remap_edges(graph["tree"], graph["edges"])
        attach_io(graph["tree"], io_map)
        graph["meta"]["trace_mode"] = mode
    else:
        graph = extract_graph(
            model, name=name, merge_repeats=merge_repeats,
            input_spec=input_spec or f"tensor {input_shape}",
        )
    if output_spec:
        graph["meta"]["output_spec"] = output_spec
    if extra_meta:
        graph["meta"].update(extra_meta)
    return graph
