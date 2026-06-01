#!/usr/bin/env bash
# ============================================
# Precis - 标准启动模式 (Mac/Linux)
# 类似 Windows 的 start.bat:
#   - 确保 frontend/dist 与 electron/dist 已构建
#   - 启动后端 + Electron（前端由 Electron 加载静态产物）
# 用法:
#   ./scripts/mac/start.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis (Standard Mode)"
require_node || prompt_exit 1
resolve_python || prompt_exit 1
echo ""

# 确保前端已构建
if [ ! -f "${FRONTEND_DIR}/dist/index.html" ]; then
    info "构建前端..."
    if ! ( cd "${FRONTEND_DIR}" && npm run build > /dev/null 2>&1 ); then
        error "前端构建失败"
        prompt_exit 1
    fi
    ok "前端构建完成"
fi

# 确保 Electron 已编译
if [ ! -f "${ELECTRON_DIR}/dist/main.js" ]; then
    info "编译 Electron TypeScript..."
    if ! ( cd "${ELECTRON_DIR}" && npm run build:electron > /dev/null 2>&1 ); then
        error "Electron 编译失败"
        prompt_exit 1
    fi
    ok "Electron 编译完成"
fi

echo ""
info "启动后端 + Electron..."
npx concurrently --kill-others \
    --names "BACKEND,ELECTRON" \
    --prefix-colors "cyan,magenta" \
    "cd backend && ${PYTHON_CMD} app/start_server.py" \
    "npx wait-on --delay 1500 --timeout 60000 http://127.0.0.1:18000/docs > /dev/null 2>&1 && cd electron && npx electron ."

exit $?
