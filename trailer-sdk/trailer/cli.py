"""Trailer CLI — `trailer up` starts the local tracking server, plus run management."""

import json
import os
import subprocess
import sys
import webbrowser
from pathlib import Path


HELP = """🔬 Trailer — experiment tracking

Usage:
  trailer <command> [options]

Commands:
  up                Start the tracking server + UI (http://127.0.0.1:5120)
  list              List runs from a running server
  delete <run_id>   Delete a run
  archive <run_id>  Archive a run
  copy <run_id>     Copy a run

`trailer up` options:
  --port PORT         Listen port (default 5120)
  --host HOST         Listen address (default 127.0.0.1)
  --db PATH           SQLite path or postgres:// URL (default trailer.db)
  --storage KIND      Storage backend: sqlite | file | pg (default auto)
  --data-dir DIR      File-storage data directory (default data)
  --no-open           Do not open browser

Environment:
  TRAILER_HOST        Server address for list/delete/archive/copy (default http://127.0.0.1:5120)
  TRAILER_TOKEN       API token for auth (default: auto-login as admin/admin on the local server)
  TRAILER_STORAGE     Storage backend: sqlite | file | pg
  TRAILER_DATA_DIR    File-storage data directory (default data)
  TRAILER_FRONTEND_DIR  Frontend static asset directory (default: auto-detect CWD/trailer-ui/build → package frontend/build)

Examples:
  trailer up                                  # SQLite mode
  trailer up --storage file --data-dir data   # File mode (TensorBoard-style)
  trailer up --port 9090                      # Custom port
  trailer list --project demo                 # List runs in a project
  trailer delete run_xxx                      # Delete a run
"""


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help'):
        print(HELP)
        sys.exit(0)

    cmd = sys.argv[1]
    if cmd == "up":
        cmd_up(sys.argv[2:])
    elif cmd == "list":
        cmd_list(sys.argv[2:])
    elif cmd == "delete":
        cmd_delete(sys.argv[2:])
    elif cmd == "archive":
        cmd_archive(sys.argv[2:])
    elif cmd == "copy":
        cmd_copy(sys.argv[2:])
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


def _api():
    host = os.environ.get("TRAILER_HOST", "http://127.0.0.1:5120")
    return host.rstrip("/")


def _token():
    """认证 token:优先 TRAILER_TOKEN;本地模式自动 admin 登录。"""
    tok = os.environ.get("TRAILER_TOKEN")
    if tok:
        return tok
    try:
        import urllib.request
        req = urllib.request.Request(
            f"{_api()}/api/v1/auth/login",
            data=json.dumps({"username": "admin", "password": "admin"}).encode(),
            headers={"content-type": "application/json"}, method="POST",
        )
        resp = json.loads(urllib.request.urlopen(req).read())
        return resp.get("token", "")
    except Exception:
        return ""


def _req(method, path, data=None):
    import urllib.request
    hdrs = {"content-type": "application/json"}
    tok = _token()
    if tok:
        hdrs["authorization"] = f"Bearer {tok}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(f"{_api()}{path}", data=body, headers=hdrs, method=method)
    raw = urllib.request.urlopen(req).read()
    if raw.strip():
        return json.loads(raw)
    return {}


def _resolve_frontend_dir(explicit: str | None = None) -> str | None:
    """自动定位前端静态资源目录（返回绝对路径），找不到返回 None。

    查找顺序：显式参数 > TRAILER_FRONTEND_DIR > CWD/trailer-ui/build > 包内 frontend/build。
    """
    cand = explicit or os.environ.get("TRAILER_FRONTEND_DIR")
    if cand and Path(cand).exists():
        return str(Path(cand).resolve())
    cwd = Path.cwd() / "trailer-ui" / "build"
    if cwd.exists():
        return str(cwd.resolve())
    pkg = Path(__file__).parent / "frontend" / "build"
    if pkg.exists():
        return str(pkg.resolve())
    return None


