#!/usr/bin/env bash
# ============================================
# Precis - 开发调试启动 (Mac/Linux)
# 同时启动 后端 + 前端 Vite + Electron，带完整日志输出
# 等同于 Windows 的 start-dev.bat
# 用法:
#   ./scripts/mac/start-dev.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis (Development)"
require_node || prompt_exit 1
resolve_python || prompt_exit 1
echo ""

info "Starting services..."
echo ""

# 编译 Electron 主进程 TypeScript:产物缺失或源码比上次编译新时重建
# ("产物存在即跳过"会在源码更新后静默运行旧主进程——与 2026-09 打包链旧产物问题同类)
ELECTRON_STAMP="${ELECTRON_DIR}/dist/main.js"
if [ ! -f "${ELECTRON_STAMP}" ] || [ -n "$(find "${ELECTRON_DIR}/src" "${ELECTRON_DIR}/package.json" "${ELECTRON_DIR}/tsconfig.json" -newer "${ELECTRON_STAMP}" -print -quit 2>/dev/null)" ]; then
    info "编译 Electron TypeScript(产物缺失或源码已更新)..."
    if ! ( cd "${ELECTRON_DIR}" && npm run build:electron ); then
        error "Electron 编译失败"
        # 删除半成品戳文件,避免下次被误判为"已是最新"
        rm -f "${ELECTRON_STAMP}"
        prompt_exit 1
    fi
else
    info "Electron 产物已是最新,跳过编译"
fi

npx concurrently --kill-others \
    --names "BACKEND,FRONTEND,ELECTRON" \
    --prefix-colors "cyan,green,magenta" \
    "cd backend && ${PYTHON_CMD} app/start_server.py --reload" \
    "cd frontend && npm run dev" \
    "npx wait-on --delay 1000 --timeout 60000 http://localhost:${FRONTEND_PORT} && cd electron && npm start"

EXIT_CODE=$?
echo ""
info "All services stopped."
prompt_exit $EXIT_CODE
