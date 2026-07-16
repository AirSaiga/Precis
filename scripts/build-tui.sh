#!/usr/bin/env bash
# 构建脚本 - 打包 Precis TUI (Rust) 为自包含 macOS 分发包
# 产物：precis-tui-mac-<version>.tar.gz（解压即用，内置 python-runtime + backend 源码）
# 用法: bash scripts/build-tui.sh
set -euo pipefail

# 定位仓库根目录（脚本在 scripts/ 下）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# ============================================
# 颜色输出
# ============================================
info()  { printf "\033[36m[INFO]\033[0m  %s\n"  "$*"; }
ok()    { printf "\033[32m[OK]\033[0m    %s\n"  "$*"; }
err()   { printf "\033[31m[ERROR]\033[0m %s\n"  "$*" >&2; }
banner(){ printf "\n\033[1;36m======== %s ========\033[0m\n" "$*"; }

banner "Precis TUI - macOS 打包"

# --- 0. 前置检查 ---
if ! command -v cargo &> /dev/null; then
    err "Rust cargo 未找到，请从 https://rustup.rs/ 安装"
    exit 1
fi
if ! command -v node &> /dev/null; then
    err "Node.js 未找到（运行 fetch-python.js 需要）"
    exit 1
fi

VERSION="0.1.0"
ELECTRON_SCRIPTS="${REPO_ROOT}/electron/scripts"

# --- 1. 编译 Rust 二进制（release） ---
banner "1/5 编译 Rust 二进制 (release)"
info "cwd: ${REPO_ROOT}/tui-rust"
cd "${REPO_ROOT}/tui-rust"
cargo build --release
TUI_BIN="${REPO_ROOT}/tui-rust/target/release/precis-tui"
if [[ ! -f "${TUI_BIN}" ]]; then
    err "编译产物未找到: ${TUI_BIN}"
    exit 1
fi
ok "二进制: ${TUI_BIN}"

# --- 2. 准备 staging 目录 ---
banner "2/5 准备 staging 目录"
cd "${REPO_ROOT}"
STAGING="${REPO_ROOT}/tui-rust/dist-mac"
rm -rf "${STAGING}"
mkdir -p "${STAGING}"
PKG_ROOT="${STAGING}/precis-tui"
mkdir -p "${PKG_ROOT}"

# 拷贝 Rust 二进制
cp "${TUI_BIN}" "${PKG_ROOT}/precis-tui"
chmod +x "${PKG_ROOT}/precis-tui"
ok "staging: ${PKG_ROOT}"

# --- 3. 拉取 python-runtime 并安装后端依赖 ---
banner "3/5 拉取 python-runtime"
RUNTIME_DIR="${PKG_ROOT}/python-runtime"
node "${ELECTRON_SCRIPTS}/fetch-python.js" --out "${RUNTIME_DIR}"

banner "3.5/5 安装后端依赖到 runtime"
node "${ELECTRON_SCRIPTS}/install-backend-deps.js" --runtime "${RUNTIME_DIR}"

# --- 4. 拷贝 backend 源码（剔除缓存/测试/.git） ---
banner "4/5 拷贝 backend 源码"
BACKEND_SRC="${REPO_ROOT}/backend"
BACKEND_DST="${PKG_ROOT}/backend"
mkdir -p "${BACKEND_DST}"
# rsync 剔除无关目录/文件（对齐 electron-builder 的 extraResources filter）
rsync -a \
    --exclude='__pycache__' \
    --exclude='.mypy_cache' \
    --exclude='.pytest_cache' \
    --exclude='.ruff_cache' \
    --exclude='.coverage' \
    --exclude='*.egg-info' \
    --exclude='build/' \
    --exclude='dist/' \
    --exclude='tests/' \
    --exclude='.git' \
    --exclude='.gitignore' \
    "${BACKEND_SRC}/" "${BACKEND_DST}/"
ok "backend 源码已拷贝"

# --- 5. 打成 tar.gz ---
banner "5/5 打包 tar.gz"
TAR_NAME="precis-tui-mac-${VERSION}.tar.gz"
TAR_PATH="${STAGING}/${TAR_NAME}"
cd "${STAGING}"
tar -czf "${TAR_NAME}" precis-tui

banner "打包完成"
ok "产物: ${TAR_PATH}"
echo "解压后运行 ./precis-tui 即可（自动拉起内置后端）"
