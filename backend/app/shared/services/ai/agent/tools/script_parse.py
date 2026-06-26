"""@fileoverview 旧脚本解析工具

Agent 可调用的工具：解析 Python pandas / 自然语言 / Excel 公式等旧检查逻辑，
输出结构化的规则意图（RuleIntent）。
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


class ScriptParseTool:
    """
    @classdesc 旧脚本解析工具

    解析用户已有的数据检查逻辑，转换为规则意图。
    """

    NAME = "parse_script"

    def __init__(self, service: Any):
        """
        @methoddesc 初始化工具

        参数:
            service: ConfigGenerationService 实例（用于调用 LLM）
        """
        self.service = service

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": "解析旧脚本或自然语言描述，输出结构化的规则意图。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "script_content": {
                            "type": "string",
                            "description": "脚本内容或自然语言描述",
                        },
                        "language": {
                            "type": "string",
                            "enum": ["python", "natural_language", "excel_formula", "sql"],
                            "description": "脚本类型",
                        },
                        "context": {
                            "type": "string",
                            "description": "可选上下文，如目标表名、列名",
                        },
                    },
                    "required": ["script_content", "language"],
                },
            },
        }

    def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行脚本解析

        参数:
            arguments: tool 参数

        返回:
            {"success": bool, "intents": [...], "error": str}
        """
        script_content = arguments.get("script_content", "")
        language = arguments.get("language", "natural_language")
        context = arguments.get("context", "")

        if not script_content.strip():
            return {"success": False, "error": "脚本内容为空"}

        try:
            if language == "python":
                intents = self._parse_python(script_content, context)
            elif language == "excel_formula":
                intents = self._parse_excel(script_content, context)
            elif language == "sql":
                intents = self._parse_sql(script_content, context)
            else:
                intents = self._parse_natural_language(script_content, context)

            return {"success": True, "intents": intents}
        except Exception as e:
            logger.exception("脚本解析失败")
            return {"success": False, "error": f"脚本解析失败: {e}"}

    def _parse_python(self, content: str, context: str) -> list[dict[str, Any]]:
        """解析 Python pandas 代码。"""
        intents: list[dict[str, Any]] = []

        # 模式：df[df.col < 0]
        range_patterns = [
            (r"df\[(?:df\[['\"](\w+)['\"\]]|df\.(\w+))\s*[<>]=?\s*([^\]]+)\]", "Range"),
            (r"(?:df\[['\"](\w+)['\"\]]|df\.(\w+))\s*[<>]=?\s*([^\n]+)", "Range"),
        ]
        for pattern, ctype in range_patterns:
            for match in re.finditer(pattern, content):
                col = match.group(1) or match.group(2)
                val = match.group(3).strip()
                op = match.group(0)[match.start(3) - match.start(0) : match.start(3) - match.start(0) + 1]
                intent = {
                    "type": ctype,
                    "column": col,
                    "confidence": 0.8,
                    "description": f"Python 代码解析: {col} {op} {val}",
                }
                if "<" in op:
                    intent["max"] = self._try_parse_number(val)
                if ">" in op:
                    intent["min"] = self._try_parse_number(val)
                intents.append(intent)

        # 模式：df.col.str.match(pattern) 或 df['col'].str.match(pattern)
        regex_patterns = [
            r"df\.\(\w+\)\.str\.(?:match|contains)\(r?['\"]([^'\"]+)['\"]\)",
            r"df\[(['\"])(\w+)\1\]\.str\.(?:match|contains)\(r?['\"]([^'\"]+)['\"]\)",
            r"df\.(\w+)\.str\.(?:match|contains)\(r?['\"]([^'\"]+)['\"]\)",
            r"re\.match\(r?['\"]([^'\"]+)['\"]",
        ]
        for pattern in regex_patterns:
            for match in re.finditer(pattern, content):
                groups = match.groups()
                if len(groups) >= 2 and groups[0] in ("'", '"'):
                    # df['col'].str... pattern: groups=(quote, col, pattern)
                    col = groups[1]
                    pattern_str = groups[2] if len(groups) >= 3 else groups[1]
                elif len(groups) >= 2:
                    # df.col.str... pattern: groups=(col, pattern)
                    col = groups[0]
                    pattern_str = groups[1]
                else:
                    col = ""
                    pattern_str = groups[0]
                intents.append(
                    {
                        "type": "Regex",
                        "column": col,
                        "pattern": pattern_str,
                        "confidence": 0.75,
                        "description": f"Python 正则解析: {pattern_str}",
                    }
                )

        # 模式：df.col.is_unique
        if re.search(r"\.(\w+)\.is_unique", content):
            for match in re.finditer(r"\.(\w+)\.is_unique", content):
                intents.append(
                    {
                        "type": "Unique",
                        "column": match.group(1),
                        "confidence": 0.9,
                        "description": f"Python 唯一性检查: {match.group(1)}",
                    }
                )

        # 模式：df.col.isna().sum()
        if re.search(r"\.(\w+)\.isna\(\)", content):
            for match in re.finditer(r"\.(\w+)\.isna\(\)", content):
                intents.append(
                    {
                        "type": "NotNull",
                        "column": match.group(1),
                        "confidence": 0.7,
                        "description": f"Python 空值检查: {match.group(1)}",
                    }
                )

        # 模式：df.col.isin([...])
        for match in re.finditer(r"\.(\w+)\.isin\(\[(.*?)\]\)", content, re.DOTALL):
            col = match.group(1)
            values_str = match.group(2)
            values = [v.strip().strip("\"'") for v in re.split(r",\s*", values_str) if v.strip()]
            intents.append(
                {
                    "type": "AllowedValues",
                    "column": col,
                    "allowed_values": values,
                    "confidence": 0.85,
                    "description": f"Python 枚举值检查: {col}",
                }
            )

        return intents

    def _parse_excel(self, content: str, context: str) -> list[dict[str, Any]]:
        """解析 Excel 公式/数据验证。"""
        intents: list[dict[str, Any]] = []

        # 数据验证：列表
        for match in re.finditer(r"allow\s*=\s*['\"]list['\"]", content, re.IGNORECASE):
            intents.append(
                {
                    "type": "AllowedValues",
                    "confidence": 0.7,
                    "description": "Excel 列表验证",
                }
            )

        # 公式：=AND(A1>0, A1<100)
        range_match = re.search(r"([A-Z]+\d*)\s*[<>]=?\s*(-?\d+(?:\.\d+)?)", content)
        if range_match:
            intents.append(
                {
                    "type": "Range",
                    "column": range_match.group(1),
                    "confidence": 0.7,
                    "description": f"Excel 范围验证: {range_match.group(0)}",
                }
            )

        return intents

    def _parse_sql(self, content: str, context: str) -> list[dict[str, Any]]:
        """解析 SQL DDL 约束。"""
        intents: list[dict[str, Any]] = []

        # NOT NULL
        for match in re.finditer(r"(\w+)\s+\S+\s+NOT\s+NULL", content, re.IGNORECASE):
            intents.append(
                {
                    "type": "NotNull",
                    "column": match.group(1),
                    "confidence": 0.9,
                    "description": f"SQL NOT NULL: {match.group(1)}",
                }
            )

        # CHECK (age > 0)
        for match in re.finditer(r"CHECK\s*\(\s*(\w+)\s*([<>]=?)\s*([^\)]+)\)", content, re.IGNORECASE):
            col = match.group(1)
            op = match.group(2)
            val = match.group(3).strip()
            intent = {
                "type": "Range",
                "column": col,
                "confidence": 0.85,
                "description": f"SQL CHECK: {col} {op} {val}",
            }
            if "<" in op:
                intent["max"] = self._try_parse_number(val)
            if ">" in op:
                intent["min"] = self._try_parse_number(val)
            intents.append(intent)

        # UNIQUE
        for match in re.finditer(r"UNIQUE\s*\(\s*([^\)]+)\s*\)", content, re.IGNORECASE):
            cols = [c.strip() for c in match.group(1).split(",")]
            intents.append(
                {
                    "type": "Unique",
                    "column": cols[0],
                    "column_ids": cols,
                    "confidence": 0.9,
                    "description": f"SQL UNIQUE: {', '.join(cols)}",
                }
            )

        return intents

    def _parse_natural_language(self, content: str, context: str) -> list[dict[str, Any]]:
        """解析自然语言描述（当前为关键词正则匹配，LLM 兜底待实现）。

        当前实现基于关键词正则匹配（非空/唯一/范围/枚举等常见表述），
        置信度固定为 0.6（低于结构化语言的 0.7~0.9）。
        未来可增强为：正则置信度低时调用 LLM 做语义解析，需将本方法异步化并接入 provider。
        """
        intents: list[dict[str, Any]] = []

        # 非空
        if re.search(r"非空|不能为空|必须填写", content):
            col_match = re.search(r"([\w\u4e00-\u9fa5]+)\s*(?:列|字段|column)?\s*非空|不能为空", content)
            intents.append(
                {
                    "type": "NotNull",
                    "column": col_match.group(1) if col_match else "",
                    "confidence": 0.6,
                    "description": "自然语言：非空约束",
                }
            )

        # 唯一
        if re.search(r"唯一|不能重复|去重", content):
            col_match = re.search(r"([\w\u4e00-\u9fa5]+)\s*(?:列|字段|column)?\s*唯一|不能重复", content)
            intents.append(
                {
                    "type": "Unique",
                    "column": col_match.group(1) if col_match else "",
                    "confidence": 0.6,
                    "description": "自然语言：唯一约束",
                }
            )

        # 范围（如"年龄在 0-120 之间"、"金额大于 0"）
        range_match = re.search(
            r"([\w\u4e00-\u9fa5]+)\s*(?:列|字段)?\s*(?:在|介于)?\s*(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)",
            content,
        )
        if range_match:
            intents.append(
                {
                    "type": "Range",
                    "column": range_match.group(1),
                    "min": float(range_match.group(2)),
                    "max": float(range_match.group(3)),
                    "confidence": 0.6,
                    "description": "自然语言：范围约束",
                }
            )

        # 枚举（如"状态只能是 A、B、C"）
        enum_match = re.search(r"([\w\u4e00-\u9fa5]+)\s*(?:列|字段)?\s*(?:只能|必须)是\s*([^，。,\.]+)", content)
        if enum_match and "、" in enum_match.group(2):
            values = [v.strip() for v in enum_match.group(2).split("、") if v.strip()]
            if len(values) >= 2:
                intents.append(
                    {
                        "type": "AllowedValues",
                        "column": enum_match.group(1),
                        "values": values,
                        "confidence": 0.55,
                        "description": "自然语言：枚举约束",
                    }
                )

        return intents

    @staticmethod
    def _try_parse_number(text: str) -> int | float | str:
        """尝试解析数字。"""
        text = text.strip()
        try:
            if "." in text:
                return float(text)
            return int(text)
        except ValueError:
            return text
