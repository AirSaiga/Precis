"""@fileoverview generation service JSON 提取单元测试

覆盖 _find_json_object_end 的字符串感知大括号配平扫描，以及
_parse_response / _try_parse_config_from_content 对"字符串值含 }"的
合法 JSON 的完整解析（缺陷修复点：旧实现按裸字符配平会截断合法 JSON）。
"""

from __future__ import annotations

from app.shared.services.llm.generation.service import ConfigGenerationService, _find_json_object_end


class TestFindObjectEnd:
    def test_simple_object(self):
        text = '{"a": 1}'
        assert _find_json_object_end(text, 0) == len(text) - 1

    def test_nested_object(self):
        text = '{"a": {"b": 1}}'
        assert _find_json_object_end(text, 0) == len(text) - 1

    def test_close_brace_inside_string_not_counted(self):
        """字符串值含 '}' 时不参与配平：{"a":"x}y"} 的闭括号在末尾而非字符串内。"""
        text = '{"a": "x}y"}'
        assert _find_json_object_end(text, 0) == len(text) - 1

    def test_open_brace_inside_string_not_counted(self):
        text = '{"a": "x{y"}'
        assert _find_json_object_end(text, 0) == len(text) - 1

    def test_escaped_quote_inside_string(self):
        """字符串内含 \\" 转义时字符串边界判断正确。"""
        text = '{"a": "say \\"hi\\" } ok"}'
        assert _find_json_object_end(text, 0) == len(text) - 1

    def test_escaped_backslash_before_closing_quote(self):
        """字符串以转义反斜杠（\\\\）结尾时，其后引号仍是字符串边界。"""
        text = '{"a": "b\\\\", "c": 1}'
        assert _find_json_object_end(text, 0) == len(text) - 1

    def test_unbalanced_returns_none(self):
        assert _find_json_object_end('{"a": 1', 0) is None

    def test_scans_from_given_start(self):
        text = '前缀 {"a": "x}y"}'
        start = text.find("{")
        assert _find_json_object_end(text, start) == len(text) - 1


class TestParseResponse:
    def _service(self) -> ConfigGenerationService:
        return ConfigGenerationService()

    def test_string_value_containing_close_brace(self):
        """字符串含 '}' 的合法 JSON 必须完整解析，不得截断成 {"a":"x}。"""
        parsed = self._service()._parse_response('前言 {"a": "x}y"} 后记')
        assert parsed == {"a": "x}y"}

    def test_code_fence_with_brace_in_string(self):
        parsed = self._service()._parse_response('```json\n{"a": "x}y"}\n```')
        assert parsed == {"a": "x}y"}

    def test_nested_config_with_brace_in_string(self):
        content = '{"schemas": {"users": {"note": "range 0-100} 精度"}}, "constraints": {}}'
        parsed = self._service()._parse_response(content)
        assert parsed == {"schemas": {"users": {"note": "range 0-100} 精度"}}, "constraints": {}}

    def test_trailing_text_after_json(self):
        parsed = self._service()._parse_response('{"a": 1}\n这是解释文本')
        assert parsed == {"a": 1}

    def test_no_json_raises_parse_error(self):
        import pytest

        from app.shared.services.llm.generation.service import GenerationParseError

        with pytest.raises(GenerationParseError):
            self._service()._parse_response("完全没有 JSON")


class TestTryParseConfigFromContent:
    def test_string_value_containing_close_brace(self, monkeypatch):
        """_try_parse_config_from_content 对含 '}' 的字符串值 JSON 同样完整解析。"""
        from app.shared.services.llm.generation import service as service_module

        captured: dict = {}

        def fake_build_config(**kwargs):
            captured["llm_result"] = kwargs["llm_result"]
            return {"built": True}

        monkeypatch.setattr(service_module, "build_config", fake_build_config)
        svc = service_module.ConfigGenerationService()

        result = svc._try_parse_config_from_content('{"a": "x}y"}')

        assert result == {"built": True}
        # 截断后的 {"a":"x} 无法 json.loads，只有完整解析才会把该 dict 传给 build_config
        assert captured["llm_result"] == {"a": "x}y"}

    def test_returns_none_without_json(self):
        svc = ConfigGenerationService()
        assert svc._try_parse_config_from_content("no json here") is None
        assert svc._try_parse_config_from_content(None) is None

    def test_returns_none_when_unbalanced(self):
        svc = ConfigGenerationService()
        assert svc._try_parse_config_from_content('{"a": "x}y"') is None
