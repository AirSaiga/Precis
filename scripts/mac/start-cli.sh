#!/bin/bash
#
# ============================================
# Precis CLI 启动脚本 (Mac/Linux)
# ============================================
#
# 用法:
#   precis                            - 进入交互式 CLI
#   precis [command] [args...]        - 执行单条命令后退出
#
# ============================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 设置项目根目�?
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
if [ -L "$SCRIPT_SOURCE" ]; then
    SCRIPT_PATH="$(readlink "$SCRIPT_SOURCE")"
    if [[ ! "$SCRIPT_PATH" = /* ]]; then
        SCRIPT_PATH="$(dirname "$SCRIPT_SOURCE")/$SCRIPT_PATH"
    fi
else
    SCRIPT_PATH="$SCRIPT_SOURCE"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${PROJECT_ROOT}"

# 优先使用虚拟环境
if [ -f "${PROJECT_ROOT}/.venv/bin/python" ]; then
    PYTHON_CMD="${PROJECT_ROOT}/.venv/bin/python"
    echo -e "${GREEN}[OK]${NC} 使用虚拟环境 Python"
else
    # 检查系�?Python
    if ! command -v python3 &> /dev/null; then
        if ! command -v python &> /dev/null; then
            echo -e "${RED}[错误] 未找�?Python${NC}"
            echo "按回车键退�?.."
            read
            exit 1
        fi
        PYTHON_CMD="python"
    else
        PYTHON_CMD="python3"
    fi
fi

# 启动交互�?CLI
cd "${PROJECT_ROOT}/backend"
$PYTHON_CMD -B -m app.cli.shell.main "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo -e "${RED}[错误] CLI 异常退�?(代码: $EXIT_CODE)${NC}"
    echo "按回车键退�?.."
    read
fi
exit $EXIT_CODE
