# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 应用包版本解析（CLI/API/欢迎页共用）

版本号单一事实源是仓库根 package.json，发布脚本（scripts/release.mjs）同步到
backend/pyproject.toml 等六处 manifest；本模块只负责"运行时读当前版本"：

- 打包环境：PRECIS_APP_VERSION 环境变量（Electron 打包不安装包元数据，
  importlib.metadata 拿不到，环境变量是唯一真实来源）
- 开发/PyPI 安装环境：包元数据。分发名 2026-09 起为 `precis-cli`
  （PyPI `precis` 已被 2014 年的第三方包占用），旧名 `precis` 仅作为
  本地存量 editable 安装的回退
- 都取不到：调用方给定的 fallback
"""

from __future__ import annotations

import os

# 分发名候选：新名优先，旧名兼容存量本地安装
_DISTRIBUTION_NAMES: tuple[str, ...] = ("precis-cli", "precis")


def get_app_version(fallback: str = "0.0.0") -> str:
    """解析当前应用版本。

    优先级：PRECIS_APP_VERSION 环境变量 → 包元数据（precis-cli → precis）→ fallback。

    Args:
        fallback: 全部来源都取不到时返回的兜底版本号

    Returns:
        版本号字符串
    """
    env_version = os.environ.get("PRECIS_APP_VERSION")
    if env_version:
        return env_version

    from importlib import metadata as _md

    for dist_name in _DISTRIBUTION_NAMES:
        try:
            return _md.version(dist_name)
        except _md.PackageNotFoundError:
            continue
    return fallback
