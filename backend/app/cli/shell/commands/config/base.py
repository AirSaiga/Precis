# backend/app/cli/shell/commands/config/base.py
"""
@fileoverview Config 命令共享工具模块

功能概述:
- 提供配置命令的共享模板常量
- 内置 project、constraint、pattern 配置模板

架构设计:
- PROJECT_TEMPLATE/CONSTRAINT_TEMPLATE/PATTERNS_TEMPLATE: 字符串模板常量
"""

# 配置模板
# 注意：模板中的 {project_name} 由 init.py 以字符串 replace 方式填充，
# 不要使用 str.format（正则模板含 {2,} 等花括号字面量会被误当替换字段）。
PROJECT_TEMPLATE = """# Precis 项目清单（V2 格式）
# 项目基本信息：id 为项目标识符，name 为显示名称
version: 2
project:
  id: "{project_name}"
  name: "{project_name}"

# Schema/约束/正则等资源按需登记在下列列表（path 相对项目根）：
# schemas:
#   - id: <uuid>
#     path: schemas/<uuid>.schema.yaml
# constraints: []
# regex_nodes: []
# transforms: []
# manual_data: []
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
