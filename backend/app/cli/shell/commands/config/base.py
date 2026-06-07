# backend/app/cli/shell/commands/config/base.py
"""
@fileoverview Config 命令共享工具模块

功能概述:
- 提供配置命令的共享工具与模板
- 内置 project、constraint、pattern 配置模板
- 提供安全的配置文件查找函数（带路径穿越防护）

架构设计:
- PROJECT_TEMPLATE/CONSTRAINT_TEMPLATE/PATTERNS_TEMPLATE: 字符串模板常量
- find_config_file(): 安全的配置文件查找函数，防止路径穿越攻击

输入示例:
    find_config_file("/project", "project.precis.yaml")

输出示例:
    "/project/project.precis.yaml"
"""

import os
from typing import Optional

from app.shared.core.utils.path_utils import paths_equal

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


def find_config_file(project_path: str, filename: str) -> Optional[str]:
    """查找配置文件。

    首先尝试直接拼接路径，如果失败则在项目目录下递归查找。
    包含路径穿越防护，验证输入路径的合法性。

    Args:
        project_path: 项目根目录路径
        filename: 文件名（可能包含子目录）

    Returns:
        文件的完整路径，如果未找到则返回 None

    Security:
        - 验证 project_path 是合法目录
        - 验证 filename 不包含路径分隔符或父目录引用
        - 解析后的文件路径必须在 project_path 范围内
    """
    # 验证 project_path 是合法目录
    if not project_path or not isinstance(project_path, str):
        return None

    project_path = os.path.realpath(project_path)
    if not os.path.isdir(project_path):
        return None

    # 验证 filename 不包含危险字符（路径穿越防护）
    if not filename or not isinstance(filename, str):
        return None

    # 禁止绝对路径和父目录引用
    if os.path.isabs(filename):
        return None
    if ".." in filename or filename.startswith("~"):
        return None

    # 首先尝试直接路径
    direct_path = os.path.normpath(os.path.join(project_path, filename))

    # 确保解析后的路径在项目目录范围内
    if not direct_path.startswith(project_path):
        return None

    if os.path.isfile(direct_path):
        return direct_path

    # 如果直接路径不存在，递归查找
    for root, _, files in os.walk(project_path):
        # 跳过隐藏目录
        if any(part.startswith(".") for part in root.split(os.sep)):
            continue
        # 检查文件名是否匹配
        if os.path.basename(filename) in files:
            full_path = os.path.join(root, os.path.basename(filename))
            # 验证找到的完整路径在项目范围内
            if os.path.realpath(full_path).startswith(project_path):
                return full_path
        # 也检查完整路径匹配
        for f in files:
            rel_path = os.path.relpath(os.path.join(root, f), project_path)
            if paths_equal(rel_path, filename):
                full_path = os.path.join(root, f)
                # 验证找到的完整路径在项目范围内
                if os.path.realpath(full_path).startswith(project_path):
                    return full_path

    return None
