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
- 仓库源码 / Editable 安装：从运行模块位置上溯定位 backend/pyproject.toml
  直接读取。发布脚本在同一提交里同步它，永远与运行的代码一致——2026-09
  实证：CLI 以 `python -m app.cli`（cwd=backend）启动时，cwd 残留的
  `precis_cli.egg-info` 陈旧元数据会遮蔽 site-packages 里的真实安装版本，
  故安装元数据只作兜底，不作源码态依据
- PyPI 安装环境：包元数据。分发名 2026-09 起为 `precis-cli`
  （PyPI `precis` 已被 2014 年的第三方包占用），旧名 `precis` 仅作为
  本地存量 editable 安装的回退
- 都取不到：调用方给定的 fallback
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

# 分发名候选：新名优先，旧名兼容存量本地安装
_DISTRIBUTION_NAMES: tuple[str, ...] = ("precis-cli", "precis")

# 运行模块文件上溯到仓库根（backend/）的层级差：
# app/shared/core/app_version.py → parents[3] 即 backend/
_REPO_ROOT_LEVELS = 3


def _version_from_repo_pyproject() -> str | None:
    """从运行代码所在仓库的 pyproject.toml 读取版本（源码/Editable 态专用）。

    定位方式：本模块文件 app/shared/core/app_version.py 上溯 3 级即 backend/，
    与其下的 pyproject.toml 天然同源，不受 cwd 与安装元数据影响。

    Returns:
        pyproject [project].version；定位不到或解析失败时返回 None（交由
        调用方走包元数据兜底，典型场景：PyPI 安装态 app 位于 site-packages，
        旁边没有 pyproject.toml）
    """
    try:
        repo_root = Path(__file__).resolve().parents[_REPO_ROOT_LEVELS]
        pyproject = repo_root / "pyproject.toml"
        if not pyproject.is_file():
            return None
        with pyproject.open("rb") as fh:
            data = tomllib.load(fh)
        version = data["project"]["version"]
    except (IndexError, OSError, tomllib.TOMLDecodeError, KeyError, TypeError):
        # IndexError：异常布局下 parents 层数不足；其余为文件不可读/TOML 非法/结构缺失
        return None
    return version if isinstance(version, str) else None


def get_app_version(fallback: str = "0.0.0") -> str:
    """解析当前应用版本。

    优先级：PRECIS_APP_VERSION 环境变量 → 仓库 pyproject.toml（源码/Editable 态）
    → 包元数据（precis-cli → precis）→ fallback。

    Args:
        fallback: 全部来源都取不到时返回的兜底版本号

    Returns:
        版本号字符串
    """
    env_version = os.environ.get("PRECIS_APP_VERSION")
    if env_version:
        return env_version

    repo_version = _version_from_repo_pyproject()
    if repo_version:
        return repo_version

    from importlib import metadata as _md

    for dist_name in _DISTRIBUTION_NAMES:
        try:
            return _md.version(dist_name)
        except _md.PackageNotFoundError:
            continue
    return fallback
