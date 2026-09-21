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
"""@fileoverview manifest 顶层 version 字段显式校验测试（P0-1 版本识别机制）

覆盖：
- version: 2 → 原有加载行为不变
- 缺失 version → ManifestVersionError（"缺少 version 字段，当前支持版本为 2"）
- version 非 2（整数/字符串）→ ManifestVersionError + 迁移指引
- 错误经 loading_errors 结构化通道透出，CLI --format json 的 loading_warnings 可见
"""

from __future__ import annotations

import json

import pytest

from app.shared.core.project.loader import load_project


def _write_manifest(tmp_path, content: str):
    """写入 manifest 文件并返回路径。"""
    manifest = tmp_path / "project.precis.yaml"
    manifest.write_text(content, encoding="utf-8")
    return manifest


# 最小合法 v2 manifest（含一个真实 schema 引用，验证正常路径确实加载）
_VALID_MANIFEST = """version: 2
project:
  id: version-check-demo
  name: version-check-demo
schemas:
  - id: t
    path: schemas/t.schema.yaml
"""

_MISSING_VERSION_MANIFEST = """project:
  id: version-check-demo
  name: version-check-demo
schemas: []
"""

_V1_MANIFEST = """version: 1
project:
  id: old-project
  name: 旧版项目
schemas: []
"""

_STRING_VERSION_MANIFEST = """version: "2"
project:
  id: str-version
  name: str-version
schemas: []
"""


@pytest.fixture
def valid_project(tmp_path):
    """构造带一个 schema 的合法 v2 项目。"""
    schemas_dir = tmp_path / "schemas"
    schemas_dir.mkdir()
    (schemas_dir / "t.schema.yaml").write_text(
        """version: 2
id: t
name: t
source:
  mode: relative_file
  path: ../t.csv
columns:
  - id: a
    name: a
    type: string
""",
        encoding="utf-8",
    )
    (tmp_path / "t.csv").write_text("a\nx\n", encoding="utf-8")
    _write_manifest(tmp_path, _VALID_MANIFEST)
    return tmp_path


class TestManifestVersionCheck:
    """load_project 入口的 version 显式校验"""

    def test_version_2_loads_normally(self, valid_project):
        """version: 2 时加载行为不变：schema 正常装载、无版本错误。"""
        loaded = load_project(str(valid_project / "project.precis.yaml"))
        assert "t" in loaded.schema_files
        version_errors = [e for e in loaded.loading_errors if e.error_type == "ManifestVersionError"]
        assert version_errors == []

    def test_missing_version_reports_structured_error(self, tmp_path):
        """缺失 version → ManifestVersionError，消息含支持版本说明。"""
        manifest = _write_manifest(tmp_path, _MISSING_VERSION_MANIFEST)
        loaded = load_project(str(manifest))

        version_errors = [e for e in loaded.loading_errors if e.error_type == "ManifestVersionError"]
        assert len(version_errors) == 1
        err = version_errors[0]
        assert "缺少 version 字段" in err.title
        assert "当前支持的版本为 2" in err.description
        assert "version: 2" in err.fix_hint

    def test_version_1_reports_migration_guidance(self, tmp_path):
        """version: 1 → 不支持 + 迁移指引（指向 V2 结构与示例项目）。"""
        manifest = _write_manifest(tmp_path, _V1_MANIFEST)
        loaded = load_project(str(manifest))

        version_errors = [e for e in loaded.loading_errors if e.error_type == "ManifestVersionError"]
        assert len(version_errors) == 1
        err = version_errors[0]
        assert "1" in err.title
        assert "不被支持" in err.title
        assert "升级" in err.fix_hint
        assert "qa_test/qa_simple" in err.fix_hint

    def test_string_version_two_accepted(self, tmp_path):
        """H12：version: "2"（字符串）值等价于 2，按值放行不再按类型误杀。"""
        manifest = _write_manifest(tmp_path, _STRING_VERSION_MANIFEST)
        loaded = load_project(str(manifest))

        version_errors = [e for e in loaded.loading_errors if e.error_type == "ManifestVersionError"]
        assert version_errors == []

    def test_float_version_two_point_zero_accepted(self, tmp_path):
        """H12：version: 2.0 无损转 int 后按值放行。"""
        manifest = _write_manifest(tmp_path, _VALID_MANIFEST.replace("version: 2", "version: 2.0", 1))
        loaded = load_project(str(manifest))

        version_errors = [e for e in loaded.loading_errors if e.error_type == "ManifestVersionError"]
        assert version_errors == []

    def test_string_version_three_still_rejected(self, tmp_path):
        """值不支持仍拒绝：version: "3" → ManifestVersionError + 迁移指引。"""
        manifest = _write_manifest(tmp_path, _STRING_VERSION_MANIFEST.replace('version: "2"', 'version: "3"', 1))
        loaded = load_project(str(manifest))

        version_errors = [e for e in loaded.loading_errors if e.error_type == "ManifestVersionError"]
        assert len(version_errors) == 1
        assert "不被支持" in version_errors[0].title

    def test_unsupported_version_aborts_loading(self, tmp_path):
        """版本不识别时不进入后续加载：schema 不装载、loading_errors 只含版本错误。"""
        (tmp_path / "schemas").mkdir()
        (tmp_path / "schemas" / "t.schema.yaml").write_text(
            "version: 2\nid: t\nname: t\ncolumns:\n  - id: a\n    name: a\n    type: string\n",
            encoding="utf-8",
        )
        manifest = _write_manifest(tmp_path, _V1_MANIFEST)
        loaded = load_project(str(manifest))

        # schema 文件存在但不装载（加载中止）
        assert loaded.schema_files == {}
        # loading_errors 仅含版本错误，无级联噪声
        assert [e.error_type for e in loaded.loading_errors] == ["ManifestVersionError"]


class TestVersionErrorViaCliJson:
    """版本错误在 CLI --format json 输出（loading_warnings）中可见"""

    def test_version_error_visible_in_loading_warnings(self, tmp_path, capsys):
        """v1 manifest → JSON 输出 loading_warnings 含 ManifestVersionError。"""
        from app.cli.shell.commands.base import ProjectContext
        from app.cli.shell.commands.validate import ValidateCommand

        manifest = _write_manifest(tmp_path, _V1_MANIFEST)
        cmd = ValidateCommand()
        result = cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())

        payload = json.loads(capsys.readouterr().out)
        assert result.success is False
        assert payload["is_valid"] is False
        version_warnings = [w for w in payload["loading_warnings"] if w.get("error_type") == "ManifestVersionError"]
        assert len(version_warnings) == 1
        assert "缺少" not in version_warnings[0]["title"]
        assert "不被支持" in version_warnings[0]["title"]

    def test_missing_version_visible_in_loading_warnings(self, tmp_path, capsys):
        """缺失 version → JSON loading_warnings 可见且 fix_hint 给出补写指引。"""
        from app.cli.shell.commands.base import ProjectContext
        from app.cli.shell.commands.validate import ValidateCommand

        manifest = _write_manifest(tmp_path, _MISSING_VERSION_MANIFEST)
        cmd = ValidateCommand()
        cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())

        payload = json.loads(capsys.readouterr().out)
        version_warnings = [w for w in payload["loading_warnings"] if w.get("error_type") == "ManifestVersionError"]
        assert len(version_warnings) == 1
        assert "缺少 version 字段" in version_warnings[0]["title"]
        assert "version: 2" in version_warnings[0]["fix_hint"]
