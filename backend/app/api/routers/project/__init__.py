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
@fileoverview Project API Router 聚合模块

功能概述:
- 聚合 project 子模块的所有 FastAPI router
- 统一设置 prefix="/project" 和 tags=["Project"]

架构设计:
- 各子模块 router 通过 include_router 合并到主 router
- 子模块本身使用空 prefix，由主 router 统一添加前缀
"""

from fastapi import APIRouter

from . import (
    constraint,
    full_config,
    inspection_fix,
    manifest,
    pattern,
    regex,
    schema,
    settings,
    template,
    validation,
    view,
    workspaces,
)

router = APIRouter(
    prefix="/api/latest/project",
    tags=["Project"],
)

router.include_router(view.router)
router.include_router(workspaces.router)
router.include_router(manifest.router)
router.include_router(schema.router)
router.include_router(constraint.router)
router.include_router(regex.router)
router.include_router(pattern.router)
router.include_router(template.router)
router.include_router(full_config.router)
router.include_router(settings.router)
router.include_router(validation.router)
router.include_router(inspection_fix.router)
