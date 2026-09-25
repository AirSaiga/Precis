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
@fileoverview AI 服务工具函数单元测试

测试范围:
- estimate_tokens: Token 估算
- truncate_history_by_tokens: 历史截断
- get_project_overview: 项目概览扫描
"""

from app.shared.services.ai.utils import (
    estimate_tokens,
    get_project_overview,
    truncate_history_by_tokens,
)


class TestEstimateTokens:
    def test_empty_string(self):
        assert estimate_tokens("") == 0

    def test_pure_english(self):
        result = estimate_tokens("Hello World")
        # "Hello" and "World" = 2 words + 10 overhead = 12
        assert result == 12

    def test_pure_chinese(self):
        result = estimate_tokens("你好世界")
        # 4 chinese chars + 10 = 14
        assert result == 14

    def test_mixed(self):
        result = estimate_tokens("Hello 世界")
        # 1 english word + 2 chinese + 10 = 13
        assert result == 13

    def test_numbers(self):
        result = estimate_tokens("123 456")
        # 2 number groups + 10 = 12
        assert result == 12

    def test_punctuation(self):
        result = estimate_tokens("Hello, World!")
        # 2 words + 2 punctuations (, and !) + 10 = 14
        assert result == 14

    def test_complex_text(self):
        result = estimate_tokens("用户ID: 12345, 名称: Alice")
        # 2 chinese + 2 english (ID, Names) + 1 number + 3 punctuations + 10 = ~18
        assert result > 10


class TestTruncateHistoryByTokens:
    def test_empty_history(self):
        result = truncate_history_by_tokens([], "system")
        assert result == []

    def test_short_history_kept(self):
        history = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        result = truncate_history_by_tokens(history, "system", max_tokens=1000)
        assert len(result) == 2

    def test_truncation_occurs(self):
        # Create long messages that exceed the limit
        long_msg = "a " * 10000
        history = [
            {"role": "user", "content": long_msg},
            {"role": "assistant", "content": long_msg},
            {"role": "user", "content": "short"},
            {"role": "assistant", "content": "short"},
        ]
        result = truncate_history_by_tokens(history, "system", max_tokens=50)
        # Should keep at least 2 messages
        assert len(result) >= 2
        assert len(result) <= 4

    def test_at_least_two_messages(self):
        history = [{"role": "user", "content": "x " * 5000}] * 10
        result = truncate_history_by_tokens(history, "system", max_tokens=10)
        assert len(result) >= 2

    def test_system_prompt_counted(self):
        # System prompt takes tokens, so fewer messages fit
        history = [
            {"role": "user", "content": "short"},
            {"role": "assistant", "content": "short"},
        ]
        # Very small max, but system prompt alone might exceed
        result = truncate_history_by_tokens(history, "a " * 1000, max_tokens=5)
        assert len(result) >= 2

    def test_no_content_key(self):
        history = [{"role": "user"}]
        result = truncate_history_by_tokens(history, "system", max_tokens=1000)
        assert len(result) == 1


class TestGetProjectOverview:
    def test_empty_path(self):
        result = get_project_overview("")
        assert result["schemas"] == []
        assert result["constraints"] == []

    def test_empty_directory(self, tmp_path):
        result = get_project_overview(str(tmp_path))
        assert result["schemas"] == []
        assert result["constraints"] == []

    def test_with_schema_files(self, tmp_path):
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        schema_yaml = """
id: users
name: users
columns:
  - id: col1
    name: email
    type: string
  - id: col2
    name: age
    type: integer
constraints:
  - id: nn_email
    type: NotNull
    column: col1
"""
        (schemas_dir / "users.schema.yaml").write_text(schema_yaml, encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        assert len(result["schemas"]) == 1
        assert result["schemas"][0]["name"] == "users"
        assert len(result["schemas"][0]["columns"]) == 2
        # Inline constraint should be collected
        assert len(result["constraints"]) == 1
        assert result["constraints"][0]["is_inline"] is True

    def test_with_constraint_files(self, tmp_path):
        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        constraint_yaml = """
id: c_unique_email
type: Unique
enabled: true
description: Email must be unique
refs:
  table_id: users
  column_id: email
