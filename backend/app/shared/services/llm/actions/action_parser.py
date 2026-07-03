"""
@fileoverview AI Chat 动作解析器模块

功能概述:
- 解析 LLM 返回的 JSON 动作列表并执行对应的业务操作
- 支持约束创建、更新、删除，Schema 更新，项目校验等动作
- 本模块为入口文件，具体的 YAML IO、Schema 解析、约束构建、动作处理
  已拆分到同目录下的专用子模块中

架构设计:
- ActionParser 类负责 LLM 响应的解析与验证（见 chat/response_parser.py）
- process_actions() 为业务入口，协调各子模块完成动作执行（见 actions/action_processor.py）

输入示例:
    actions = [
        {
            "action": "create_constraint",
            "tableName": "users",
            "constraintType": "Unique",
            "columnNames": ["email"]
        }
    ]
    result = process_actions(actions, workspace_path="/path/to/project")

输出示例:
    {
        "success": True,
        "message": "成功处理 1 个动作",
        "details": [{"action": "create_constraint", "status": "success"}]
    }
"""

from __future__ import annotations

# 约束类型映射：Prompt -> 后端标准类型
CONSTRAINT_TYPE_MAP = {
    "NOT_NULL": "NotNull",
    "UNIQUE": "Unique",
    "ALLOWED_VALUES": "AllowedValues",
    "RANGE": "Range",
    "REGEX": "Scripted",
    "FOREIGN_KEY": "ForeignKey",
    "CONDITIONAL": "Conditional",
    "DATE_LOGIC": "DateLogic",
}

# 重新导出 process_actions，保持向后兼容。
# 注意：ActionParser 不在此 re-export——它在 response_parser.py 定义，
# 而 response_parser 现在依赖 actions.registry，re-export 会形成循环导入
# （response_parser → actions.registry → actions/__init__ → action_parser → response_parser）。
# 调用方应直接 from app.shared.services.llm.chat.response_parser import ActionParser。
from app.shared.services.llm.actions.action_processor import process_actions
from app.shared.services.llm.yaml_io import ActionParseError

__all__ = [
    "ActionParseError",
    "CONSTRAINT_TYPE_MAP",
    "process_actions",
]
