#!/usr/bin/env bash
# ============================================
# Precis - 单独启动前端 (Mac/Linux)
# Vite 开发服务器，端口 5173
# 等同于 Windows 的 start-frontend.bat
# 用法:
#   ./scripts/mac/start-frontend.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis - Frontend (Dev)"
require_node || prompt_exit 1

if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    error "frontend/node_modules 缺失。请先运行: scripts/setup.sh 或 npm run install:all"
    prompt_exit 1
fi
echo ""

cd "${FRONTEND_DIR}"
npm run dev

echo ""
info "Frontend stopped."
prompt_exit $?
