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
"""项目管理路由聚合：/api/latest/projects 下的扫描、打开、创建子路由。"""

from fastapi import APIRouter

from . import create, open, scan

router = APIRouter(prefix="/api/latest/projects", tags=["Projects"])
router.include_router(scan.router)
router.include_router(open.router)
router.include_router(create.router)
