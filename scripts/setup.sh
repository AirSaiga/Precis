#!/bin/bash
#
# Precis 完整部署脚本 (Mac/Linux)
#
# 一键部署脚本，自动完成：
# 1. 检查 Python 3.12+ 和 Node.js 20+
# 2. 创建 Python 虚拟环境
# 3. 安装后端依赖
# 4. 安装前端依赖 (root + frontend + electron)
# 5. 构建前端和 Electron
#
# 用法:
#   ./setup.sh              # 完整部署
#   ./setup.sh --skip-build # 只安装依赖，不构建
#   ./setup.sh --system-py  # 使用系统 Python（不推荐）
#
# 跨平台参数对应（PowerShell 版 setup.ps1）:
#   --skip-build  ↔  -SkipBuild
#   --system-py   ↔  -UseSystemPython

set -uo pipefail  # 未定义变量报错 + 管道失败传递;不使用 set -e(会让显式错误检查成为死代码)

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 打印函数
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
separator() { echo -e "${CYAN}============================================================${NC}"; }

# 解析参数
SKIP_BUILD=false
USE_SYSTEM_PY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --system-py)
            USE_SYSTEM_PY=true
            shift
            ;;
        -h|--help)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --skip-build    跳过构建步骤，只安装依赖（PowerShell 等价: -SkipBuild）"
            echo "  --system-py     使用系统 Python 而不是虚拟环境（不推荐）（PowerShell 等价: -UseSystemPython）"
            echo "  -h, --help      显示此帮助"
            exit 0
            ;;
        *)
            error "未知参数: $1"
            exit 1
            ;;
    esac
done

# 项目路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
ELECTRON_DIR="$PROJECT_ROOT/electron"
VENV_DIR="$BACKEND_DIR/.venv"

cd "$PROJECT_ROOT"

separator
info "Precis 部署脚本 (Python 3.12+)"
info "项目路径: $PROJECT_ROOT"
separator
echo ""

# ============================================
# 1. 检查 Python (3.12+)
# ============================================
info "检查 Python 3.12+ 环境..."

PYTHON_CMD=""

# 检查 pyenv
if command -v pyenv &> /dev/null; then
    info "检测到 pyenv"

    # 检查是否有 Python 3.12+ (匹配 3.12.x 或 3.13.x)
    PYTHON_VERSIONS=$(pyenv versions --bare 2>/dev/null || true)
    HAS_PYTHON=false

    # 获取最高的 3.12+ 版本（3.12 或 3.13）
    PY_VER=$(echo "$PYTHON_VERSIONS" | grep -E "^3\.(12|13)\.[0-9]+" | sort -V | tail -n 1)
    if [ -n "$PY_VER" ]; then
        HAS_PYTHON=true
        PYTHON_CMD="$(pyenv root)/versions/$PY_VER/bin/python"
        success "使用 pyenv Python: $PY_VER"
    fi

    if [ "$HAS_PYTHON" = false ]; then
        warn "pyenv 中没有找到 Python 3.12+，尝试安装 Python 3.13.5..."
        info "这可能需要几分钟..."

        # 尝试安装 Python 3.13
        if pyenv install 3.13.5 2>/dev/null; then
            PYTHON_CMD="$(pyenv root)/versions/3.13.5/bin/python"
            success "Python 3.13.5 安装成功"
        else
            warn "安装 3.13.5 失败，尝试 3.13.0..."
            if pyenv install 3.13.0 2>/dev/null; then
                PYTHON_CMD="$(pyenv root)/versions/3.13.0/bin/python"
                success "Python 3.13.0 安装成功"
            fi
        fi
    fi
fi

# 检查系统 Python
if [ -z "$PYTHON_CMD" ]; then
    if command -v python3 &> /dev/null; then
        PYTHON_CMD="python3"
    elif command -v python &> /dev/null; then
        PYTHON_CMD="python"
    fi

    if [ -n "$PYTHON_CMD" ]; then
        PY_VERSION=$($PYTHON_CMD --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
        MAJOR=$(echo $PY_VERSION | cut -d. -f1)
        MINOR=$(echo $PY_VERSION | cut -d. -f2)

        if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 12 ]; then
            success "检测到系统 Python: $PY_VERSION"
        else
            error "系统 Python 版本过低: $PY_VERSION (需要 3.12+)"
            info "请安装 Python 3.12+:"
            info "  - pyenv: pyenv install 3.13.5"
            info "  - Homebrew: brew install python@3.13"
            info "  - 官网: https://www.python.org/downloads/release/python-3135/"
            exit 1
        fi
    fi
fi

if [ -z "$PYTHON_CMD" ]; then
    separator
    error "未找到 Python 3.12+"
    info "请安装 Python 3.12+:"
    info "  - pyenv: pyenv install 3.13.5"
    info "  - Homebrew: brew install python@3.13  # macOS"
    info "  - apt: sudo apt install python3.13 python3.13-venv  # Ubuntu"
    info "  - 官网: https://www.python.org/downloads/release/python-3135/"
    exit 1
fi

# 验证 Python
PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
success "Python: $PYTHON_VERSION"
echo ""

