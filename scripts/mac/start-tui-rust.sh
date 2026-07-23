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
# 后端健康 -> 通过 PRECIS_BACKEND_URL 复用已运行的后端
# 后端不在 -> 不设该变量,TUI 会通过 backend.rs 自拉起内置后端(退出时自动清理)
unset PRECIS_BACKEND_URL 2>/dev/null || true
PORT_FILE="${BACKEND_DIR}/.backend-port"
if [ -f "${PORT_FILE}" ]; then
    BACKEND_PORT=$(cat "${PORT_FILE}" | tr -d '[:space:]')
    ok "Backend port file: ${BACKEND_PORT}"
    info "Backend (port ${BACKEND_PORT})..."
    if curl -sf --max-time 3 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
        ok "Backend is running. Reusing it via PRECIS_BACKEND_URL."
        export PRECIS_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
    else
        info "Backend not detected at port ${BACKEND_PORT}. TUI 将自拉起内置后端."
    fi
else
    info "未检测到后端端口文件, TUI 将自拉起内置后端."
fi

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
