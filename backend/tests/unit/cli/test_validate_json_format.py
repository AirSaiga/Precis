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
"""@fileoverview validate --format json 输出契约与单发模式退出码测试

覆盖：
- JSON 模式 stdout 只含单个 JSON 文档，契约字段齐全，is_valid 与 errors 一致
- JSON 模式无 Spinner/rich 控制字符混入 stdout
- 退出码契约：通过 0 / 违规 1 / 工具错误（manifest 不存在、非法 --format、
  未知命令、校验异常）2
- human 默认模式输出回归（不传 --format 时仍为 rich 人类可读输出）
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand, _split_positional_args
from app.cli.shell.main import main as cli_main

# 契约字段全集：JSON 输出必须逐字段存在（缺值可为 null，字段不可缺）
_TOP_LEVEL_FIELDS = {
    "schema_version",
    "is_valid",
    "interrupted",
    "duration_ms",
    "tables",
    "summary",
    "errors",
    "loading_warnings",
}
_ERROR_ENTRY_FIELDS = {
    "table",
    "column",
    "constraint_type",
    "constraint_file",
    "row_index",
    "cell_value",
    "error_message",
    "suggestion",
}
_SUMMARY_FIELDS = {"constraints_total", "constraints_passed", "constraints_failed"}

# 3 行数据、第 2 行 amount 为空 → NotNull 违规恰 1 条，行索引 1
_DIRTY_CSV = "id,amount\n1,10\n2,\n3,30\n"
_CLEAN_CSV = "id,amount\n1,10\n2,20\n3,30\n"


@pytest.fixture
def make_project(tmp_path):
    """构造最小 V2 项目工厂：schema + NotNull 约束 + 指定内容的 orders.csv。

    返回一个函数，传入 CSV 文本，返回 manifest 路径。
    """

    def _make(csv_content: str) -> Path:
        proj = tmp_path / "proj"
        (proj / "schemas").mkdir(parents=True)
        (proj / "constraints").mkdir()
        (proj / "data").mkdir()
        (proj / "data" / "orders.csv").write_text(csv_content, encoding="utf-8")
        (proj / "schemas" / "orders.schema.yaml").write_text(
            """version: 2
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
""",
            encoding="utf-8",
        )
        (proj / "constraints" / "orders_amount_notnull.constraint.yaml").write_text(
            """version: 2
id: orders_amount_notnull
type: NotNull
enabled: true
description: amount 列非空
refs:
  table_id: orders
  column_id: amount
params: {}
""",
            encoding="utf-8",
        )
        manifest = proj / "project.precis.yaml"
        manifest.write_text(
            """version: 2
project:
  id: orders-demo
  name: orders-demo
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: orders_amount_notnull
    path: constraints/orders_amount_notnull.constraint.yaml
