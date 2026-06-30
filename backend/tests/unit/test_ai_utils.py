"""
@fileoverview AI 服务工具函数单元测试

测试范围:
- estimate_tokens: Token 估算
- truncate_history_by_tokens: 历史截断
- get_project_overview: 项目概览扫描
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

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
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "bad.schema.yaml").write_text("{{invalid yaml", encoding="utf-8")

        result = get_project_overview(str(tmp_path))
        # Should not crash, just skip the bad file
        assert result["schemas"] == []

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
