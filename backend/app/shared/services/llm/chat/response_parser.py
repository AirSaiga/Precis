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
        "Charset",
        "DateLogic",
        "Composite",
        "NOT_NULL",
        "UNIQUE",
        "REGEX",
        "ALLOWED_VALUES",
        "RANGE",
        "FOREIGN_KEY",
        "CONDITIONAL",
        "DATE_LOGIC",
        "CHARSET",
        "COMPOSITE",
    ]

    VALID_TRANSFORM_TYPES = [
        "StringSplit",
        "RegexExtract",
        "MathExpr",
        "DateFormat",
        "Lookup",
        "Strip",
        "UpperCase",
        "LowerCase",
        "Replace",
        "FillNA",
        "FilterRows",
        "DropDuplicates",
        "CastType",
        "Concat",
        "Substring",
        "Aggregate",
        "ConditionalAssign",
        "SortRows",
        "Digits",
        "WeightedSum",
        "Modulo",
        "MapValue",
    ]

    VALID_ACTION_TYPES = [
        # 约束操作
        "ADD_CONSTRAINT_NODE",
        "UPDATE_CONSTRAINT_NODE",
        "DELETE_CONSTRAINT_NODE",
        # Schema 操作
        "ADD_SCHEMA",
        "UPDATE_SCHEMA",
        "DELETE_SCHEMA",
        # Regex 操作
        "ADD_REGEX",
        "UPDATE_REGEX",
        "DELETE_REGEX",
        # Transform 操作
        "ADD_TRANSFORM",
        "UPDATE_TRANSFORM",
        "DELETE_TRANSFORM",
        # 项目设置
        "UPDATE_SETTINGS",
        # 校验
        "VALIDATE_PROJECT",
    ]

    @staticmethod
    def parse_llm_response(response_text: str) -> dict[str, Any]:
        """
        @methoddesc 解析 LLM 响应文本为结构化字典

        业务用途:
        - 接收 LLM 返回的原始字符串，依次尝试 5 种解析策略：
          直接解析 → 清理 Markdown → 提取 JSON 块 → 修复单引号 → 截断恢复
        - 只要任一策略成功即返回结果；全部失败抛出 ActionParseError

        参数:
            response_text: LLM 原始响应文本

        返回:
            解析后的字典

        异常:
            ActionParseError: 响应文本为空或所有策略都失败
        """
        if not response_text or not response_text.strip():
            raise ActionParseError("响应文本为空")

        original_text = response_text.strip()
        parse_attempts = [
            ("直接解析", lambda t: t),
            ("清理 Markdown", ActionParser._clean_json_text),
            ("提取 JSON 块", ActionParser._extract_json_block),
            ("修复单引号", ActionParser._fix_single_quotes),
            ("截断恢复", lambda t: ActionParser._try_recover_truncated(t)[0]),
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
        """
        @methoddesc 清理 Markdown 包裹

        业务用途:
        - 去除 ```json ... ``` 或 ``` ... ``` 的 Markdown 代码块包裹
        - 不处理 Markdown 内部的内容

        参数:
            text: 原始文本

        返回:
            去除 Markdown 包裹后的文本
        """
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
        """
        @methoddesc 从文本中提取 JSON 块

        业务用途:
        - 优先匹配 ```json ... ``` 或 ``` ... ``` 包裹的代码块
        - 若无代码块，则提取最外层的 { } 或 [ ] 子串
        - 用于处理 LLM 在 JSON 外附带解释文字的场景

        参数:
            text: 原始文本

        返回:
            提取出的 JSON 文本
        """
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
        """
        @methoddesc 将 JSON 中的单引号替换为双引号

        业务用途:
        - 部分 LLM 会输出 Python 风格单引号 JSON（标准 JSON 要求双引号）
        - 仅在内容中不包含双引号时才替换，避免破坏正常字段

        参数:
            text: 原始文本

        返回:
            修复单引号后的文本
        """
        text = ActionParser._extract_json_block(text)

        def replace_quotes(match):
            content = match.group(1)
            if '"' not in content:
                return f'"{content}"'
            return match.group(0)

        return re.sub(r"'([^']*)'", replace_quotes, text)

    @staticmethod
    def _try_recover_truncated(text: str) -> tuple[str, bool]:
        """
        @methoddesc 尝试恢复被 LLM 截断的 JSON 响应

        业务用途:
        - 当 LLM 输出超过 token 限制被截断时，自动补全缺失的 }, ], "
        - 启发式策略：补齐未闭合的大括号/方括号；若引号成奇数，则截断到最近的 , : { [ 之后

        参数:
            text: 截断的文本

        返回:
            (恢复后的文本, 是否进行了恢复) 二元组
        """
        text = text.strip()
        open_braces = text.count("{") - text.count("}")
        open_brackets = text.count("[") - text.count("]")
        result = text
        recovered = False
        if open_braces > 0:
            result += "}" * open_braces
            recovered = True
        if open_brackets > 0:
            result += "]" * open_brackets
            recovered = True
        if result.count('"') % 2 == 1:
            last_quote = result.rfind('"')
            if last_quote > 0:
                for char in [",", ":", "{", "[", " "]:
                    pos = result.rfind(char, 0, last_quote)
                    if pos > 0:
                        result = result[: pos + 1]
                        recovered = True
                        break
        if recovered:
            logger.warning("[ResponseParser] 响应被截断，已自动恢复。恢复后的内容可能与 LLM 原始输出不同。")
        return result, recovered

    @staticmethod
    def validate_response(response: dict[str, Any]) -> bool:
        """
        @methoddesc 校验解析后的响应字典结构

        业务用途:
        - 确保 response 包含必要的 "reply" 和 "actions" 字段
        - 若 actions 缺失或为 None，则规范化为空列表
        - 调用方可基于校验结果决定是否进入后续动作执行

        参数:
            response: 解析后的字典（会被就地修改）

        返回:
            True 表示通过校验
        """
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
        if action_type == "UPDATE_SETTINGS":
            return True
        # 约束操作需要 constraintSpec
        if action_type in ("ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"):
            if "constraintSpec" not in action:
                return False
            spec = action.get("constraintSpec", {})
            if spec.get("type") not in ActionParser.VALID_CONSTRAINT_TYPES:
                return False
            return True
        # Schema/Regex/Transform 操作需要各自的 spec
        if action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA"):
            return "schemaSpec" in action
        if action_type == "DELETE_SCHEMA":
            return "schemaSpec" in action
        if action_type in ("ADD_REGEX", "UPDATE_REGEX"):
            return "regexSpec" in action
        if action_type == "DELETE_REGEX":
            return "regexSpec" in action
        if action_type in ("ADD_TRANSFORM", "UPDATE_TRANSFORM"):
            return "transformSpec" in action
        if action_type == "DELETE_TRANSFORM":
            return "transformSpec" in action
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
