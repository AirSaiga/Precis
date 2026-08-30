#!/usr/bin/env bash
# ============================================================================
# Precis 发布控制台启动器（macOS / Linux）
#
# 用途: 启动 release-gui（打包/发布/更新演练/线上状态 的本地 Web 控制台），
#       浏览器自动打开 http://127.0.0.1:17888，Ctrl+C 退出。
# 用法: bash scripts/mac/release-gui.sh [--port 17888] [--no-open]
# ============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${PROJECT_ROOT}"

echo "[INFO] Precis 发布控制台启动中... 浏览器将自动打开（默认 http://127.0.0.1:17888）"
echo "[INFO] Ctrl+C 退出"
exec node scripts/release-gui.mjs "$@"
