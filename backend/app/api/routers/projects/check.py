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
@fileoverview 项目探测路由：只读判断目录是否为合法 Precis 项目根

功能概述:
- GET /api/latest/projects/check?path=<绝对路径>
- 供前端「智能打开」（useSmartProjectOpen）在引导就地新建前探测目录

架构设计:
- 与 open.py/create.py 对称，但**永不 404**：空目录/不存在的目录都用布尔
  字段表达（dir_exists/is_project），浏览器控制台不会因探测留下 404 红字；
  仅非法输入（相对路径/路径穿越）返回 400
- 路径经 query 参数传递（UTF-8 自动编解码），无 X-Project-Config-Path
  header 的 latin-1 编码问题
- 不经 get_project_config_path 依赖（该依赖对缺 manifest 的目录抛 404，
  正是本端点要避免的语义）
"""

from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Query

from app.api.models.projects import CheckProjectResponse

router = APIRouter(prefix="", tags=["Projects-Check"])


@router.get(
    "/check",
    response_model=CheckProjectResponse,
    summary="探测目录是否为 Precis 项目（永不 404）",
)
def check_project(path: str = Query(..., description="待探测的目录绝对路径")) -> CheckProjectResponse:
    """只读探测目录状态，不创建、不修改任何文件，不改变"当前项目"。"""
    # 输入校验与 get_project_config_path 同规：先拒绝相对路径（Windows 下
    # abspath 会把相对路径解析成绝对路径，必须先判 isabs），再防路径穿越
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="path 必须是一个绝对路径。")

    normalized = os.path.abspath(os.path.normpath(path))
    if ".." in normalized.split(os.sep):
        raise HTTPException(status_code=400, detail="path 不允许包含 .. 目录穿越。")

    dir_exists = os.path.isdir(normalized)
    is_project = os.path.isfile(os.path.join(normalized, "project.precis.yaml"))
    return CheckProjectResponse(path=normalized, dir_exists=dir_exists, is_project=is_project)