params: {}
"""
        (constraints_dir / "unique.constraint.yaml").write_text(constraint_yaml, encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        assert len(result["constraints"]) == 1
        assert result["constraints"][0]["type"] == "Unique"
        assert result["constraints"][0]["is_inline"] is False

    def test_with_regex_files(self, tmp_path):
        regex_dir = tmp_path / "regex"
        regex_dir.mkdir()
        regex_yaml = """
id: r1
name: email_regex
pattern: "^[\\\\w.+-]+@[\\\\w-]+\\\\.[\\\\w.]+$"
enabled: true
"""
        (regex_dir / "email.regex.yaml").write_text(regex_yaml, encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        assert len(result["regex_nodes"]) == 1
        assert result["regex_nodes"][0]["name"] == "email_regex"

    def test_with_transform_files(self, tmp_path):
        transforms_dir = tmp_path / "transforms"
        transforms_dir.mkdir()
        transform_yaml = """
id: t1
type: UpperCase
enabled: true
input_from_node: schema1
input_column: name
output_columns:
  - name_upper
"""
        (transforms_dir / "upper.transform.yaml").write_text(transform_yaml, encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        assert len(result["transforms"]) == 1
        assert result["transforms"][0]["type"] == "UpperCase"

    def test_with_manifest_settings(self, tmp_path):
        manifest_yaml = """
version: 2
id: test_project
name: Test Project
settings:
  validation:
    strict: true
