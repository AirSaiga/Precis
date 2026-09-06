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
@fileoverview 可复用约束模板模块

功能概述:
- 定义模板数据模型 (TemplateFile)
- 提供模板 YAML 读取器 (reader)
- 提供模板展开器 (expander)

架构设计:
- 模板是配置层概念，在项目加载阶段展开为标准 TransformFile/ConstraintFile/RegexNodeFile
- 校验引擎（DAG Builder + Validator）无需任何修改
"""