def cmd_up(args):
    import argparse
    parser = argparse.ArgumentParser(
        description="Start the Trailer tracking server + UI (default: SQLite at trailer.db). "
                    "Use --storage file for TensorBoard-style file mode.",
    )
    parser.add_argument("--port", type=int, default=5120, help="Listen port (default 5120)")
    parser.add_argument("--host", default="127.0.0.1", help="Listen address (default 127.0.0.1)")
    parser.add_argument("--db", default="trailer.db", help="Database: SQLite path or postgres:// URL (default trailer.db)")
    parser.add_argument("--storage", default=None, choices=["sqlite", "file", "pg"],
                        help="Storage backend: sqlite | file | pg (default: auto-detect by --db)")
    parser.add_argument("--data-dir", default="data", help="File-storage data directory (default data)")
    parser.add_argument("--frontend-dir", default=None,
                        help="Frontend static asset directory (default: auto-detect CWD/trailer-ui/build → package frontend/build)")
    parser.add_argument("--no-open", action="store_true", help="Do not open browser automatically")
    parsed, _ = parser.parse_known_args(args)

    # Use bundled Rust binary (compiled by build.py, shipped in the wheel)
    rust_bin = Path(__file__).parent / ("trailer-server.exe" if os.name == "nt" else "trailer-server")
    if rust_bin.exists():
        cmd = [str(rust_bin), "--port", str(parsed.port), "--host", parsed.host, "--database-url", parsed.db]
        if parsed.storage:
            cmd += ["--storage", parsed.storage]
        if parsed.storage == "file":
            cmd += ["--data-dir", parsed.data_dir]
        frontend_dir = _resolve_frontend_dir(parsed.frontend_dir)
        if frontend_dir:
            cmd += ["--frontend-dir", frontend_dir]
        else:
            print("⚠️ 未找到前端静态资源(trailer-ui/build)，UI 将空白。"
                  "请在 trailer 仓库根目录运行，或设置 TRAILER_FRONTEND_DIR 指定目录。")
        if not parsed.no_open:
            webbrowser.open(f"http://{parsed.host}:{parsed.port}")
        # Rust server 自行处理 SIGINT/SIGTERM 优雅关闭(main.rs shutdown_signal)。
        # Python 与子进程同在前台进程组,按 Ctrl+C 会收到同一 SIGINT;捕获
        # KeyboardInterrupt 避免打印 traceback,并等待子进程完成优雅关闭。
        proc = subprocess.Popen(cmd)
        try:
            proc.wait()
        except KeyboardInterrupt:
            try:
                proc.wait()
            except KeyboardInterrupt:
                # 第二次 Ctrl+C:强制退出
                proc.kill()
                proc.wait()
        return

    # Fallback (rare): Python HTTP server
    from trailer.server import run
    url = f"http://{parsed.host}:{parsed.port}"
    if not parsed.no_open:
        print(f"Opening {url} in your browser...")
        webbrowser.open(url)
    run(host=parsed.host, port=parsed.port, db_path=parsed.db)


def cmd_list(args):
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=None)
    parser.add_argument("--limit", type=int, default=20)
    parsed = parser.parse_args(args)

    params = f"?limit={parsed.limit}"
    if parsed.project:
        params += f"&project={parsed.project}"
    try:
        data = _req("GET", f"/api/v1/runs{params}")
    except Exception as e:
        print(f"Error: {e}. Is the server running?")
        sys.exit(1)

    if not data:
        print("No runs found.")
        return
    print(f"{'RUN ID':<20} {'NAME':<20} {'STATE':<12} {'PROJECT':<12} {'CREATED'}")
    print("-" * 80)
    for r in data:
        rid = r["run_id"][:18]
        name = (r.get("name") or rid)[:18]
        from datetime import datetime
        ts = datetime.fromtimestamp(r["created_at"]).strftime("%m/%d %H:%M") if r.get("created_at") else ""
        print(f"{rid:<20} {name:<20} {r['state']:<12} {r['project']:<12} {ts}")


def cmd_delete(args):
    if not args:
        print("Usage: trailer delete <run_id>")
        sys.exit(1)
    rid = args[0]
    try:
        _req("POST", f"/api/v1/runs/{rid}/delete")
        print(f"✅ Run {rid[:18]}... deleted")
    except Exception as e:
        print(f"Error: {e}")


def cmd_archive(args):
    if not args:
        print("Usage: trailer archive <run_id>")
        sys.exit(1)
    rid = args[0]
    try:
        _req("POST", f"/api/v1/runs/{rid}/archive")
        print(f"✅ Run {rid[:18]}... archived")
    except Exception as e:
        print(f"Error: {e}")


def cmd_copy(args):
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("run_id")
    parser.add_argument("--name", default=None)
    parsed, _ = parser.parse_known_args(args)

    body = {}
    if parsed.name:
        body["name"] = parsed.name
    try:
        data = _req("POST", f"/api/v1/runs/{parsed.run_id}/copy", body)
        print(f"✅ Copied to {data['run_id']}")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    main()