""",
            encoding="utf-8",
        )
        return manifest

    return _make


class TestJsonOutputContract:
    """--format json 的 stdout 契约（单文档、字段齐全、与 errors 一致）"""

    def _run_json(self, manifest: Path, capsys) -> dict:
        cmd = ValidateCommand()
        result = cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())
        captured = capsys.readouterr()
        return {"result": result, "stdout": captured.out, "stderr": captured.err}

    def test_stdout_is_single_json_document(self, make_project, capsys):
        """JSON 模式 stdout 恰一行、可被 json.loads 解析、无 ANSI/Spinner 控制字符。"""
        manifest = make_project(_DIRTY_CSV)
        run = self._run_json(manifest, capsys)

        out = run["stdout"]
        # 恰好一行 JSON 文档（print 追加单个换行）
        assert len(out.strip().splitlines()) == 1
        assert out.strip().startswith("{") and out.strip().endswith("}")
        # 无 ANSI 转义序列与 Spinner 动画帧
        assert "\x1b" not in out
        assert "⠋" not in out
        assert "✓" not in out

    def test_report_failure_still_prints_json_and_exit_2(self, make_project, capsys, tmp_path):
        """2026-09-20 契约修复回归：--report 导出失败时 stdout 仍必须是单个 JSON 文档。

        此前导出失败提前 return，stdout 一字节都不输出——按本文档契约消费 stdout
        的 agent/CI 会解析崩。修复后：payload 照常输出 + 错误经 stderr 透出 + 退出码 2。
        """
        manifest = make_project(_DIRTY_CSV)
        bad_report = tmp_path / "report.xyz"  # 非法扩展名（.html/.xlsx 之外）
        cmd = ValidateCommand()
        result = cmd.execute(
            ["--manifest", str(manifest), "--format", "json", "--report", str(bad_report)],
            ProjectContext(),
        )
        captured = capsys.readouterr()

        assert not result.success
        assert result.exit_code == 2
        assert "报告导出失败" in result.message  # 错误文案经 CommandResult 呈现（stderr/REPL 由调用方渲染）
        out = captured.out.strip()
        assert out.startswith("{") and out.endswith("}")
        payload = json.loads(out)
        assert set(_TOP_LEVEL_FIELDS) <= set(payload.keys())
        assert payload["is_valid"] is False  # 脏数据违规仍如实呈现

    def test_contract_fields_complete(self, make_project, capsys):
        """顶层与嵌套契约字段齐全，缺值字段以 null 呈现而非缺失。"""
        manifest = make_project(_DIRTY_CSV)
        run = self._run_json(manifest, capsys)
        payload = json.loads(run["stdout"])

        assert set(payload.keys()) == _TOP_LEVEL_FIELDS
        assert payload["schema_version"] == 1
        assert set(payload["summary"].keys()) == _SUMMARY_FIELDS
        for error in payload["errors"]:
            assert set(error.keys()) == _ERROR_ENTRY_FIELDS

    def test_violations_reported_with_full_context(self, make_project, capsys):
        """NotNull 违规条目带全量定位信息：表/列/约束类型/行号/值/消息。"""
        manifest = make_project(_DIRTY_CSV)
        run = self._run_json(manifest, capsys)
        payload = json.loads(run["stdout"])

        assert payload["is_valid"] is False
        assert len(payload["errors"]) == 1
        entry = payload["errors"][0]
        assert entry["table"] == "orders"
        assert entry["column"] == "amount"
        assert entry["constraint_type"] == "NotNullConstraint"
        assert entry["row_index"] == 1
        assert entry["cell_value"] is None
        assert isinstance(entry["error_message"], str) and entry["error_message"]
        # P0-3: 独立约束文件产生的违规回溯到约束文件相对路径
        assert entry["constraint_file"] == "constraints/orders_amount_notnull.constraint.yaml"

    def test_is_valid_consistent_with_errors_and_summary(self, make_project, capsys):
        """is_valid 与 errors 数量一致；summary 的通过/失败与违规约束吻合。"""
        manifest = make_project(_DIRTY_CSV)
        run = self._run_json(manifest, capsys)
        payload = json.loads(run["stdout"])

        assert payload["is_valid"] == (len(payload["errors"]) == 0)
        assert payload["summary"]["constraints_total"] >= 1
        assert payload["summary"]["constraints_failed"] == 1
        assert payload["summary"]["constraints_passed"] == payload["summary"]["constraints_total"] - 1
        assert isinstance(payload["duration_ms"], int)
        assert payload["interrupted"] is False

    def test_tables_list_rows_count(self, make_project, capsys):
        """tables 报告表名与实际加载行数（3 行 CSV 数据）。"""
        manifest = make_project(_DIRTY_CSV)
        run = self._run_json(manifest, capsys)
        payload = json.loads(run["stdout"])

        assert payload["tables"] == [{"name": "orders", "rows": 3}]

    def test_clean_data_passes(self, make_project, capsys):
        """合规数据：is_valid True、errors 空、loading_warnings 空。"""
        manifest = make_project(_CLEAN_CSV)
        run = self._run_json(manifest, capsys)
        payload = json.loads(run["stdout"])

        assert payload["is_valid"] is True
        assert payload["errors"] == []
        assert payload["loading_warnings"] == []
        assert payload["summary"]["constraints_failed"] == 0

    def test_command_result_success_reflects_validity(self, make_project, capsys):
        """CommandResult 的 success 与 JSON 的 is_valid 对齐（供退出码映射消费）。"""
        manifest = make_project(_DIRTY_CSV)
        run = self._run_json(manifest, capsys)
        payload = json.loads(run["stdout"])
        assert run["result"].success is payload["is_valid"]

    def test_loading_errors_passed_through_as_warnings(self, tmp_path, capsys):
        """loading_errors 原样透传为 loading_warnings（构造 ID 不一致触发加载警告）。"""
        proj = tmp_path / "warn_proj"
        (proj / "schemas").mkdir(parents=True)
        (proj / "data").mkdir()
        (proj / "data" / "orders.csv").write_text(_CLEAN_CSV, encoding="utf-8")
        (proj / "schemas" / "orders.schema.yaml").write_text(
            """version: 2
