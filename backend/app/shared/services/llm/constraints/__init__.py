# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
@fileoverview 约束文件操作子包

功能概述:
- constraint_builder: 构建约束 refs/params 结构
- constraint_deletion: 删除独立约束文件（显式 id 优先，语义引用兜底）
- constraint_lookup: 约束 ID 生成（类型前缀 + UUID v4）/ 清洗 / 按 id 或语义定位
- frontend_instructions: 生成前端渲染指令
- inline_batch: 批量处理内联约束（减少 IO）

架构设计:
- 工具函数集合: 各模块提供单一职责的纯函数
- 协作模式: builder + lookup 被 handlers 和 inline_batch 共享调用
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
