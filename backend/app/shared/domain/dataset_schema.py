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
@fileoverview 数据 Schema 统一导出入口模块

功能概述:
- 作为 dataset_schema 包的统一导出入口
- 聚合导出 schema/builder.py 中的类型构建器和注册表
- 聚合导出 schema/models.py 中的 Schema 模型类
- 降低外部调用方的导入成本，只需从一个入口导入所有 Schema 相关符号

架构设计:
- 代理导出模式: 实际实现已拆分为 builder.py 和 models.py
- 本模块仅做 re-export，无独立业务逻辑
- 保持向后兼容，避免导入路径变更

注意: CONSTRAINT_REGISTRY 已迁移至 app.shared.core.project.constraint.registry
"""

# 1. 项目内部导入
from .schema.builder import (
    TYPE_REGISTRY,
    build_type_from_config,
)
from .schema.models import ColumnSchema, DataSetSchema, TableSchema

# 注：models.py 也 re-export TYPE_REGISTRY 以兼容旧导入路径，单一事实源在 builder.py。

__all__ = [
    "ColumnSchema",
    "TableSchema",
    "DataSetSchema",
    "build_type_from_config",
    "TYPE_REGISTRY",
]
