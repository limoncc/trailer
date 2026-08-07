#!/usr/bin/env bash
# 手动发布 trailer SDK wheel 到 PyPI
#
# GitHub Actions 只编译并上传 sdk-* artifact(不自动发布), 本脚本负责:
#   1. (可选) 自动用 gh 下载 sdk-* artifacts
#   2. twine 发布到 PyPI
#
# 用法(自动下载 + 发布):
#   ./deploy/publish_pypi.sh [--run=<run-id>] [--test]
#     - 自动下载最新 release run(或 --run 指定)的 sdk-* artifacts
#   ./deploy/publish_pypi.sh [wheel目录] [--test]
#     - 使用本地已有的 wheel 目录(跳过下载)
#
# 示例:
#   ./deploy/publish_pypi.sh --test                       # 下载最新并发布到 Test PyPI
#   ./deploy/publish_pypi.sh --run=31164931561            # 下载指定 run 并发布
#   ./deploy/publish_pypi.sh dist/wheels                  # 用本地已有 wheel
#
# 前置: 已安装 gh 且 gh auth login(自动下载需要); 已设置 PyPI token:
#   export TWINE_PASSWORD=xxx    # 或 PYPI_TOKEN=xxx
#   (PyPI → Account settings → API tokens → 创建, scope 选 trailer-sdk)

set -euo pipefail

WHEEL_DIR="dist/wheels"
TEST_FLAG=""
RUN_ID=""

# ── 解析参数 ──
for arg in "$@"; do
  case "$arg" in
    --test) TEST_FLAG="--test" ;;
    --run=*) RUN_ID="${arg#*=}" ;;
    -*) echo "❌ 未知参数: $arg"; echo "用法: $0 [--run=<id>] [--test] | [wheel目录] [--test]"; exit 1 ;;
    *) WHEEL_DIR="$arg" ;;   # 第一个非选项参数 = wheel 目录
  esac
done

# ── 自动下载(目录不存在/空, 或指定了 --run) ──
needs_download=false
if [ -n "$RUN_ID" ]; then
  needs_download=true
elif [ ! -d "$WHEEL_DIR" ] || [ -z "$(find "$WHEEL_DIR" -name '*.whl' 2>/dev/null | head -1)" ]; then
  needs_download=true
fi

if [ "$needs_download" = true ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "❌ 需要 gh CLI 自动下载 artifacts, 请先安装并执行 gh auth login"
    exit 1
  fi
  if [ -z "$RUN_ID" ]; then
    RUN_ID=$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
  fi
  echo "📦 从 run $RUN_ID 下载 sdk-* artifacts ..."
  mkdir -p "$WHEEL_DIR"
  gh run download "$RUN_ID" --pattern 'sdk-*' -D "$WHEEL_DIR"
  # gh run download 按 artifact 名建子目录, 把 .whl 移到统一目录
  find "$WHEEL_DIR" -name '*.whl' -exec mv -f {} "$WHEEL_DIR" \;
  # 清理空的子目录
  find "$WHEEL_DIR" -type d -mindepth 1 -empty -delete 2>/dev/null || true
fi

# ── 校验本地 wheel ──
shopt -s nullglob
WHEELS=("$WHEEL_DIR"/*.whl)
if [ ${#WHEELS[@]} -eq 0 ]; then
  echo "❌ 未找到 .whl 文件: $WHEEL_DIR"
  echo "   - 自动下载失败? 检查 run 是否完成、gh 是否认证"
  echo "   - 或手动下载 sdk-* artifacts 解压到该目录后重试"
  exit 1
fi

# ── 检查 twine(缺失则安装) ──
if ! command -v twine >/dev/null 2>&1; then
  echo "📦 未安装 twine, 正在安装..."
  pip install twine
fi

# ── 凭据: __token__ + API token ──
if [ -z "${TWINE_PASSWORD:-}" ]; then
  if [ -n "${PYPI_TOKEN:-}" ]; then
    export TWINE_PASSWORD="$PYPI_TOKEN"
  else
    echo "❌ 请设置 TWINE_PASSWORD(或 PYPI_TOKEN) 为 PyPI API token"
    echo "   PyPI → Account settings → API tokens → 创建(scope 选 trailer-sdk)"
    exit 1
  fi
fi
export TWINE_USERNAME="__token__"

REPO_ARGS=()
if [ "$TEST_FLAG" = "--test" ]; then
  REPO_ARGS+=(--repository testpypi)
  echo "🟡 目标: Test PyPI"
else
  echo "🟢 目标: 正式 PyPI"
fi

echo "📦 待发布 wheel:"
printf '   %s\n' "${WHEELS[@]}"
echo

# ── 校验(metadata / 可安装性) ──
echo "🔍 twine check ..."
twine check "${WHEELS[@]}"

echo "🚀 上传中 ..."
# ${arr[@]+"${arr[@]}"} 保护: 空数组在 macOS bash 3.2 + set -u 下会报 unbound variable
twine upload ${REPO_ARGS[@]+"${REPO_ARGS[@]}"} "${WHEELS[@]}"
echo "✅ 发布完成"
