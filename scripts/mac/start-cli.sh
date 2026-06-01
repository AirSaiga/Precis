#!/usr/bin/env bash
# ============================================
# Precis CLI 启动脚本 (Mac/Linux)
# 用法:
#   ./scripts/mac/start-cli.sh                     # 进入交互式 CLI
#   ./scripts/mac/start-cli.sh [command] [args...] # 执行单条命令后退出
# ============================================

set -uo pipefail

# 处理软链接：从软链接定位到真实脚本目录
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -L "${SCRIPT_SOURCE}" ]; do
    DIR="$(cd -P "$(dirname "${SCRIPT_SOURCE}")" && pwd)"
    SCRIPT_SOURCE="$(readlink "${SCRIPT_SOURCE}")"
    [[ "${SCRIPT_SOURCE}" != /* ]] && SCRIPT_SOURCE="${DIR}/${SCRIPT_SOURCE}"
done
SCRIPT_DIR="$(cd -P "$(dirname "${SCRIPT_SOURCE}")" && pwd)"

# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

resolve_python || prompt_exit 1

cd "${BACKEND_DIR}"
"${PYTHON_CMD}" -B app/cli_main.py "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    error "CLI exited with code ${EXIT_CODE}"
    prompt_exit $EXIT_CODE
fi
exit 0
