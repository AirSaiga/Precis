#!/usr/bin/env bash
# 构建脚本 - 打包 Precis CLI 为自包含 macOS 分发包
# 产物：precis-cli-mac-<version>.tar.gz（解压即用，内置 python-runtime + backend 源码）
# 用法: bash scripts/build-cli.sh
#
# 入口：precis —— shell 脚本，调内置 python3 -m app.cli，cwd 设为 backend/ 目录
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

banner "Precis CLI - macOS 打包"

# --- 0. 前置检查 ---
if ! command -v node &> /dev/null; then
    err "Node.js 未找到（运行 fetch-python.js 需要）"
    exit 1
fi

VERSION="0.1.0"
ELECTRON_SCRIPTS="${REPO_ROOT}/electron/scripts"

# --- 1. 准备 staging 目录 ---
banner "1/5 准备 staging 目录"
STAGING="${REPO_ROOT}/backend/dist-mac"
rm -rf "${STAGING}"
mkdir -p "${STAGING}"
PKG_ROOT="${STAGING}/precis-cli"
mkdir -p "${PKG_ROOT}"
ok "staging: ${PKG_ROOT}"

# --- 2. 拉取 python-runtime 并安装后端依赖 ---
banner "2/5 拉取 python-runtime"
RUNTIME_DIR="${PKG_ROOT}/python-runtime"
node "${ELECTRON_SCRIPTS}/fetch-python.js" --out "${RUNTIME_DIR}"

banner "2.5/5 安装后端依赖到 runtime"
node "${ELECTRON_SCRIPTS}/install-backend-deps.js" --runtime "${RUNTIME_DIR}"

# --- 3. 拷贝 backend 源码（剔除缓存/测试/.git） ---
banner "3/5 拷贝 backend 源码"
BACKEND_SRC="${REPO_ROOT}/backend"
BACKEND_DST="${PKG_ROOT}/backend"
mkdir -p "${BACKEND_DST}"
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

# --- 4. 生成入口 precis ---
banner "4/5 生成入口 precis"
cat > "${PKG_ROOT}/precis" <<'EOF'
#!/usr/bin/env bash
# Precis CLI 入口 —— 调内置 python3 -m app.cli
# 脚本位于 precis-cli/ 根，runtime 在 python-runtime/，源码在 backend/
set -euo pipefail
PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PKG_ROOT}/python-runtime/bin/python3"
BACKEND_DIR="${PKG_ROOT}/backend"
if [[ ! -x "${PYTHON}" ]]; then
    echo "[ERROR] 内置 Python 未找到: ${PYTHON}" >&2
    exit 1
fi
# cwd 设为 backend/，让 Python 能 import app 包
cd "${BACKEND_DIR}"
exec "${PYTHON}" -B -m app.cli "$@"
EOF
chmod +x "${PKG_ROOT}/precis"
ok "precis 已生成"

# --- 5. 打成 tar.gz ---
banner "5/5 打包 tar.gz"
TAR_NAME="precis-cli-mac-${VERSION}.tar.gz"
TAR_PATH="${STAGING}/${TAR_NAME}"
cd "${STAGING}"
tar -czf "${TAR_NAME}" precis-cli

banner "打包完成"
ok "产物: ${TAR_PATH}"
echo "解压后运行 ./precis <命令> 即可（如 ./precis validate --help）"
