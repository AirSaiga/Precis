#!/usr/bin/env bash
# ============================================
# Precis - 启动 TUI (Mac/Linux)
# Rust + ratatui 终端界面,通过 HTTP 调用后端
# 用法:
#   ./scripts/mac/start-tui-rust.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis TUI (Rust + ratatui)"

# 后端端口由 OS 动态分配,实际端口写入 backend/.backend-port
# TUI 通过 PRECIS_BACKEND_URL 环境变量获知后端地址
PORT_FILE="${BACKEND_DIR}/.backend-port"
if [ ! -f "${PORT_FILE}" ]; then
    error "Backend port file not found: ${PORT_FILE}"
    info "请先启动后端: ./scripts/mac/start-backend.sh 或 npm run start:backend:mac"
    prompt_exit 1
fi
BACKEND_PORT=$(cat "${PORT_FILE}" | tr -d '[:space:]')
ok "Backend port: ${BACKEND_PORT}"

# Health check 后端动态端口
info "Backend (port ${BACKEND_PORT})..."
if curl -sf --max-time 3 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    ok "Backend is running."
else
    warn "Backend not detected at port ${BACKEND_PORT}."
fi

# 注入后端地址到环境变量,Rust TUI 的 main.rs 会读取 PRECIS_BACKEND_URL
export PRECIS_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

# Locate Rust toolchain
if ! command -v cargo &> /dev/null; then
    error "Rust cargo not found. Install from https://rustup.rs/"
    prompt_exit 1
fi
ok "cargo found: $(cargo --version)"

# Build and run
cd "${PROJECT_ROOT}/tui-rust"
info "Compiling (debug)..."

# Build: stderr (warnings) goes to log file, only check exit code
if ! cargo build 2>build-warnings.log; then
    error "Build failed. See build-warnings.log"
    prompt_exit 1
fi
ok "Build successful."
echo ""

# Run quietly (suppress runtime stderr)
cargo run -q 2>/dev/null
EXIT_CODE=$?
echo ""

if [ ${EXIT_CODE} -ne 0 ]; then
    warn "TUI exited with code ${EXIT_CODE}."
fi
prompt_exit ${EXIT_CODE}
