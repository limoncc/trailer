"""Build script: compiles trailer-server binary and includes it in the wheel."""
import subprocess
import sys
from pathlib import Path

# Windows 控制台默认 cp1252/gbk, 无法打印 emoji(🔧✅❌), 统一 UTF-8 输出避免 UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def build_server():
    """Build trailer-server with cargo and copy binary into the Python package."""
    project_root = Path(__file__).parent
    target_dir = project_root / "target" / "release"

    print("🔧 Building trailer-server...")
    result = subprocess.run(
        ["cargo", "build", "--release", "-p", "trailer-server"],
        cwd=project_root,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"❌ Failed to build trailer-server: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    # Windows 下 cargo 输出 trailer-server.exe
    binary_name = "trailer-server.exe" if sys.platform == "win32" else "trailer-server"
    src = target_dir / binary_name
    if not src.exists():
        print(f"❌ Built binary not found at {src}", file=sys.stderr)
        sys.exit(1)

    # Copy into the Python package so it ships with the wheel
    pkg_dir = project_root / "trailer-sdk" / "trailer"
    dst = pkg_dir / binary_name
    import shutil
    shutil.copy2(str(src), str(dst))
    dst.chmod(0o755)
    print(f"✅ trailer-server bundled at trailer-sdk/trailer/{binary_name}")

    # Bundle frontend build (if present) so `trailer up` serves the UI from any CWD.
    # cli.py auto-resolves this via `--frontend-dir` → package frontend/build.
    frontend_build = project_root / "trailer-ui" / "build"
    pkg_frontend = pkg_dir / "frontend" / "build"
    if frontend_build.exists():
        shutil.rmtree(pkg_frontend, ignore_errors=True)
        shutil.copytree(frontend_build, pkg_frontend)
        print(f"✅ frontend/build bundled at trailer-sdk/trailer/frontend/build")
    else:
        print("⚠️ frontend/build 不存在，跳过打包前端（UI 将不可用，请先 `cd trailer-ui && pnpm build`）")


if __name__ == "__main__":
    build_server()
