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
"""@fileoverview 项目相对路径安全守卫

chat 工具读取项目内文件的路径白名单校验单一实现：拒绝绝对路径与
`..` 穿越（与 ADD_SCHEMA source.path 的安全口径一致），resolve 后
必须落在项目根内（兜底符号链接绕过）。

infer_schema（数据文件）与 read_config_file（配置/文本文件）共用本
守卫，防止各工具复制校验逻辑后漂移——路径安全是 XSS 之外的另一道
纵深防御，必须单一事实源。
"""

from __future__ import annotations

import os
from pathlib import Path


def resolve_project_relative_path(project_path: str, rel: str) -> Path | None:
    """路径白名单校验：拒绝绝对路径/.. 穿越，解析结果必须落在项目根内。

    参数:
        project_path: 项目配置目录路径（相对路径的解析根）
        rel: 待校验的项目相对路径（容忍 Windows 反斜杠，内部归一化为 posix）

    返回:
        解析后的绝对路径；路径非法（空/绝对/穿越/越出项目根）返回 None
    """
    normalized = (rel or "").strip().replace("\\", "/")
    if not normalized:
        return None
    # 与 ADD_SCHEMA source.path 安全口径一致：绝对路径与 .. 分量一律拒绝
    if os.path.isabs(normalized) or ".." in normalized.split("/"):
        return None
    try:
        root = Path(project_path).resolve()
        resolved = (root / normalized).resolve()
    except OSError:
        return None
    # 兜底符号链接绕过：resolve 后仍必须在项目根内
    if resolved != root and root not in resolved.parents:
        return None
    return resolved