"""
        (tmp_path / "project.precis.yaml").write_text(manifest_yaml, encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        assert "validation" in result["settings"]

    def test_corrupt_yaml_handled(self, tmp_path):
        """坏 YAML 不进 schemas 列表（跳过），但显式记入 parse_errors（文件名+错误摘要）。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "bad.schema.yaml").write_text("{{invalid yaml", encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        # Should not crash, just skip the bad file
        assert result["schemas"] == []
        # 解析失败不静默：agent 能一眼看到哪个文件坏了
        assert len(result["parse_errors"]) == 1
        assert result["parse_errors"][0]["path"] == "schemas/bad.schema.yaml"
        assert result["parse_errors"][0]["error"]

    def test_corrupt_constraint_file_listed_in_parse_errors(self, tmp_path):
        """constraints 目录下的坏文件同样记入 parse_errors。"""
        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "broken.constraint.yaml").write_text("id: [unclosed", encoding="utf-8")

        result = get_project_overview(str(tmp_path))

        assert result["constraints"] == []
        assert [e["path"] for e in result["parse_errors"]] == ["constraints/broken.constraint.yaml"]

    def test_corrupt_manifest_listed_once_in_parse_errors(self, tmp_path):
        """坏 manifest（两段读取都会失败）只记一条 parse_errors，不重复。"""
        (tmp_path / "project.precis.yaml").write_text("{ broken: [", encoding="utf-8")

        result = get_project_overview(str(tmp_path))

        manifest_errors = [e for e in result["parse_errors"] if e["path"] == "project.precis.yaml"]
        assert len(manifest_errors) == 1
        assert manifest_errors[0]["error"]

    def test_corrupt_regex_and_transform_listed_in_parse_errors(self, tmp_path):
        """regex_nodes 与 transforms 目录下的坏文件也计入 parse_errors。"""
        regex_dir = tmp_path / "regex_nodes"
        regex_dir.mkdir()
        (regex_dir / "bad.regex.yaml").write_text("pattern: [", encoding="utf-8")
        transforms_dir = tmp_path / "transforms"
        transforms_dir.mkdir()
        (transforms_dir / "bad.transform.yaml").write_text("type: {", encoding="utf-8")

        result = get_project_overview(str(tmp_path))

        assert {e["path"] for e in result["parse_errors"]} == {
            "regex_nodes/bad.regex.yaml",
            "transforms/bad.transform.yaml",
        }

    def test_good_and_bad_files_coexist_in_overview(self, tmp_path):
        """好文件正常入列、坏文件进 parse_errors，互不影响。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            "id: users\nname: users\ncolumns:\n  - id: id\n    name: id\n    type: integer\n",
            encoding="utf-8",
        )
        (schemas_dir / "broken.schema.yaml").write_text("\tbad: [", encoding="utf-8")

        result = get_project_overview(str(tmp_path))

        assert len(result["schemas"]) == 1
        assert result["schemas"][0]["name"] == "users"
        assert [e["path"] for e in result["parse_errors"]] == ["schemas/broken.schema.yaml"]

    def test_parse_error_summary_truncated_to_200_chars(self, tmp_path, monkeypatch):
        """超长错误摘要截断到 200 字符，防止撑爆概览。

        用 monkeypatch 替换 yaml.safe_load（外部解析器边界）抛超长异常，
        确定性构造 >200 字符的错误消息。
        """
        import yaml as yaml_module

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "evil.schema.yaml").write_text("id: x\n", encoding="utf-8")

        def fake_safe_load(f):
            raise ValueError("E" * 500)

        monkeypatch.setattr(yaml_module, "safe_load", fake_safe_load)

        result = get_project_overview(str(tmp_path))

        assert len(result["parse_errors"]) == 1
        entry = result["parse_errors"][0]
        assert entry["path"] == "schemas/evil.schema.yaml"
        assert len(entry["error"]) <= 203  # 200 截断 + "..." 后缀
        assert entry["error"].endswith("...")

    def test_orphan_schema_marked_unlisted(self, tmp_path):
        """孤儿文件（未登记 manifest）应标注 unlisted=True。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            "id: users\nname: users\ncolumns:\n  - id: id\n    name: id\n    type: integer\n",
            encoding="utf-8",
        )
        # 写一个 manifest，但不登记 users → users 成为孤儿
        (tmp_path / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: p\n  name: P\nschemas: []\n",
            encoding="utf-8",
        )

        result = get_project_overview(str(tmp_path))
        assert len(result["schemas"]) == 1
        assert result["schemas"][0]["unlisted"] is True

    def test_listed_schema_not_marked_unlisted(self, tmp_path):
        """登记到 manifest 的 schema 应标注 unlisted=False。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            "id: users\nname: users\ncolumns:\n  - id: id\n    name: id\n    type: integer\n",
            encoding="utf-8",
        )
        (tmp_path / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: p\n  name: P\nschemas:\n  - id: users\n    path: schemas/users.schema.yaml\n",
            encoding="utf-8",
        )

        result = get_project_overview(str(tmp_path))
        assert len(result["schemas"]) == 1
        assert result["schemas"][0]["unlisted"] is False

    def test_no_manifest_all_schemas_unlisted(self, tmp_path):
        """无 manifest 时，所有 schema 视为孤儿（unlisted=True）。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text("id: users\nname: users\ncolumns: []\n", encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        assert len(result["schemas"]) == 1
        assert result["schemas"][0]["unlisted"] is True

    # ============================================================
    # 严格校验失败（YAML 合法但结构损坏）透出
    # ============================================================

    def test_schema_missing_source_mode_listed_with_field_reason(self, tmp_path):
        """缺 source.mode 的 schema（历史 AI 写盘缺陷产物）进 parse_errors 且摘要含字段级原因。

        宽松 yaml.safe_load 读得出来、字段也挑得出来，但运行时 TableSchemaFile
        严格解析器拒绝该文件——概览必须同口径暴露，agent 才能识别并修复。
        """
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            "version: 2\nid: users\nname: users\nsource:\n  path: data/users.csv\n"
            "columns:\n  - id: c1\n    name: email\n    type: string\n",
            encoding="utf-8",
        )

        result = get_project_overview(str(tmp_path))

        assert [e["path"] for e in result["parse_errors"]] == ["schemas/users.schema.yaml"]
        # 摘要是单行首要字段级原因（与校验中止时 loading_errors 的原文一致，可跨信号对照）
        assert "source.mode" in result["parse_errors"][0]["error"]
        assert "Field required" in result["parse_errors"][0]["error"]

    def test_strict_broken_schema_still_listed_leniently(self, tmp_path):
        """严格校验失败的 schema 仍宽松入列（名称/列可见），只是额外记 parse_errors。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            "version: 2\nid: users\nname: users\nsource:\n  path: data/users.csv\n"
            "columns:\n  - id: c1\n    name: email\n    type: string\n",
            encoding="utf-8",
        )

        result = get_project_overview(str(tmp_path))

        assert [s["name"] for s in result["schemas"]] == ["users"]
        assert len(result["schemas"][0]["columns"]) == 1
        assert len(result["parse_errors"]) == 1

    def test_yaml_syntax_error_and_strict_failure_both_recorded(self, tmp_path):
        """YAML 语法错误与严格校验失败两类损坏都进 parse_errors，互不掩盖。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "syntax.schema.yaml").write_text("{{invalid yaml", encoding="utf-8")
        (schemas_dir / "semantic.schema.yaml").write_text(
            "version: 2\nid: sem\nname: sem\nsource:\n  path: data/sem.csv\ncolumns: []\n",
            encoding="utf-8",
        )

        result = get_project_overview(str(tmp_path))

        error_by_path = {e["path"]: e["error"] for e in result["parse_errors"]}
        assert set(error_by_path) == {"schemas/syntax.schema.yaml", "schemas/semantic.schema.yaml"}
        # 语法错误走 yaml 解析异常原文；语义损坏走严格校验摘要（含字段级原因）
        assert "source.mode" in error_by_path["schemas/semantic.schema.yaml"]
        assert "Field required" in error_by_path["schemas/semantic.schema.yaml"]

    def test_valid_files_across_kinds_produce_no_parse_errors(self, tmp_path):
        """四类配置文件都合法时零误报（严格校验不把好文件报坏）。"""
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            "version: 2\nid: users\nname: users\nsource:\n  mode: relative_file\n  path: data/users.csv\n"
            "columns:\n  - id: c1\n    name: email\n    type: string\n",
            encoding="utf-8",
        )
        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "nn_email.constraint.yaml").write_text(
            "version: 2\nid: nn_email\ntype: NotNull\nrefs:\n  table_id: users\n  column_id: email\n",
            encoding="utf-8",
        )
        regex_dir = tmp_path / "regex_nodes"
        regex_dir.mkdir()
        (regex_dir / "email.regex.yaml").write_text(
            'version: 2\nid: email_re\nname: email_re\npattern: "^.+@.+$"\n',
            encoding="utf-8",
        )
        transforms_dir = tmp_path / "transforms"
        transforms_dir.mkdir()
        (transforms_dir / "upper.transform.yaml").write_text(
            "version: 2\nid: upper\ntype: UpperCase\ninput_column: email\noutput_columns:\n  - email_upper\n",
            encoding="utf-8",
        )
        (tmp_path / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: p\n  name: P\nschemas:\n  - id: users\n    path: schemas/users.schema.yaml\n",
            encoding="utf-8",
        )

        result = get_project_overview(str(tmp_path))

        assert result["parse_errors"] == []
        assert len(result["schemas"]) == 1
        assert len(result["constraints"]) == 1
        assert len(result["regex_nodes"]) == 1
        assert len(result["transforms"]) == 1

    def test_broken_constraint_regex_transform_listed_with_field_reason(self, tmp_path):
        """constraint/regex/transform 的字段级损坏同样进 parse_errors（各自严格 File 模型）。"""
        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        # 缺 id 必填字段
        (constraints_dir / "noid.constraint.yaml").write_text(
            "version: 2\ntype: NotNull\nrefs:\n  table_id: users\n  column_id: email\n",
            encoding="utf-8",
        )
        regex_dir = tmp_path / "regex_nodes"
        regex_dir.mkdir()
        # pattern 与 uses_pattern 均缺失 → RegexNodeFile 模型校验失败
        (regex_dir / "nopattern.regex.yaml").write_text(
            "version: 2\nid: np\nname: np\nmatch_mode: full\n",
            encoding="utf-8",
        )
        transforms_dir = tmp_path / "transforms"
        transforms_dir.mkdir()
        # 未知转换类型字面量 → Literal 校验失败
        (transforms_dir / "badtype.transform.yaml").write_text(
            "version: 2\nid: bt\ntype: NotATransform\n",
            encoding="utf-8",
        )

        result = get_project_overview(str(tmp_path))

        error_by_path = {e["path"]: e["error"] for e in result["parse_errors"]}
        assert set(error_by_path) == {
            "constraints/noid.constraint.yaml",
            "regex_nodes/nopattern.regex.yaml",
            "transforms/badtype.transform.yaml",
        }
        assert "id" in error_by_path["constraints/noid.constraint.yaml"]
        assert "Field required" in error_by_path["constraints/noid.constraint.yaml"]
        # 模型级校验器（非字段级）的失败也以首要原因形式透出
        assert error_by_path["regex_nodes/nopattern.regex.yaml"]
