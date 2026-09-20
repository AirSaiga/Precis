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
"""@fileoverview infer-schema CLI 子命令测试（P2-2）

覆盖：stdout 输出合法 YAML、--output 写盘、参数错误与文件错误退出码 2、
单发模式退出码契约。
"""

from __future__ import annotations

import yaml

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.infer_schema import InferSchemaCommand
from app.cli.shell.main import main as cli_main


def _make_csv(tmp_path) -> str:
    csv = tmp_path / "orders.csv"
    csv.write_text("id,amount\n1,10\n2,\n", encoding="utf-8")
    return str(csv)


class TestInferSchemaCommand:
    def test_stdout_outputs_valid_yaml(self, tmp_path, capsys):
        cmd = InferSchemaCommand()
        result = cmd.execute([_make_csv(tmp_path)], ProjectContext())
        out = capsys.readouterr().out

        assert result.success is True
        schema = yaml.safe_load(out)
        assert schema["version"] == 2
        types = {c["name"]: c["type"] for c in schema["columns"]}
        assert types == {"id": "integer", "amount": "integer"}

    def test_output_writes_file(self, tmp_path):
        cmd = InferSchemaCommand()
        target = tmp_path / "schemas" / "orders.schema.yaml"
        result = cmd.execute([_make_csv(tmp_path), "--output", str(target)], ProjectContext())

        assert result.success is True
        assert target.exists()
        assert yaml.safe_load(target.read_text(encoding="utf-8"))["name"] == "orders"

    def test_id_name_source_path_options(self, tmp_path, capsys):
        cmd = InferSchemaCommand()
        cmd.execute(
            [
                _make_csv(tmp_path),
                "--id",
                "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "--name",
                "orders",
                "--source-path",
                "../orders.csv",
            ],
            ProjectContext(),
        )
        schema = yaml.safe_load(capsys.readouterr().out)
        assert schema["id"] == "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        assert schema["name"] == "orders"
        assert schema["source"]["path"] == "../orders.csv"

    def test_missing_file_argument_exit_code_2(self):
        cmd = InferSchemaCommand()
        result = cmd.execute([], ProjectContext())
        assert result.success is False
        assert result.exit_code == 2

    def test_nonexistent_file_exit_code_2(self, tmp_path):
        cmd = InferSchemaCommand()
        result = cmd.execute([str(tmp_path / "no_such.csv")], ProjectContext())
        assert result.success is False
        assert result.exit_code == 2

    def test_invalid_sample_rows_exit_code_2(self, tmp_path):
        cmd = InferSchemaCommand()
        result = cmd.execute([_make_csv(tmp_path), "--sample-rows", "abc"], ProjectContext())
        assert result.success is False
        assert result.exit_code == 2

    def test_cli_main_exit_codes(self, tmp_path):
        """单发模式：成功 0 / 文件不存在 2。"""
        assert cli_main(["infer-schema", _make_csv(tmp_path)]) == 0
        assert cli_main(["infer-schema", str(tmp_path / "no_such.csv")]) == 2

    def test_alias_infer_registered(self):
        from app.cli.shell.main import CLIShell

        shell = CLIShell()
        cmd = shell.registry.get("infer")
        assert cmd is not None
        assert cmd.name == "infer-schema"
