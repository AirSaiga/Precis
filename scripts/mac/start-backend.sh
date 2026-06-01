#!/usr/bin/env bash
# ============================================
# Precis - 单独启动后端 (Mac/Linux)
# FastAPI + Uvicorn 热重载，端口 18000
# 等同于 Windows 的 start-backend.bat
# 用法:
#   ./scripts/mac/start-backend.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis - Backend (Dev)"
resolve_python || prompt_exit 1
echo ""

cd "${BACKEND_DIR}"
"${PYTHON_CMD}" -m uvicorn app.api.main:app --reload --port 18000

echo ""
info "Backend stopped."
prompt_exit $?
