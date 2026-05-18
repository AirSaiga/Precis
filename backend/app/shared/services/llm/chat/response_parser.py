"""
@fileoverview LLM 响应解析器模块

功能概述:
- 解析 LLM 返回的 JSON 响应文本（健壮版本）
- 支持多种格式：标准 JSON、Markdown 代码块、单引号伪 JSON、截断 JSON
- 验证响应格式和动作有效性
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.shared.services.llm.yaml_io import ActionParseError

logger = logging.getLogger(__name__)


class ActionParser:
    """LLM 响应动作解析器。"""

    VALID_CONSTRAINT_TYPES = [
        "NotNull",
        "Unique",
        "AllowedValues",
        "Range",
        "ForeignKey",
        "Conditional",
        "Scripted",
        "DateLogic",
        "NOT_NULL",
        "UNIQUE",
        "REGEX",
        "ALLOWED_VALUES",
        "RANGE",
        "FOREIGN_KEY",
        "CONDITIONAL",
        "DATE_LOGIC",
    ]
    VALID_ACTION_TYPES = [
        "ADD_CONSTRAINT_NODE",
        "UPDATE_CONSTRAINT_NODE",
        "DELETE_CONSTRAINT_NODE",
        "VALIDATE_PROJECT",
    ]

    @staticmethod
    def parse_llm_response(response_text: str) -> dict[str, Any]:
        if not response_text or not response_text.strip():
            raise ActionParseError("响应文本为空")

        original_text = response_text.strip()
        parse_attempts = [
            ("直接解析", lambda t: t),
            ("清理 Markdown", ActionParser._clean_json_text),
            ("提取 JSON 块", ActionParser._extract_json_block),
            ("修复单引号", ActionParser._fix_single_quotes),
            ("截断恢复", ActionParser._try_recover_truncated),
        ]

        last_error = None
        for attempt_name, cleaner in parse_attempts:
            try:
                cleaned = cleaner(original_text)
                if not cleaned:
                    continue
                parsed = json.loads(cleaned)
                if isinstance(parsed, dict):
                    if attempt_name != "直接解析":
                        logger.debug(f"JSON 解析成功使用策略: {attempt_name}")
                    return parsed
            except (json.JSONDecodeError, ValueError) as e:
                last_error = e
                continue
            except Exception as e:
                logger.debug(f"解析策略 '{attempt_name}' 失败: {e}")
                continue

        logger.error(f"原始文本前 500 字符: {original_text[:500]}")
        raise ActionParseError(f"无法解析 AI 响应: {last_error}") from last_error

    @staticmethod
    def _clean_json_text(text: str) -> str:
        text = text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            if len(lines) >= 2:
                text = "\n".join(lines[1:])
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        return text

    @staticmethod
    def _extract_json_block(text: str) -> str:
        text = text.strip()
        code_block_pattern = r"```(?:json)?\s*\n?(.*?)\n?```"
        matches = re.findall(code_block_pattern, text, re.DOTALL)
        if matches:
            return max(matches, key=len).strip()
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and first_brace < last_brace:
            return text[first_brace : last_brace + 1]
        first_bracket = text.find("[")
        last_bracket = text.rfind("]")
        if first_bracket != -1 and last_bracket != -1 and first_bracket < last_bracket:
            return text[first_bracket : last_bracket + 1]
        return text

    @staticmethod
    def _fix_single_quotes(text: str) -> str:
        text = ActionParser._extract_json_block(text)

        def replace_quotes(match):
            content = match.group(1)
            if '"' not in content:
                return f'"{content}"'
            return match.group(0)

        return re.sub(r"'([^']*)'", replace_quotes, text)

    @staticmethod
    def _try_recover_truncated(text: str) -> str:
        text = text.strip()
        open_braces = text.count("{") - text.count("}")
        open_brackets = text.count("[") - text.count("]")
        result = text
        if open_braces > 0:
            result += "}" * open_braces
        if open_brackets > 0:
            result += "]" * open_brackets
        if result.count('"') % 2 == 1:
            last_quote = result.rfind('"')
            if last_quote > 0:
                for char in [",", ":", "{", "[", " "]:
                    pos = result.rfind(char, 0, last_quote)
                    if pos > 0:
                        result = result[: pos + 1]
                        break
        return result

    @staticmethod
    def validate_response(response: dict[str, Any]) -> bool:
        if "reply" not in response:
            return False
        if "actions" not in response:
            return False
        actions = response.get("actions", [])
        if actions is None:
            response["actions"] = []
            actions = []
        elif not isinstance(actions, list):
            return False
        for action in actions:
            if not ActionParser._validate_action(action):
                return False
        return True

    @staticmethod
    def _validate_action(action: dict[str, Any]) -> bool:
        if not isinstance(action, dict):
            return False
        if "actionType" not in action:
            return False
        action_type = action.get("actionType")
        if action_type not in ActionParser.VALID_ACTION_TYPES:
            return False
        if action_type == "VALIDATE_PROJECT":
            return True
        if "constraintSpec" not in action:
            return False
        spec = action.get("constraintSpec", {})
        if spec.get("type") not in ActionParser.VALID_CONSTRAINT_TYPES:
            return False
        return True

    @staticmethod
    def parse_actions(llm_response: dict[str, Any]) -> list[dict[str, Any]]:
        actions = llm_response.get("actions", [])
        if not isinstance(actions, list):
            return []
        return [a for a in actions if ActionParser._validate_action(a)]

    @staticmethod
    def extract_reply(llm_response: dict[str, Any]) -> str:
        return llm_response.get("reply", "")
