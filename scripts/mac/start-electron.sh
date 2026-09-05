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
# 产物缺失或源码比上次编译新时重建("产物存在即跳过"会静默运行旧主进程)
ELECTRON_STAMP="${ELECTRON_DIR}/dist/main.js"
if [ ! -f "${ELECTRON_STAMP}" ] || [ -n "$(find "${ELECTRON_DIR}/src" "${ELECTRON_DIR}/package.json" "${ELECTRON_DIR}/tsconfig.json" -newer "${ELECTRON_STAMP}" -print -quit 2>/dev/null)" ]; then
    info "编译 Electron TypeScript(产物缺失或源码已更新)..."
    if ( cd "${ELECTRON_DIR}" && npm run build:electron ); then
        ok "Electron 编译完成"
    else
        error "Electron TypeScript 编译失败，无法启动（main 指向 dist/main.js，需要先成功编译）"
        info "请检查 electron/src 下的 TypeScript 错误后重试"
        # 删除半成品戳文件,避免下次被误判为"已是最新"
        rm -f "${ELECTRON_STAMP}"
        prompt_exit 1
    fi
    echo ""
else
    info "Electron 产物已是最新,跳过编译"
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
