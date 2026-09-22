#!/usr/bin/env bash
# ============================================================================
# Precis PyPI 管理控制台启动器（macOS / Linux）
#
# 用途: 启动 pypi-gui（precis-cli 在 PyPI 上的版本对齐/发布历史/job 状态/
#       下载统计/线上包验证 的本地 Web 控制台），浏览器自动打开
#       http://127.0.0.1:17889，Ctrl+C 退出。
# 用法: bash scripts/mac/pypi-gui.sh [--port 17889] [--no-open]
# ============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${PROJECT_ROOT}"

echo "[INFO] Precis PyPI 管理控制台启动中... 浏览器将自动打开（默认 http://127.0.0.1:17889）"
echo "[INFO] Ctrl+C 退出"
exec node scripts/release/pypi-gui.mjs "$@"
