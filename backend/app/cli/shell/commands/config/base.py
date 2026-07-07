# backend/app/cli/shell/commands/config/base.py
"""
@fileoverview Config 命令共享工具模块

功能概述:
- 提供配置命令的共享工具与模板
- 内置 project、constraint、pattern 配置模板
- 提供安全的配置文件查找函数（带路径穿越防护）

架构设计:
- PROJECT_TEMPLATE/CONSTRAINT_TEMPLATE/PATTERNS_TEMPLATE: 字符串模板常量
- find_config_file(): 委托 shared_services.config_ops.find_config_file（CLI/TUI 同源），
  本模块保留为向后兼容入口，供其他子命令直接 import

输入示例:
    find_config_file("/project", "project.precis.yaml")

输出示例:
    "/project/project.precis.yaml"
"""

# 配置模板
PROJECT_TEMPLATE = """# Precis 项目配置文件
# 项目基本信息
project:
  name: "{project_name}"
  version: "1.0.0"
  description: "数据校验项目"

# 数据源配置
data_sources:
  - name: default
    type: excel
    path: ./data

# Schema 定义目录
schemas:
  dir: ./schemas

# 约束定义目录
constraints:
  dir: ./constraints

# 正则模式定义
patterns:
  dir: ./patterns
"""

CONSTRAINT_TEMPLATE = """# Precis 约束配置文件
# 定义数据校验规则

constraints:
  - name: unique_id
    type: unique
    columns:
      - id
    message: "ID 必须唯一"

  - name: not_null_name
    type: not_null
    columns:
      - name
    message: "名称不能为空"
"""

PATTERNS_TEMPLATE = """# Precis 正则模式配置文件
# 定义可复用的正则表达式

patterns:
  - name: email
    pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    description: "邮箱地址格式"

  - name: phone
    pattern: "^1[3-9]\\d{9}$"
    description: "中国手机号码"

  - name: id_card
    pattern: "(^\\d{15}$)|(^\\d{18}$)|(^\\d{17}(\\d|X|x)$)"
    description: "身份证号码"
"""


def find_config_file(project_path: str, filename: str) -> str | None:
    """查找配置文件。

    委托 shared_services.config_ops.find_config_file（CLI/TUI 同源），
    含路径穿越防护与递归查找。本函数保留为向后兼容入口，避免破坏其他子命令 import。

    Args:
        project_path: 项目根目录路径
        filename: 文件名（可能包含子目录）

    Returns:
        文件的完整路径，如果未找到则返回 None
    """
    from app.cli.shared_services.config_ops import find_config_file as _find_config_file

    return _find_config_file(project_path, filename)
