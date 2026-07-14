"""
@fileoverview LLM 响应解析器单元测试

测试范围:
- ActionParser.parse_llm_response: JSON 解析策略链
- ActionParser._clean_json_text: Markdown 清理
- ActionParser._extract_json_block: JSON 块提取
- ActionParser._fix_single_quotes: 单引号修复
- ActionParser._try_recover_truncated: 截断恢复
- ActionParser.validate_response: 响应格式验证
- ActionParser._validate_action: 动作验证
- ActionParser.parse_actions: 动作过滤
- ActionParser.extract_reply: 回复提取
"""

import pytest

from app.shared.services.llm.chat.response_parser import ActionParser
from app.shared.services.llm.yaml_io import ActionParseError


class TestParseLLMResponse:
    def test_standard_json(self):
        text = '{"reply": "hello", "actions": []}'
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "hello"
        assert result["actions"] == []

    def test_markdown_code_block(self):
        text = '```json\n{"reply": "hi", "actions": []}\n```'
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "hi"

    def test_markdown_without_json_tag(self):
        text = '```\n{"reply": "x", "actions": []}\n```'
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "x"

    def test_text_before_json(self):
        text = 'Here is the response:\n{"reply": "ok", "actions": []}'
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "ok"

    def test_single_quotes(self):
        text = "{'reply': 'hello', 'actions': []}"
        result = ActionParser.parse_llm_response(text)
        assert result["reply"] == "hello"

    def test_truncated_json_recovery(self):
        # Truncated JSON that can be recovered by closing braces/brackets
        text = '{"reply": "hello", "data": {"key": "val"'
        result = ActionParser.parse_llm_response(text)
        assert "reply" in result

    def test_empty_text_raises(self):
        with pytest.raises(ActionParseError, match="响应文本为空"):
            ActionParser.parse_llm_response("")

    def test_whitespace_only_raises(self):
        with pytest.raises(ActionParseError, match="响应文本为空"):
            ActionParser.parse_llm_response("   ")

    def test_invalid_json_raises(self):
        with pytest.raises(ActionParseError, match="无法解析"):
            ActionParser.parse_llm_response("not json at all {{{")

    def test_non_dict_json_raises(self):
        # A valid JSON but not a dict
        with pytest.raises(ActionParseError):
            ActionParser.parse_llm_response('"just a string"')

    def test_list_json_raises(self):
        with pytest.raises(ActionParseError):
            ActionParser.parse_llm_response("[1, 2, 3]")


class TestCleanJsonText:
    def test_removes_markdown_fences(self):
        text = '```json\n{"key": "value"}\n```'
        result = ActionParser._clean_json_text(text)
        assert result == '{"key": "value"}'

    def test_removes_fence_without_tag(self):
        text = '```\n{"key": "value"}\n```'
        result = ActionParser._clean_json_text(text)
        assert result == '{"key": "value"}'

    def test_plain_text_unchanged(self):
        text = '{"key": "value"}'
        result = ActionParser._clean_json_text(text)
        assert result == text

    def test_single_line_fence(self):
        text = '```json\n{"a": 1}\n```'
        result = ActionParser._clean_json_text(text)
        assert result == '{"a": 1}'


class TestExtractJsonBlock:
    def test_from_code_block(self):
        text = 'Some text\n```json\n{"a": 1}\n```\nMore text'
        result = ActionParser._extract_json_block(text)
        assert result == '{"a": 1}'

    def test_from_braces(self):
        text = 'prefix {"a": 1} suffix'
        result = ActionParser._extract_json_block(text)
        assert result == '{"a": 1}'

    def test_from_brackets(self):
        text = "prefix [1, 2, 3] suffix"
        result = ActionParser._extract_json_block(text)
        assert result == "[1, 2, 3]"

    def test_no_json_returns_text(self):
        text = "no json here"
        result = ActionParser._extract_json_block(text)
        assert result == text


class TestFixSingleQuotes:
    def test_single_to_double_quotes(self):
        text = "{'key': 'value'}"
        result = ActionParser._fix_single_quotes(text)
        assert '"' in result
        assert "'" not in result or result.count("'") == 0

    def test_already_double_quotes(self):
        text = '{"key": "value"}'
        result = ActionParser._fix_single_quotes(text)
        assert result == text


class TestTryRecoverTruncated:
    def test_balanced_json(self):
        text = '{"a": 1}'
        result, recovered = ActionParser._try_recover_truncated(text)
        assert recovered is False
        assert result == text

    def test_missing_closing_brace(self):
        text = '{"a": 1'
        result, recovered = ActionParser._try_recover_truncated(text)
        assert recovered is True
        assert result.endswith("}")

    def test_missing_closing_bracket(self):
        text = '{"a": [1, 2'
        result, recovered = ActionParser._try_recover_truncated(text)
        assert recovered is True

    def test_odd_quotes(self):
        text = '{"a": "hello'
        result, recovered = ActionParser._try_recover_truncated(text)
        assert recovered is True


