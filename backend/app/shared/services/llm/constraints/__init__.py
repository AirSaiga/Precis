"""
@fileoverview 约束文件操作子包

功能概述:
- constraint_builder: 构建约束 refs/params 结构
- constraint_deletion: 删除独立约束文件
- constraint_id: 生成语义化约束 ID
- frontend_instructions: 生成前端渲染指令
- inline_batch: 批量处理内联约束（减少 IO）

架构设计:
- 工具函数集合: 各模块提供单一职责的纯函数
- 协作模式: builder + id_gen 被 handlers 和 inline_batch 共享调用
"""

from app.shared.services.llm.constraints.constraint_builder import CONSTRAINT_TYPE_MAP
from app.shared.services.llm.constraints.constraint_deletion import delete_constraint_file
from app.shared.services.llm.constraints.frontend_instructions import generate_frontend_instructions
from app.shared.services.llm.constraints.inline_batch import process_inline_batch

__all__ = [
    "CONSTRAINT_TYPE_MAP",
    "delete_constraint_file",
    "generate_frontend_instructions",
    "process_inline_batch",
]
