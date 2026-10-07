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

        # bad-rows 筛选惯用法：bad = df[df.col < 0]; assert bad.empty
        # → 实际约束是筛选条件的反义（col >= 0），见下方 invert 逻辑
        negated_selection = bool(re.search(r"assert\s+\w+\.empty", content))

        # 模式：df[df['col'] < 0] / df[df.col < 0]（筛选）与 df['col'] < 0 / df.col < 0（直接比较）。
        # 列引用的括号字符串形态必须完整闭合（['\"]col['\"]\]）：旧正则的 ['\"\] 只吞一个
        # 引号，']' 残留在操作符前导致 df['age'] < 0 整体漏匹配（mig-01 归因的真正根因）
        range_patterns = [
            (
                r"df\[(?:df\[['\"](\w+)['\"]\]|df\.(\w+))\s*([<>]=?)\s*([^\]\s)]+)",
                True,  # 筛选形态：受 bad-rows 反语义影响
            ),
            (
                r"(?:df\[['\"](\w+)['\"]\]|df\.(\w+))\s*([<>]=?)\s*([^\s)\]]+)",
                False,  # 直接比较形态
            ),
        ]
        seen_range_keys: set[tuple[str, str, str]] = set()
        for pattern, is_selection in range_patterns:
            for match in re.finditer(pattern, content):
                col = match.group(1) or match.group(2)
                if not col:
                    continue
                op = match.group(3)
                val = match.group(4).rstrip(",")
                # 两条模式对同一比较会重复命中，按 (列, 操作符, 值) 去重
                dedup_key = (col, op, val)
                if dedup_key in seen_range_keys:
                    continue
                seen_range_keys.add(dedup_key)
                # bad-rows 筛选 + assert empty：约束语义取反（< → 下界，> → 上界）
                invert = is_selection and negated_selection
                intent = {
                    "type": "Range",
                    "column": col,
                    "confidence": 0.8,
                    "description": f"Python 代码解析: {col} {op} {val}"
                    + ("（bad-rows 断言为空，约束取反义）" if invert else ""),
                }
                if ("<" in op) != invert:
                    intent["max"] = self._try_parse_number(val)
                if (">" in op) != invert:
                    intent["min"] = self._try_parse_number(val)
                intents.append(intent)

        # 模式：df.col.between(a, b) / df['col'].between(a, b)（闭区间双边界）
        for match in re.finditer(
            r"(?:df\[['\"](\w+)['\"]\]|df\.(\w+))\.between\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)", content
        ):
            col = match.group(1) or match.group(2)
            if not col:
                continue
            intents.append(
                {
                    "type": "Range",
                    "column": col,
                    "min": self._try_parse_number(match.group(3)),
                    "max": self._try_parse_number(match.group(4)),
                    "confidence": 0.85,
                    "description": f"Python between 解析: {col} in [{match.group(3)}, {match.group(4)}]",
                }
            )

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

        # 模式：df.col.is_unique / df['col'].is_unique（括号字符串列引用此前漏匹配）
        for match in re.finditer(r"(?:df\[['\"](\w+)['\"]\]|df\.(\w+))\.is_unique", content):
            intents.append(
                {
                    "type": "Unique",
                    "column": match.group(1) or match.group(2),
                    "confidence": 0.9,
                    "description": f"Python 唯一性检查: {match.group(1) or match.group(2)}",
                }
            )

        # 模式：df.col.isna() / df['col'].notna()（notna/isnull/notnull 同为空值检查）
        for match in re.finditer(r"(?:df\[['\"](\w+)['\"]\]|df\.(\w+))\.(?:isna|isnull|notna|notnull)\(\)", content):
            col = match.group(1) or match.group(2)
            intents.append(
                {
                    "type": "NotNull",
                    "column": col,
                    "confidence": 0.7,
                    "description": f"Python 空值检查: {col}",
                }
            )

        # 模式：df.col.isin([...]) / df['col'].isin([...])
        for match in re.finditer(r"(?:df\[['\"](\w+)['\"]\]|\.(\w+))\.isin\(\[(.*?)\]\)", content, re.DOTALL):
            col = match.group(1) or match.group(2)
            values_str = match.group(3)
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

        # 模式：df['col'].isin(variable) / df.col.isin(variable)——变量需在脚本中有列表字面量赋值
        variable_assignments = {
            m.group(1): m.group(2).strip()[1:-1] for m in re.finditer(r"(\w+)\s*=\s*(\[[^\]]*\])", content)
        }
        for match in re.finditer(r"(?:df\[['\"](\w+)['\"]\]|\.(\w+))\.isin\(\s*(\w+)\s*\)", content):
            col = match.group(1) or match.group(2)
            var = match.group(3)
            values_str = variable_assignments.get(var, "")
            values = [v.strip().strip("\"'") for v in re.split(r",\s*", values_str) if v.strip()]
            if not values:
                continue
            intents.append(
                {
                    "type": "AllowedValues",
                    "column": col,
                    "allowed_values": values,
                    "confidence": 0.8,
                    "description": f"Python 枚举值检查: {col} (isin {var})",
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
            # 惰性捕获 + 可选"列/字段"后缀：正则 alternation 优先级陷阱（A非空|不能为空
            # 会使捕获组失效返回 None）已修正，列名缺失时 LLM 仍可经画像兜底映射
            col_match = re.search(r"([\w\u4e00-\u9fa5]+?)\s*(?:列|字段|column)?\s*(?:非空|不能为空|必须填写)", content)
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
            col_match = re.search(r"([\w\u4e00-\u9fa5]+?)\s*(?:列|字段|column)?\s*(?:唯一|不能重复)", content)
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
                        # 同时给 allowed_values：config_builder 简化管线按该键提取 params
                        "allowed_values": values,
                        "values": values,
                        "confidence": 0.55,
                        "description": "自然语言：枚举约束",
                    }
                )

        # 字符集（如"昵称 nickname 列必须是中文混合字符集"、"备注只能含中文"、"code 列仅限 ASCII"）
        if re.search(r"字符集|只能含|只能包含|只能由|纯中文|纯英文|纯汉字|仅限\s*ascii", content, re.IGNORECASE):
            col_match = (
                re.search(r"([A-Za-z_]\w*)\s*(?:列|字段|column)", content)
                or re.search(r"([A-Za-z_]\w*)\s*(?:只能含|只能包含|只能由)", content)
                or re.search(r"([\w\u4e00-\u9fa5]+)\s*(?:列|字段)", content)
            )
            if re.search(r"混合|中英|英中", content):
                mode = "chinese_mixed"
            elif re.search(r"ascii|纯英文", content, re.IGNORECASE):
                mode = "ascii"
            else:
                mode = "chinese"
            intents.append(
                {
                    "type": "Charset",
                    "column": col_match.group(1) if col_match else "",
                    "charset_mode": mode,
                    "confidence": 0.6,
                    "description": f"自然语言：字符集约束（{mode}）",
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
