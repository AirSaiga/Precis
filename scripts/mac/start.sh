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

# 构建前端:产物缺失或源码比上次构建新时重建
# ("产物存在即跳过"会在源码更新后静默加载旧 dist——与 2026-09 打包链旧产物问题同类)
FRONTEND_STAMP="${FRONTEND_DIR}/dist/index.html"
if [ ! -f "${FRONTEND_STAMP}" ] || [ -n "$(find "${FRONTEND_DIR}/src" "${FRONTEND_DIR}/index.html" "${FRONTEND_DIR}/vite.config.ts" "${FRONTEND_DIR}/package.json" -newer "${FRONTEND_STAMP}" -print -quit 2>/dev/null)" ]; then
    info "构建前端(产物缺失或源码已更新)..."
    if ! ( cd "${FRONTEND_DIR}" && npm run build > /tmp/precis-frontend-build.log 2>&1 ); then
        error "前端构建失败,最近输出:"
        tail -n 25 /tmp/precis-frontend-build.log
        # 删除半成品戳文件,避免下次被误判为"已是最新"
        rm -f "${FRONTEND_STAMP}"
        prompt_exit 1
    fi
    ok "前端构建完成"
else
    info "前端产物已是最新,跳过构建"
fi

# 编译 Electron:产物缺失或源码比上次编译新时重建
ELECTRON_STAMP="${ELECTRON_DIR}/dist/main.js"
if [ ! -f "${ELECTRON_STAMP}" ] || [ -n "$(find "${ELECTRON_DIR}/src" "${ELECTRON_DIR}/package.json" "${ELECTRON_DIR}/tsconfig.json" -newer "${ELECTRON_STAMP}" -print -quit 2>/dev/null)" ]; then
    info "编译 Electron TypeScript(产物缺失或源码已更新)..."
    if ! ( cd "${ELECTRON_DIR}" && npm run build:electron > /tmp/precis-electron-build.log 2>&1 ); then
        error "Electron 编译失败,最近输出:"
        tail -n 25 /tmp/precis-electron-build.log
        # 删除半成品戳文件,避免下次被误判为"已是最新"
        rm -f "${ELECTRON_STAMP}"
        prompt_exit 1
    fi
    ok "Electron 编译完成"
else
    info "Electron 产物已是最新,跳过编译"
fi

echo ""
info "启动 Electron (后端由 Electron 自动管理,端口动态分配)..."
# 生产/标准模式:有前端构建产物时,Electron 自行 spawn 后端(startPythonServer)
# 并通过端口文件协议发现实际端口。无需外部启动后端,也无需 wait-on 固定端口。
cd "${ELECTRON_DIR}" && npx electron .

exit $?