id: orders
name: orders
source:
  mode: relative_file
  path: data/orders.csv
columns:
  - id: id
    name: id
    type: integer
""",
            encoding="utf-8",
        )
        manifest = proj / "project.precis.yaml"
        # manifest 引用 ID 与 schema 文件内部 ID 不一致 → inspect 级 loading_error
        manifest.write_text(
            """version: 2
project:
  id: warn-demo
  name: warn-demo
schemas:
  - id: orders_old
    path: schemas/orders.schema.yaml
""",
            encoding="utf-8",
        )

        cmd = ValidateCommand()
        cmd.execute(["--manifest", str(manifest), "--format", "json"], ProjectContext())
        payload = json.loads(capsys.readouterr().out)

        assert isinstance(payload["loading_warnings"], list)
        assert len(payload["loading_warnings"]) >= 1
        assert any(w.get("error_type") for w in payload["loading_warnings"])


class TestExitCodeContract:
    """单发模式退出码契约：0 通过 / 1 违规 / 2 工具错误"""

    def test_exit_0_on_clean_data(self, make_project):
        manifest = make_project(_CLEAN_CSV)
        rc = cli_main(["validate", "--manifest", str(manifest), "--format", "json"])
        assert rc == 0

    def test_exit_1_on_violations(self, make_project):
        manifest = make_project(_DIRTY_CSV)
        rc = cli_main(["validate", "--manifest", str(manifest), "--format", "json"])
        assert rc == 1

    def test_exit_1_on_violations_human_mode(self, make_project):
        """退出码契约与输出格式正交：human 模式违规同样返回 1。"""
        manifest = make_project(_DIRTY_CSV)
        rc = cli_main(["validate", "--manifest", str(manifest)])
        assert rc == 1

    def test_exit_2_on_missing_manifest(self):
        rc = cli_main(["validate", "--manifest", "Z:/nonexistent/project.precis.yaml", "--format", "json"])
        assert rc == 2

    def test_exit_2_on_invalid_format_value(self, make_project):
        """非法 --format 取值属参数错误，退出码 2 且不产生 JSON 输出。"""
        manifest = make_project(_CLEAN_CSV)
        rc = cli_main(["validate", "--manifest", str(manifest), "--format", "yaml"])
        assert rc == 2

    def test_exit_2_on_unknown_command(self):
        """未知命令属参数错误，退出码 2。"""
        rc = cli_main(["no_such_command"])
        assert rc == 2

    def test_version_flag_returns_zero(self, capsys):
        """--version 全局旗标输出版本号并返回 0（插件前置探测依赖此契约）。"""
        rc = cli_main(["--version"])
        out = capsys.readouterr().out
        assert rc == 0
        assert out.strip().startswith("precis ")

    def test_version_short_flag_returns_zero(self, capsys):
        """-v 短旗标与 --version 等价。"""
        rc = cli_main(["-v"])
        assert rc == 0
        assert capsys.readouterr().out.strip().startswith("precis ")

    def test_exit_2_on_broken_manifest(self, tmp_path):
        """manifest 存在但内容非法 → 校验异常崩溃 → 退出码 2（区别于违规的 1）。"""
        manifest = tmp_path / "project.precis.yaml"
        # 未闭合的 flow mapping → YAML 解析异常
        manifest.write_text("version: 2\nproject: {id: x\n", encoding="utf-8")
        rc = cli_main(["validate", "--manifest", str(manifest), "--format", "json"])
        assert rc == 2


class TestHumanModeRegression:
    """human 默认模式输出回归：不传 --format 时保持 rich 人类可读输出"""

    def test_human_output_markers_present_on_violations(self, make_project, capsys):
        manifest = make_project(_DIRTY_CSV)
        rc = cli_main(["validate", "--manifest", str(manifest)])
        out = capsys.readouterr().out

        # 人类输出标志：开始头、校验完成耗时、错误统计与详情列表
        assert rc == 1
        assert "开始执行数据校验" in out
        assert "校验完成，耗时" in out
        assert "总计: 1 个错误" in out
        assert "NotNull" in out

    def test_human_output_markers_present_on_pass(self, make_project, capsys):
        manifest = make_project(_CLEAN_CSV)
        rc = cli_main(["validate", "--manifest", str(manifest)])
        out = capsys.readouterr().out

        assert rc == 0
        assert "开始执行数据校验" in out
        assert "校验完成，耗时" in out
        assert "校验通过，未发现任何错误" in out

    def test_human_output_not_pure_json(self, make_project, capsys):
        """human 输出不应是合法 JSON 文档（防止格式串扰）。"""
        manifest = make_project(_DIRTY_CSV)
        cli_main(["validate", "--manifest", str(manifest)])
        out = capsys.readouterr().out
        with pytest.raises(json.JSONDecodeError):
            json.loads(out)


class TestFormatOptionParsing:
    """--format 的参数解析与 Shell 模式选项剥离"""

    def test_split_positional_args_strips_format(self):
        """`validate --format json` 在 Shell 模式不会把 json 当表名。"""
        assert _split_positional_args(["--format", "json"]) == []
        assert _split_positional_args(["--manifest", "m.yaml", "--format", "json", "orders"]) == ["orders"]

    def test_format_json_without_manifest_stays_shell_mode(self):
        """无 --manifest 时 --format json 不触发 standalone 模式（Shell 模式忽略）。"""
        cmd = ValidateCommand()
        result = cmd.execute(["--format", "json"], ProjectContext())
        # 未打开项目 → Shell 模式报错（而非 standalone 的清单不存在）；
        # 使用错误对齐单发退出码契约：exit_code=2（区别于"发现违规"的 1）
        assert result.success is False
        assert "未打开项目" in result.message
        assert result.exit_code == 2

    def test_invalid_format_rejected_before_manifest_check(self, tmp_path):
        """非法 --format 在 manifest 存在性检查之前被拒绝，退出码 2。"""
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text("version: 2\n", encoding="utf-8")
        cmd = ValidateCommand()
        result = cmd.execute(["--manifest", str(manifest), "--format", "xml"], ProjectContext())
        assert result.success is False
        assert "--format" in result.message
        assert result.exit_code == 2

    def test_format_is_case_insensitive(self, make_project, capsys):
        """--format JSON 大写同样进入 JSON 模式。"""
        manifest = make_project(_CLEAN_CSV)
        cmd = ValidateCommand()
        result = cmd.execute(["--manifest", str(manifest), "--format", "JSON"], ProjectContext())
        out = capsys.readouterr().out
        assert result.success is True
        assert json.loads(out)["is_valid"] is True
