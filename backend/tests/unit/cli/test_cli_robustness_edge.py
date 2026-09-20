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
"""@fileoverview CLI 入口健壮性矩阵（失效模式清单 F/C 系列端到端）

F1 manifest 指向目录 / F2 工具级失败时的 stdout 契约 / C1 具体 YAML 畸形 /
C2 transform 循环 / C6 source 相对路径逃逸——全部走 ValidateCommand 端到端，
断言退出码与输出契约（stdout JSON 合法性），不允许裸 traceback。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand

_SCHEMA = """version: 2
id: orders
name: orders
source:
  mode: relative_file
  path: data/orders.csv
columns:
  - id: id
    name: id
    type: integer
  - id: amount
    name: amount
    type: integer
"""


def _make_project(tmp_path: Path, csv_text: str = "id,amount\n1,10\n2,20\n") -> Path:
    proj = tmp_path / "proj"
    (proj / "schemas").mkdir(parents=True)
    (proj / "data").mkdir()
    (proj / "data" / "orders.csv").write_text(csv_text, encoding="utf-8")
    (proj / "schemas" / "orders.schema.yaml").write_text(_SCHEMA, encoding="utf-8")
    (proj / "project.precis.yaml").write_text(
        """version: 2
project:
  id: p
  name: p
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
""",
        encoding="utf-8",
    )
    return proj


def _run(manifest: Path, capsys):
    """执行 validate --format json，返回 (CommandResult, stdout 文本)。"""
    cmd = ValidateCommand()
    result = cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())
    out = capsys.readouterr().out
    return result, out


class TestManifestPathEdge:
    """F1: --manifest 路径形态边界"""

    def test_manifest_directory_clear_error_exit_2(self, tmp_path, capsys):
        """指向目录 → 退出码 2 + 明确"是目录"消息（不裸抛 PermissionError）。"""
        d = tmp_path / "adir"
        d.mkdir()
        result, out = _run(d, capsys)
        assert result.exit_code == 2
        assert "目录" in result.message
        assert out == ""  # 工具级失败：stdout 不承载 JSON


class TestBrokenConfigOutputContract:
    """F2/C1: 配置损坏时的退出码与 stdout 契约"""

    def test_tab_indented_manifest_exit_2(self, tmp_path, capsys):
        """tab 缩进 YAML → 退出码 2（此前仅覆盖未闭合 flow mapping 一种畸形）。"""
        proj = _make_project(tmp_path)
        (proj / "project.precis.yaml").write_text("version: 2\nproject:\n\tid: p\n", encoding="utf-8")
        from app.cli.shell.exceptions import ValidationError

        with pytest.raises(ValidationError):
            ValidateCommand().execute(
                ["--manifest", str(proj / "project.precis.yaml"), "--format", "json"], ProjectContext()
            )

    def test_unclosed_quote_schema_yaml_structured_warning(self, tmp_path, capsys):
        """schema YAML 未闭合引号 → 不崩溃：结构化 SchemaParseError 进 loading_warnings
        （含文件路径与修复指引），JSON 契约保持。"""
        proj = _make_project(tmp_path)
        (proj / "schemas" / "orders.schema.yaml").write_text(
            'version: 2\nid: orders\nname: "unclosed\n', encoding="utf-8"
        )
        result, out = _run(proj / "project.precis.yaml", capsys)
        payload = json.loads(out)
        assert payload["is_valid"] is False
        schema_warnings = [w for w in payload["loading_warnings"] if w.get("error_type") == "SchemaParseError"]
        assert len(schema_warnings) == 1
        assert "orders.schema.yaml" in schema_warnings[0]["file_path"]
        assert schema_warnings[0]["fix_hint"]

    def test_ragged_data_file_json_contract(self, tmp_path, capsys):
        """坏行数据文件 → stdout 仍为合法 JSON、is_valid=false、警告含行号（漏报红线修复后）。"""
        proj = _make_project(tmp_path, "id,amount\n1,10\n2,20,extra\n")
        result, out = _run(proj / "project.precis.yaml", capsys)
        payload = json.loads(out)
        assert payload["is_valid"] is False
        warnings_text = json.dumps(payload["loading_warnings"], ensure_ascii=False)
        assert "line 3" in warnings_text

    def test_bad_encoding_data_file_json_contract(self, tmp_path, capsys):
        """非法编码数据文件 → stdout 合法 JSON、is_valid=false（契约不破）。"""
        proj = _make_project(tmp_path)
        (proj / "data" / "orders.csv").write_bytes(b"id,amount\n1,\xff\xfe\x80\x81\n")
        result, out = _run(proj / "project.precis.yaml", capsys)
        payload = json.loads(out)
        assert payload["is_valid"] is False
        assert payload["schema_version"] == 1

    def test_header_only_data_file_valid(self, tmp_path, capsys):
        """仅表头数据文件 → 校验完成、0 违规、tables 行数为 0（0 行是定义行为）。"""
        proj = _make_project(tmp_path, "id,amount\n")
        result, out = _run(proj / "project.precis.yaml", capsys)
        payload = json.loads(out)
        assert payload["is_valid"] is True
        assert payload["tables"][0]["rows"] == 0


class TestAdversarialConfig:
    """C2/C6: 配置对抗（transform 循环 / source 逃逸）"""

    def test_transform_cycle_reported_not_hung(self, tmp_path, capsys):
        """transform A→B→A 循环 → 报"循环依赖"并退出（不挂死）。"""
        from app.cli.shell.exceptions import ValidationError

        proj = _make_project(tmp_path)
        (proj / "transforms").mkdir()
        for tid, upstream in (("ta", "tb"), ("tb", "ta")):
            (proj / "transforms" / f"{tid}.transform.yaml").write_text(
                f"""version: 2
id: {tid}
type: UpperCase
enabled: true
input_from_node: {upstream}
input_column: id
params: {{}}
output_columns: []
""",
                encoding="utf-8",
            )
        manifest = proj / "project.precis.yaml"
        manifest.write_text(
            manifest.read_text(encoding="utf-8")
            + "transforms:\n  - id: ta\n    path: transforms/ta.transform.yaml\n"
            + "  - id: tb\n    path: transforms/tb.transform.yaml\n",
            encoding="utf-8",
        )
        with pytest.raises(ValidationError, match="循环依赖"):
            ValidateCommand().execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())

    def test_source_dotdot_escape_currently_accepted(self, tmp_path, capsys):
        """source 带 ../ 逃出项目目录 → 当前行为为原样加载（CLI 用户本机全量 FS 权限，
        无 Web 边界；API 侧路径穿越防护见 test_path_traversal_security）。
        本测试钉死现状，若未来收紧为"项目根包含"需显式改此测试与 CHANGELOG。
        """
        (tmp_path / "outside.csv").write_text("id,amount\n1,10\n", encoding="utf-8")
        proj = _make_project(tmp_path)
        (proj / "schemas" / "orders.schema.yaml").write_text(
            _SCHEMA.replace("path: data/orders.csv", "path: ../outside.csv"), encoding="utf-8"
        )
        result, out = _run(proj / "project.precis.yaml", capsys)
        payload = json.loads(out)
        assert payload["is_valid"] is True
        assert payload["tables"][0]["rows"] == 1
