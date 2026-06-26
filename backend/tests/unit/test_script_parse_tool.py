"""@fileoverview ScriptParseTool 单元测试

覆盖 Python / SQL / Excel / 自然语言解析。
"""

from __future__ import annotations

from app.shared.services.ai.agent.tools.script_parse import ScriptParseTool


def test_parse_python_range():
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "invalid = df[df.age < 0]",
            "language": "python",
        }
    )
    assert result["success"] is True
    intents = result["intents"]
    assert any(i["type"] == "Range" and i.get("column") == "age" for i in intents)


def test_parse_python_unique():
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "assert df.user_id.is_unique",
            "language": "python",
        }
    )
    assert result["success"] is True
    assert any(i["type"] == "Unique" and i["column"] == "user_id" for i in result["intents"])


def test_parse_python_regex():
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "df.email.str.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')",
            "language": "python",
        }
    )
    assert result["success"] is True
    assert any(i["type"] == "Regex" and i["column"] == "email" for i in result["intents"])


def test_parse_sql_not_null():
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "CREATE TABLE users (age INT NOT NULL, email VARCHAR(255) NOT NULL);",
            "language": "sql",
        }
    )
    assert result["success"] is True
    columns = [i["column"] for i in result["intents"] if i["type"] == "NotNull"]
    assert "age" in columns
    assert "email" in columns


def test_parse_sql_check_range():
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "ALTER TABLE users ADD CONSTRAINT chk_age CHECK (age > 0);",
            "language": "sql",
        }
    )
    assert result["success"] is True
    assert any(i["type"] == "Range" and i.get("min") == 0 for i in result["intents"])


def test_parse_natural_language_not_null():
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "用户名列不能为空",
            "language": "natural_language",
        }
    )
    assert result["success"] is True
    assert any(i["type"] == "NotNull" for i in result["intents"])


def test_parse_natural_language_range():
    """自然语言范围约束识别。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "年龄列在 0-120 之间",
            "language": "natural_language",
        }
    )
    assert result["success"] is True
    range_intents = [i for i in result["intents"] if i["type"] == "Range"]
    assert len(range_intents) == 1
    assert range_intents[0]["min"] == 0
    assert range_intents[0]["max"] == 120


def test_parse_natural_language_allowed_values():
    """自然语言枚举约束识别。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "状态列只能是 A、B、C",
            "language": "natural_language",
        }
    )
    assert result["success"] is True
    enum_intents = [i for i in result["intents"] if i["type"] == "AllowedValues"]
    assert len(enum_intents) == 1
    assert set(enum_intents[0]["values"]) == {"A", "B", "C"}


def test_parse_empty_script():
    tool = ScriptParseTool(service=None)
    result = tool.run({"script_content": "   ", "language": "python"})
    assert result["success"] is False
    assert "为空" in result["error"]
