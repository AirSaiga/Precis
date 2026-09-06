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
@fileoverview 文件预览路由入口模块

功能概述:
- 创建并导出文件预览模块的 FastAPI APIRouter 实例
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/latest/preview", tags=["File Preview"])


__all__ = ["router"]