# ============================================
# 2. 检查 Node.js
# ============================================
info "检查 Node.js 环境..."

if ! command -v node &> /dev/null; then
    separator
    error "未找到 Node.js"
    info "请安装 Node.js 20.19.0+:"
    info "  - Homebrew: brew install node@20"
    info "  - 官网: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
success "Node.js: $NODE_VERSION"
success "npm: v$NPM_VERSION"

# 检查版本
NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1 | tr -d 'v')
NODE_MINOR=$(echo $NODE_VERSION | cut -d. -f2)
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
    separator
    error "Node.js 版本过低 (需要 ^20.19.0 || >=22.12.0)，当前为 $NODE_VERSION"
    info "请升级 Node.js:"
    info "  - Homebrew: brew install node@20"
    info "  - nvm: nvm install 20 && nvm use 20"
    info "  - 官网: https://nodejs.org"
    exit 1
fi

echo ""

# ============================================
# 3. 设置 Python 虚拟环境
# ============================================
if [ "$USE_SYSTEM_PY" = false ]; then
    info "设置 Python 虚拟环境..."

    if [ -d "$VENV_DIR" ]; then
        info "虚拟环境已存在: $VENV_DIR"
    else
        info "创建虚拟环境..."
        $PYTHON_CMD -m venv "$VENV_DIR"
        success "虚拟环境创建成功"
    fi

    PYTHON_CMD="$VENV_DIR/bin/python"
    success "使用虚拟环境 Python"
else
    warn "使用系统 Python（不推荐用于生产环境）"
fi

echo ""

# ============================================
# 4. 安装后端依赖
# ============================================
info "安装后端依赖..."
cd "$BACKEND_DIR"

# 升级 pip
info "升级 pip..."
$PYTHON_CMD -m pip install --upgrade pip -q

# 安装依赖
info "安装 requirements..."
$PYTHON_CMD -m pip install -r requirements.txt
if [ $? -ne 0 ]; then
    error "依赖安装失败"
    exit 1
fi
success "后端依赖安装完成"

# 验证关键包
if $PYTHON_CMD -c "import fastapi, pydantic, pandas, yaml" 2>/dev/null; then
    success "关键包验证通过"
else
    error "关键包验证失败"
    exit 1
fi

cd "$PROJECT_ROOT"
echo ""

# ============================================
# 5. 安装前端依赖
# ============================================
info "安装前端依赖..."

# 根目录依赖
if [ -d "node_modules" ]; then
    info "根目录依赖已安装"
else
    info "安装根目录依赖..."
    npm install
    if [ $? -ne 0 ]; then
        error "根目录依赖安装失败"
        exit 1
    fi
fi

# Frontend 依赖
if [ -d "$FRONTEND_DIR/node_modules" ]; then
    info "Frontend 依赖已安装"
else
    info "安装 Frontend 依赖..."
    cd "$FRONTEND_DIR"
    npm install
    if [ $? -ne 0 ]; then
        error "Frontend 依赖安装失败"
        exit 1
    fi
    cd "$PROJECT_ROOT"
fi

# Electron 依赖
if [ -d "$ELECTRON_DIR/node_modules" ]; then
    info "Electron 依赖已安装"
else
    info "安装 Electron 依赖..."
    cd "$ELECTRON_DIR"
    npm install
    if [ $? -ne 0 ]; then
        error "Electron 依赖安装失败"
        exit 1
    fi
    cd "$PROJECT_ROOT"
fi

success "所有前端依赖安装完成"
echo ""

# ============================================
# 6. 构建项目
# ============================================
if [ "$SKIP_BUILD" = false ]; then
    separator
    info "开始构建项目..."
    separator
    echo ""

    # 构建 Frontend
    info "构建 Frontend..."
    cd "$FRONTEND_DIR"
    npm run build
    if [ $? -ne 0 ]; then
        error "Frontend 构建失败"
        exit 1
    fi
    success "Frontend 构建完成"
    cd "$PROJECT_ROOT"
    echo ""

    # 构建 Electron
    info "构建 Electron..."
    cd "$ELECTRON_DIR"
    npm run build:electron
    if [ $? -ne 0 ]; then
        warn "Electron 构建失败"
        info "开发模式下将使用 ts-node 直接运行"
    else
        success "Electron 构建完成"
    fi
    cd "$PROJECT_ROOT"
    echo ""
else
    info "跳过构建步骤 (--skip-build)"
fi

echo ""
separator
success "部署完成!"
separator
echo ""

# 显示启动命令
info "可用启动命令:"
echo ""
echo -e "${CYAN}CLI 模式:${NC}"
echo "  ./scripts/mac/start-cli.sh"
echo ""
echo -e "${CYAN}桌面应用 (开发模式):${NC}"
echo "  ./scripts/mac/start-electron.sh"
echo ""
echo -e "${CYAN}手动启动:${NC}"
echo "  后端: cd backend && source .venv/bin/activate && python app/start_server.py"
echo "  前端: cd frontend && npm run dev"
echo "  Electron: cd electron && npm start"
echo ""
