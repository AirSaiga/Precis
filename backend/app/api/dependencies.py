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
@fileoverview API 依赖注入模块

功能概述:
- 提供 FastAPI 依赖注入函数
- 从 HTTP Header 获取并验证项目配置路径
- 提供 ProjectStore 数据容器在请求生命周期内传递项目路径

架构设计:
- 使用 FastAPI 的 Depends 机制实现依赖注入
- 通过 X-Project-Config-Path Header 接收项目路径，支持多项目
- 路径验证包括绝对路径检查和目录存在性检查
- ProjectStore 可轻松 mock，便于单元测试

输入示例:
    Header: X-Project-Config-Path: D:/project （项目根，须含 project.precis.yaml）

输出示例:
    ProjectStore(project_path="D:/project")
"""

# backend/app/api/dependencies.py
import os
from urllib.parse import quote, unquote

from fastapi import Depends, Header, HTTPException


class ProjectStore:
    """
    项目存储类。

    这是一个简单的数据容器类，用于在 FastAPI 依赖注入链中传递项目路径信息。
    通过将项目路径封装为对象，可以在类型提示中明确表达依赖关系。

    设计目的：
    - 提供类型安全的项目路径传递方式
    - 方便在路由处理器中获取项目根目录
    - 支持依赖注入的单元测试（可轻松 mock）

    属性：
        project_path: 项目配置目录的绝对路径
    """

    def __init__(self, project_path: str):
        """
        初始化项目存储对象。

        :param project_path: 项目配置目录的绝对路径
        """
        self.project_path = project_path


def _decode_header_path(value: str) -> str:
    """还原 HTTP header 携带的非 ASCII 路径。

    两种线上契约并存，按特征识别、互不干扰：

    1. GUI 契约（axios/fetch）：前端在出口处对路径做 encodeURIComponent（纯
       ASCII 百分号转义）。浏览器 XHR/fetch 的 header 值只接受 ByteString
       （ISO-8859-1），中文原值会被 XHR 直接拒绝；axios 1.18 的
       toByteStringHeaderValue 还会把 latin1 之外的字符静默删除——不转义的
       中文路径会以"删字后的错误路径"上线且无从在服务端还原。判定是否为
       规范转义串用 round-trip 校验（quote(unquote(v)) == v），字面上含 % 的
       合法路径通常不会被误解码（例外：字面 "%XX" 恰为合法 UTF-8 转义序列
       的路径会被还原，随后走校验链报错而非指向任意目录）。round-trip 的
       转义集必须与 encodeURIComponent 的不转义集对齐：JS 保留
       `!'()*` 五字符原样上线，校验端 quote 的 safe 集须包含它们，否则含
       括号/感叹号的中文路径（如 `D:/项目(备份)`）契约判定必败，被契约 2
       原样放行后以百分号串走校验链 400/404。
    2. TUI/脚本契约（reqwest FromBytes、curl 等）：UTF-8 原始字节按 obs-text
       上线。ASGI 服务器把 header 字节按 latin-1 解码成乱码，latin-1 与字节流
       双射，编码回字节再按 UTF-8 解码即可无损还原；非 UTF-8 字节保持原值，
       交由后续校验链正常报错。
    """
    # 契约 1：规范百分号转义（GUI）。safe 集对齐 encodeURIComponent 的保留集
    # （`!'()*`），Python quote 恒不转义字母数字与 `_.-~`，两者已一致
    if "%" in value:
        try:
            decoded = unquote(value, errors="strict")
        except UnicodeDecodeError:
            decoded = None
        if decoded is not None and decoded != value and quote(decoded, safe="!'()*") == value:
            return decoded
    # 契约 2：UTF-8 原始字节（TUI/脚本）
    try:
        return value.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


async def get_project_config_path(
    x_project_config_path: str = Header(..., description="项目根目录的绝对路径（须含 project.precis.yaml）"),
) -> str:
    """
    获取并验证项目配置路径的依赖函数。

    该函数是 FastAPI 的依赖项，用于从 HTTP Header 中提取项目配置路径，
    并进行合法性验证：
    1. 检查路径是否为绝对路径
    2. 检查路径对应的目录是否存在
    3. 必须含 project.precis.yaml（合法 Precis 项目根标识）

    B-sec3 安全加固: 原校验仅"绝对+是目录"，任意目录都能当项目根，导致后续
    manifest/数据源/AI 配置写入可能落到任意目录。现对齐 AI 路由的
    validate_project_path，要求 manifest 存在。项目首次创建走独立的
    /projects/create 端点（不经此依赖），故不影响创建流程。

    处理流程：
    1. 从 X-Project-Config-Path Header 获取路径
    2. 委托 _validate_project_root 做完整校验（绝对路径/拒绝 `..`/目录存在/manifest 存在）
    3. 返回验证后的绝对路径

    :param x_project_config_path: HTTP Header 中的项目配置路径
    :return: 验证通过的项目配置绝对路径
    :raises HTTPException: 路径验证失败时返回 400 或 404 错误

    Header 示例（项目根目录语义，不是 .precis/ 子目录）：
        X-Project-Config-Path: /path/to/project
    """
    return _validate_project_root(x_project_config_path)


def _validate_project_root(raw_path: str | None) -> str:
    """校验路径是否为合法 Precis 项目根（单一事实源）。

    B-sec3: 统一 get_project_config_path 与 ai/utils.validate_project_path 的校验逻辑，
    消除双套不一致（原 ai 路径要求 manifest，通用依赖不要求，弱者为默认）。

    要求：
    - 非空
    - 必须是绝对路径（Windows 下 abspath 会把相对路径转绝对，故须在规范化前先判）
    - 不含 ".."（normpath 后仍不含）
    - 必须是存在的目录
    - 必须含 project.precis.yaml（合法项目根标识）

    参数:
        raw_path: 原始路径字符串（通常来自 Header）

    返回:
        规范化后的绝对路径

    抛出:
        HTTPException(400): 校验失败
    """
    if not raw_path:
        raise HTTPException(status_code=400, detail="X-Project-Config-Path header 不能为空。")
    # 还原 header 编码乱码（见 _decode_header_path）：中文路径经 UTF-8 上线、
    # latin-1 解码后 isdir 必失败，必须先还原再做后续校验
    raw_path = _decode_header_path(raw_path)
    # 步骤1：先校验原始输入是否为绝对路径
    # 在 Windows 下，os.path.abspath 会把相对路径（如 "../project"）解析成绝对路径，
    # 导致后续 isabs 检查无法拒绝相对路径。因此必须在规范化之前先做判断。
    if not os.path.isabs(raw_path):
        raise HTTPException(status_code=400, detail="X-Project-Config-Path header 必须是一个绝对路径。")

    # 路径标准化并解析为绝对路径，防御 Path Traversal
    normalized_path = os.path.abspath(os.path.normpath(raw_path))
    # 拒绝路径穿越（normpath 后仍出现 .. 说明超出根）
    if ".." in normalized_path.split(os.sep):
        raise HTTPException(status_code=400, detail="X-Project-Config-Path 不允许包含 .. 目录穿越。")

    # 步骤2：验证路径对应的目录是否存在
    if not os.path.isdir(normalized_path):
        raise HTTPException(status_code=404, detail=f"提供的项目配置路径不存在: {normalized_path}")

    # 步骤3：验证是合法 Precis 项目根（含 manifest）
    manifest = os.path.join(normalized_path, "project.precis.yaml")
    if not os.path.isfile(manifest):
        # §2.1: manifest 缺失属"资源不存在"语义，统一 404（原 400 与 GET /manifest
        # 端点对同一情形不同状态码，且前端 404 自愈链永不触发）。detail 携带结构化
        # 错误码，前端按 detail.code 识别（不再匹配中文措辞前缀）。
        raise HTTPException(
            status_code=404,
            detail={
                "code": "PROJECT_NOT_FOUND",
                "message": (
                    "项目路径下未找到 project.precis.yaml（非合法 Precis 项目根）。"
                    "若要初始化新项目，请使用 POST /api/latest/projects/create。"
                ),
                "path": normalized_path,
            },
        )

    return normalized_path


async def get_project_store(project_path: str = Depends(get_project_config_path)) -> ProjectStore:
    """
    创建项目存储对象的依赖函数。

    该函数是 FastAPI 的依赖项，负责：
    1. 调用 get_project_config_path 获取验证后的项目路径
    2. 创建 ProjectStore 实例并返回

    这种分层设计的好处：
    - 职责分离：路径验证和对象创建分别处理
    - 可复用性：get_project_config_path 可以被其他依赖函数复用
    - 可测试性：每个函数都可以独立进行单元测试

    :param project_path: 已验证的项目配置路径（由 get_project_config_path 注入）
    :return: 包含项目路径的 ProjectStore 实例

    使用示例：
        @app.get("/projects/{project_id}/schemas")
        async def get_schemas(project: ProjectStore = Depends(get_project_store)):
            # 可以直接使用 project.project_path 访问项目路径
            schemas = load_schemas(project.project_path)
            return schemas
    """
    # 创建并返回项目存储对象，将路径封装为对象形式
    return ProjectStore(project_path=project_path)
