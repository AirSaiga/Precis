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


def test_parse_python_bracket_string_comparison():
    """括号字符串列引用的比较形态（df['age'] < 0）此前整体漏匹配（mig-01 根因回归）。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "assert (df['age'] >= 0).all()",
            "language": "python",
        }
    )
    assert result["success"] is True
    ranges = [i for i in result["intents"] if i["type"] == "Range" and i["column"] == "age"]
    assert len(ranges) == 1
    assert ranges[0]["min"] == 0


def test_parse_python_bad_rows_selection_inverted():
    """bad-rows 惯用法（bad = df[df['age'] < 0]; assert bad.empty）约束语义取反：min=0。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "bad = df[df['age'] < 0]\nassert bad.empty",
            "language": "python",
        }
    )
    assert result["success"] is True
    ranges = [i for i in result["intents"] if i["type"] == "Range" and i["column"] == "age"]
    assert len(ranges) == 1
    assert ranges[0].get("min") == 0
    assert "max" not in ranges[0]


def test_parse_python_between():
    """df['col'].between(a, b) 解析为双边界 Range（mig-12 用例）。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "assert df['age'].between(0, 120).all()",
            "language": "python",
        }
    )
    assert result["success"] is True
    ranges = [i for i in result["intents"] if i["type"] == "Range" and i["column"] == "age"]
    assert len(ranges) == 1
    assert ranges[0]["min"] == 0
    assert ranges[0]["max"] == 120


def test_parse_python_bracket_unique_and_notna():
    """括号字符串列引用的 is_unique / notna 此前漏匹配（mig-04 用例）。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "assert df['id'].is_unique\nassert df['name'].notna().all()",
            "language": "python",
        }
    )
    assert result["success"] is True
    assert any(i["type"] == "Unique" and i["column"] == "id" for i in result["intents"])
    assert any(i["type"] == "NotNull" and i["column"] == "name" for i in result["intents"])


def test_parse_python_isin_literal_and_variable():
    """isin 列表字面量与变量引用（变量需有列表赋值）都解析为 AllowedValues。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": (
                "valid = ['pending', 'shipped', 'done']\n"
                "assert df['status'].isin(valid).all()\n"
                "assert df['state'].isin(['a', 'b']).all()"
            ),
            "language": "python",
        }
    )
    assert result["success"] is True
    by_col = {i["column"]: i for i in result["intents"] if i["type"] == "AllowedValues"}
    assert by_col["status"]["allowed_values"] == ["pending", "shipped", "done"]
    assert by_col["state"]["allowed_values"] == ["a", "b"]


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
    # allowed_values 同步携带：config_builder 简化管线按该键提取 params
    assert set(enum_intents[0]["allowed_values"]) == {"A", "B", "C"}


def test_parse_natural_language_charset_chinese_mixed():
    """自然语言字符集约束识别：中文混合（mig-08 根因回归）。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "昵称 nickname 列必须是中文混合字符集，姓名 name 不能为空。",
            "language": "natural_language",
        }
    )
    assert result["success"] is True
    charset_intents = [i for i in result["intents"] if i["type"] == "Charset"]
    assert len(charset_intents) == 1
    assert charset_intents[0]["column"] == "nickname"
    assert charset_intents[0]["charset_mode"] == "chinese_mixed"
    # 同句中的非空约束仍正常识别
    assert any(i["type"] == "NotNull" and i["column"] == "name" for i in result["intents"])


def test_parse_natural_language_charset_chinese_only():
    """自然语言"只能含中文"识别为 chinese 模式。"""
    tool = ScriptParseTool(service=None)
    result = tool.run(
        {
            "script_content": "remark 只能含中文",
            "language": "natural_language",
        }
    )
    assert result["success"] is True
    charset_intents = [i for i in result["intents"] if i["type"] == "Charset"]
    assert len(charset_intents) == 1
    assert charset_intents[0]["column"] == "remark"
    assert charset_intents[0]["charset_mode"] == "chinese"


def test_parse_empty_script():
    tool = ScriptParseTool(service=None)
    result = tool.run({"script_content": "   ", "language": "python"})
    assert result["success"] is False
    assert "为空" in result["error"]
