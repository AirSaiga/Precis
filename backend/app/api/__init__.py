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
@fileoverview API 模块包入口

功能概述:
- 标记 backend/app/api 目录为 Python 包
- 作为 API 层的统一入口，供外部导入使用

架构设计:
- 该包包含 FastAPI 应用、依赖注入、中间件、数据模型和路由等子模块
- 通过 __init__.py 暴露公共接口，简化外部导入路径

输入示例:
    from app.api import main

输出示例:
    无直接输出，仅作为包标记
"""
