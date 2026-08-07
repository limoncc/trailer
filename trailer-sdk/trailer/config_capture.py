"""Configuration capture: aggregates hyperparams from
argparse, yaml configs (OmegaConf/Hydra), and explicit dicts.

Priority: explicit tracker config > yaml > argparse defaults.
"""

import sys
import types
from typing import Any, Dict, Optional


def capture_config(
    explicit: Optional[Dict[str, Any]] = None,
    *,
    capture_argparse: bool = True,
    capture_env: bool = True,
) -> Dict[str, Any]:
    """Capture the training config from all available sources.

    Returns a merged configuration dict.
    """
    config: Dict[str, Any] = {}

    # Layer 1: argparse (lowest priority)
    if capture_argparse:
        argparse_config = _capture_argparse()
        if argparse_config:
            config.update(argparse_config)

    # Layer 2: environment
    if capture_env:
        config["_env"] = {
            "python_version": sys.version,
            "platform": sys.platform,
        }

    # Layer 3: explicit (highest priority)
    if explicit:
        _deep_update(config, explicit)

    return config


def _capture_argparse() -> Dict[str, Any]:
    """Auto-detect argparse namespace without user specifying it.

    Walks the call stack looking for an argparse.Namespace
    and converts it to a flat dict.
    """
    try:
        import argparse

        frame = sys._getframe(2)  # caller's caller
        while frame:
            for val in frame.f_locals.values():
                if isinstance(val, argparse.Namespace):
                    result = {}
                    for k, v in vars(val).items():
                        if not k.startswith("_"):
                            result[k] = _safe_serialize(v)
                    return _flatten_dict(result)
            frame = frame.f_back
    except Exception:
        pass
    return {}


def _flatten_dict(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """Flatten nested dicts into dot-notation keys."""
    result = {}
    for k, v in d.items():
        full_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict) and not _is_special(v):
            result.update(_flatten_dict(v, full_key))
        else:
            result[full_key] = v
    return result


def _is_special(v: Any) -> bool:
    """Check if a value looks like a config object rather than a plain dict."""
    return hasattr(v, "__dataclass_fields__") or hasattr(v, "__dict__")


def _deep_update(base: Dict[str, Any], override: Dict[str, Any]) -> None:
    """Recursively merge override into base."""
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_update(base[k], v)
        else:
            base[k] = v


def _safe_serialize(v: Any) -> Any:
    """Convert a value to a JSON-safe type."""
    if isinstance(v, (int, float, str, bool, type(None))):
        return v
    if isinstance(v, (list, tuple)):
        return [_safe_serialize(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _safe_serialize(val) for k, val in v.items()}
    return str(v)
