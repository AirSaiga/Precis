#!/usr/bin/env bash
# ============================================
# Precis - 仅启动 Electron 桌面壳 (Mac/Linux)
# 需先手动启动后端 + 前端(开发模式),或由 Electron 自行 spawn 后端(生产模式)
# 用法:
#   ./scripts/mac/start-electron.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis Desktop (Electron Dev)"

info "检查环境..."
require_node || prompt_exit 1
require_npm  || prompt_exit 1
echo ""
ok "环境检查通过"
echo ""

# 依赖检查(仅 Electron 相关;后端依赖由 start-backend 或 setup 负责)
info "检查依赖..."
if [ ! -d "node_modules" ]; then
    error "根目录 node_modules 缺失。请先运行: scripts/setup.sh 或 npm run install:all"
    prompt_exit 1
fi
ok "根目录依赖已安装"

if [ ! -d "${ELECTRON_DIR}/node_modules" ]; then
    error "Electron 依赖缺失。请先运行: scripts/setup.sh 或 npm run install:all"
    prompt_exit 1
fi
ok "Electron 依赖已安装"
echo ""

# 编译 Electron 主进程 TypeScript（项目 main 指向 dist/main.js，必须先编译）
if [ ! -f "${ELECTRON_DIR}/dist/main.js" ]; then
    info "编译 Electron TypeScript..."
    if ( cd "${ELECTRON_DIR}" && npm run build:electron ); then
        ok "Electron 编译完成"
    else
        error "Electron TypeScript 编译失败，无法启动（main 指向 dist/main.js，需要先成功编译）"
        info "请检查 electron/src 下的 TypeScript 错误后重试"
        prompt_exit 1
    fi
    echo ""
fi

banner "正在启动 Precis Desktop (仅 Electron)..."
echo "提示: 本脚本仅启动 Electron 桌面壳。"
echo "  - 开发模式: 请先启动后端(start-backend.sh)和前端(start-frontend.sh)"
echo "    后端端口由 OS 动态分配,Electron 自动读取 backend/.backend-port 发现端口"
echo "  - 完整三件套请用 start-dev.sh"
echo ""
echo "按 Ctrl+C 停止 Electron"
echo ""

# 仅启动 Electron(开发模式连接 Vite,生产模式自行 spawn 后端)
cd "${ELECTRON_DIR}" && npm start
EXIT_CODE=$?

echo ""
if [ ${EXIT_CODE} -ne 0 ]; then
    warn "Electron 异常退出，代码: ${EXIT_CODE}"
fi
prompt_exit ${EXIT_CODE}
