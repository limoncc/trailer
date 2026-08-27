"""Trailer: Next-gen ML experiment tracking."""

__version__ = "0.1.1"

# The compiled Rust extension (cdylib) is importable as trailer.trailer
# after `maturin develop` or `pip install`
try:
    from . import trailer as _rust  # type: ignore
    from .tracker import Tracker
except ImportError:
    _rust = None  # Will be None until maturin builds the extension
    Tracker = None  # type: ignore
