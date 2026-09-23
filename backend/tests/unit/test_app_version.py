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
"""@fileoverview app_version 版本解析单元测试

测试范围:
- PRECIS_APP_VERSION 环境变量最高优先级
- 仓库 pyproject.toml 优先于安装元数据（cwd 残留 egg-info 遮蔽真实版本的回归）
- 无 pyproject 时回退包元数据（precis-cli → precis）与最终 fallback
"""

import importlib.metadata
from pathlib import Path

import pytest

from app.shared.core import app_version
from app.shared.core.app_version import get_app_version


def _make_repo(tmp_path: Path, pyproject_version: str | None) -> str:
    """构造 app/shared/core/app_version.py 的伪目录布局，返回伪模块文件路径。

    Args:
        tmp_path: pytest 提供的临时目录，充当伪仓库根
        pyproject_version: 写入 pyproject.toml 的版本；None 表示不放置
            pyproject.toml（模拟 PyPI 安装态的 site-packages 布局）
    """
    module_file = tmp_path / "app" / "shared" / "core" / "app_version.py"
    module_file.parent.mkdir(parents=True)
    module_file.write_text("", encoding="utf-8")
    if pyproject_version is not None:
        (tmp_path / "pyproject.toml").write_text(
            f'[project]\nname = "precis-cli"\nversion = "{pyproject_version}"\n',
            encoding="utf-8",
        )
    return str(module_file)


@pytest.fixture(autouse=True)
def _clear_version_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """隔离外部环境，保证用例间互不影响。"""
    monkeypatch.delenv("PRECIS_APP_VERSION", raising=False)


class TestGetAppVersion:
    def test_env_var_has_highest_priority(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        module_file = _make_repo(tmp_path, "9.9.9")
        monkeypatch.setattr(app_version, "__file__", module_file)
        monkeypatch.setenv("PRECIS_APP_VERSION", "7.7.7")

        assert get_app_version() == "7.7.7"

    def test_repo_pyproject_beats_stale_installed_metadata(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # 回归：CLI 以 python -m app.cli（cwd=backend）启动时，cwd 残留的
        # precis_cli.egg-info 使安装元数据停在 0.1.6，而仓库代码已是 0.1.8
        module_file = _make_repo(tmp_path, "0.1.8")
        monkeypatch.setattr(app_version, "__file__", module_file)
        monkeypatch.setattr(importlib.metadata, "version", lambda name: "0.1.6")

        assert get_app_version() == "0.1.8"

    def test_falls_back_to_installed_metadata_without_pyproject(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        module_file = _make_repo(tmp_path, None)
        monkeypatch.setattr(app_version, "__file__", module_file)

        def fake_version(name: str) -> str:
            if name == "precis-cli":
                return "0.2.0"
            raise importlib.metadata.PackageNotFoundError

        monkeypatch.setattr(importlib.metadata, "version", fake_version)

        assert get_app_version() == "0.2.0"

    def test_old_distribution_name_fallback(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        module_file = _make_repo(tmp_path, None)
        monkeypatch.setattr(app_version, "__file__", module_file)

        def fake_version(name: str) -> str:
            if name == "precis":
                return "0.1.0"
            raise importlib.metadata.PackageNotFoundError

        monkeypatch.setattr(importlib.metadata, "version", fake_version)

        assert get_app_version() == "0.1.0"

    def test_fallback_when_nothing_resolves(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        module_file = _make_repo(tmp_path, None)
        monkeypatch.setattr(app_version, "__file__", module_file)

        def always_missing(name: str) -> str:
            raise importlib.metadata.PackageNotFoundError(name)

        monkeypatch.setattr(importlib.metadata, "version", always_missing)

        assert get_app_version() == "0.0.0"
        assert get_app_version(fallback="0.0.0-dev") == "0.0.0-dev"
