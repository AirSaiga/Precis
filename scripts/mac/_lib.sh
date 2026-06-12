#!/usr/bin/env bash
# ============================================
# Precis 启动脚本公共函数库 (Mac/Linux)
# 由 scripts/mac/start-*.sh 通过 source 加载
# ============================================

# 颜色定义
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export NC='\033[0m'

# 日志输出
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()      { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }
banner()  { echo "============================================"; echo "      $1"; echo "============================================"; echo ""; }

# 解析项目根目录（由调用方设置 SCRIPT_DIR 后调用）
resolve_project_root() {
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
    BACKEND_DIR="${PROJECT_ROOT}/backend"
    FRONTEND_DIR="${PROJECT_ROOT}/frontend"
    ELECTRON_DIR="${PROJECT_ROOT}/electron"
    VENV_DIR="${BACKEND_DIR}/.venv"
    # 读取 .env 中的端口配置
    if [ -f "${PROJECT_ROOT}/.env" ]; then
        BACKEND_PORT=$(grep '^VITE_BACKEND_PORT=' "${PROJECT_ROOT}/.env" | cut -d'=' -f2 | tr -d ' \r')
        FRONTEND_PORT=$(grep '^VITE_FRONTEND_PORT=' "${PROJECT_ROOT}/.env" | cut -d'=' -f2 | tr -d ' \r')
    fi
    BACKEND_PORT="${BACKEND_PORT:-18000}"
    FRONTEND_PORT="${FRONTEND_PORT:-5173}"
    export PROJECT_ROOT BACKEND_DIR FRONTEND_DIR ELECTRON_DIR VENV_DIR BACKEND_PORT FRONTEND_PORT
}

# 选择 Python：优先 venv，其次 python3，再次 python
# 设置全局变量 PYTHON_CMD
resolve_python() {
    if [ -x "${VENV_DIR}/bin/python" ]; then
        PYTHON_CMD="${VENV_DIR}/bin/python"
        ok "Using venv Python: ${VENV_DIR}"
    elif command -v python3 &> /dev/null; then
        PYTHON_CMD="python3"
        warn "No venv found at ${VENV_DIR}, falling back to system python3."
    elif command -v python &> /dev/null; then
        PYTHON_CMD="python"
        warn "No venv found, falling back to system python."
    else
        error "Python not found. Please install Python 3.12+ or run scripts/setup.sh."
        return 1
    fi
    ok "$($PYTHON_CMD --version 2>&1)"
    export PYTHON_CMD
}

# 检查 Node.js
require_node() {
    if ! command -v node &> /dev/null; then
        error "Node.js not found. Please install Node.js (>=20.19.0 || >=22.12.0)."
        return 1
    fi
    ok "Node.js: $(node --version)"
}

# 检查 npm
require_npm() {
    if ! command -v npm &> /dev/null; then
        error "npm not found. Please install Node.js."
        return 1
    fi
    ok "npm: v$(npm --version)"
}

# 暂停（用于交互式终端，CI 环境跳过）
prompt_exit() {
    local code="${1:-0}"
    if [ -t 0 ] && [ -z "${CI:-}" ]; then
        echo ""
        echo "按回车键退出..."
        read -r || true
    fi
    exit "$code"
}