class TestValidateResponse:
    def test_valid_response(self):
        response = {"reply": "hello", "actions": []}
        assert ActionParser.validate_response(response) is True

    def test_missing_reply(self):
        response = {"actions": []}
        assert ActionParser.validate_response(response) is False

    def test_missing_actions(self):
        response = {"reply": "hello"}
        assert ActionParser.validate_response(response) is False

    def test_none_actions_becomes_empty(self):
        response = {"reply": "hello", "actions": None}
        assert ActionParser.validate_response(response) is True
        assert response["actions"] == []

    def test_actions_not_list(self):
        response = {"reply": "hello", "actions": "not a list"}
        assert ActionParser.validate_response(response) is False

    def test_valid_constraint_action(self):
        response = {
            "reply": "ok",
            "actions": [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {"type": "NotNull"},
                }
            ],
        }
        assert ActionParser.validate_response(response) is True

    def test_invalid_action_type(self):
        response = {
            "reply": "ok",
            "actions": [{"actionType": "INVALID_TYPE"}],
        }
        assert ActionParser.validate_response(response) is False

    def test_validate_project_action(self):
        response = {"reply": "ok", "actions": [{"actionType": "VALIDATE_PROJECT"}]}
        assert ActionParser.validate_response(response) is True

    def test_update_settings_action(self):
        response = {"reply": "ok", "actions": [{"actionType": "UPDATE_SETTINGS"}]}
        assert ActionParser.validate_response(response) is True

    def test_constraint_missing_spec(self):
        response = {
            "reply": "ok",
            "actions": [{"actionType": "ADD_CONSTRAINT_NODE"}],
        }
        assert ActionParser.validate_response(response) is False

    def test_constraint_invalid_type(self):
        response = {
            "reply": "ok",
            "actions": [{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "InvalidType"}}],
        }
        assert ActionParser.validate_response(response) is False

    def test_schema_action_needs_spec(self):
        assert ActionParser.validate_response(
            {"reply": "ok", "actions": [{"actionType": "ADD_SCHEMA", "schemaSpec": {}}]}
        )
        assert not ActionParser.validate_response({"reply": "ok", "actions": [{"actionType": "ADD_SCHEMA"}]})

    def test_regex_action_needs_spec(self):
        assert ActionParser.validate_response(
            {"reply": "ok", "actions": [{"actionType": "ADD_REGEX", "regexSpec": {}}]}
        )
        assert not ActionParser.validate_response({"reply": "ok", "actions": [{"actionType": "ADD_REGEX"}]})

    def test_transform_action_needs_spec(self):
        assert ActionParser.validate_response(
            {"reply": "ok", "actions": [{"actionType": "ADD_TRANSFORM", "transformSpec": {}}]}
        )
        assert not ActionParser.validate_response({"reply": "ok", "actions": [{"actionType": "ADD_TRANSFORM"}]})

    def test_delete_schema_needs_spec(self):
        assert not ActionParser.validate_response({"reply": "ok", "actions": [{"actionType": "DELETE_SCHEMA"}]})

    def test_delete_regex_needs_spec(self):
        assert not ActionParser.validate_response({"reply": "ok", "actions": [{"actionType": "DELETE_REGEX"}]})

    def test_delete_transform_needs_spec(self):
        assert not ActionParser.validate_response({"reply": "ok", "actions": [{"actionType": "DELETE_TRANSFORM"}]})

    def test_action_not_dict(self):
        response = {"reply": "ok", "actions": ["not a dict"]}
        assert ActionParser.validate_response(response) is False

    def test_action_missing_action_type(self):
        response = {"reply": "ok", "actions": [{"foo": "bar"}]}
        assert ActionParser.validate_response(response) is False

    def test_all_valid_constraint_types(self):
        for ctype in ActionParser.VALID_CONSTRAINT_TYPES[:10]:
            response = {
                "reply": "ok",
                "actions": [{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": ctype}}],
            }
            assert ActionParser.validate_response(response) is True, f"Failed for {ctype}"


class TestParseActions:
    def test_filters_valid_actions(self):
        response = {
            "actions": [
                {"actionType": "VALIDATE_PROJECT"},
                {"actionType": "INVALID"},
                {"actionType": "UPDATE_SETTINGS"},
            ]
        }
        result = ActionParser.parse_actions(response)
        assert len(result) == 2

    def test_empty_actions(self):
        assert ActionParser.parse_actions({"actions": []}) == []

    def test_no_actions_key(self):
        assert ActionParser.parse_actions({}) == []

    def test_actions_not_list(self):
        assert ActionParser.parse_actions({"actions": "bad"}) == []


class TestExtractReply:
    def test_extracts_reply(self):
        assert ActionParser.extract_reply({"reply": "hello"}) == "hello"

    def test_missing_reply(self):
        assert ActionParser.extract_reply({}) == ""
