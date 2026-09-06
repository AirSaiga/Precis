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
@fileoverview 项目信息类型定义模块

功能概述:
- 定义项目的基本信息结构
- 包括项目 ID 和展示名称

架构设计:
- 轻量级模型: 仅包含必要的基本信息
- 必需字段: id 和 name 都是必填的
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ProjectInfo(BaseModel):
    """@classdesc 项目基本信息

    用于在 manifest.yaml 中定义项目的基本信息。

    字段说明:
        - id: 项目的稳定标识符，用于系统内部引用（不应改变）
        - name: 项目的展示名称，用于 UI 显示
        - description: 项目描述（可选）

    示例:
        # manifest.yaml 中的定义
        project:
          id: user-management
          name: 用户管理系统
          description: 管理公司用户数据

        # 对应的 Python 对象
        ProjectInfo(id="user-management", name="用户管理系统", description="...")
    """

    id: str = Field(..., description="项目 ID（稳定标识）")
    name: str = Field(..., description="项目展示名称")
    # 回归: manifest 类型 docstring 的示例一直包含 description，模型却曾缺失该字段——
    # 任何 manifest 重写（PUT manifest/schema/settings 等）都会把用户手写的
    # description 从磁盘上静默抹掉。恢复为可选字段以保全 roundtrip。
    description: str | None = Field(None, description="项目描述（可选）")
