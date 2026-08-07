"""Trailer Query SDK — programmatic DataFrame-based API for notebooks.

Usage:
    from trailer.query import Query
    q = Query()
    df = q.runs(project="demo")
    df = q.metrics(run_id="run_xxx")
"""

import json
import os
import urllib.parse
from typing import Any, Optional


class Query:
    """Notebook-friendly query interface. Returns pandas DataFrames when available."""

    def __init__(self, host: Optional[str] = None):
        self._host = (host or os.environ.get("TRAILER_HOST", "http://127.0.0.1:5120")).rstrip("/")

    def _get(self, path: str) -> list[dict[str, Any]]:
        import urllib.request
        resp = urllib.request.urlopen(f"{self._host}{path}", timeout=30)
        return json.loads(resp.read())

    def _maybe_df(self, data: list[dict[str, Any]]) -> Any:
        try:
            import pandas as pd
            return pd.DataFrame(data)
        except ImportError:
            return data

    def runs(
        self,
        project: Optional[str] = None,
        expr: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Any:
        params = f"limit={limit}&offset={offset}"
        if project:
            params += f"&project={urllib.parse.quote(project)}"
        if expr:
            params += f"&expr={urllib.parse.quote(expr)}"
        return self._maybe_df(self._get(f"/api/v1/runs?{params}"))

    def metrics(
        self,
        run_id: str,
        key: Optional[str] = None,
        context: Optional[str] = None,
        max_points: int = 1000,
    ) -> Any:
        params = f"run_id={urllib.parse.quote(run_id)}&max_points={max_points}"
        if key:
            params += f"&key={urllib.parse.quote(key)}"
        if context:
            params += f"&context={urllib.parse.quote(context)}"

        data = self._get(f"/api/v1/metrics?{params}")
        rows = []
        for group in data:
            for pt in group.get("points", []):
                rows.append({
                    "step": pt.get("step"),
                    "value": pt.get("value"),
                    "key": group.get("key"),
                    "context": group.get("context"),
                })
        return self._maybe_df(rows)

    def texts(self, run_id: str, name: str = "default", limit: int = 100) -> Any:
        return self._maybe_df(self._get(
            f"/api/v1/runs/{urllib.parse.quote(run_id)}/texts?name={urllib.parse.quote(name)}&limit={limit}"
        ))

    def tables(self, run_id: str, name: Optional[str] = None) -> Any:
        path = f"/api/v1/runs/{urllib.parse.quote(run_id)}/tables"
        if name:
            path += f"?name={urllib.parse.quote(name)}"
        return self._maybe_df(self._get(path))
