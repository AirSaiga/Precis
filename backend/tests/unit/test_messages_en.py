# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 英文错误文案模块（messages_en）单元测试

覆盖两类断言：
1. render_message_en 行为：正常渲染 / 缺参回退 None / 未知 code 回退 None；
2. 完整性守卫：正则扫描 domain/constraints/ 源码中实际 emit 的全部 error_code，
   断言每个 code 都登记了英文模板，且模板占位符名与源码 error_params 键一致。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.shared.domain.constraints.messages_en import ERROR_MESSAGES_EN, _template_placeholders, render_message_en

# domain/constraints 源码目录（code 完整性守卫扫描目标）
_CONSTRAINTS_DIR = Path(__file__).resolve().parents[2] / "app" / "shared" / "domain" / "constraints"
# 占位符键守卫额外纳入的来源：服务层校验器/编排层（error_code 同语义错误也流入同一通道）
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "app" / "shared" / "services" / "validation" / "validators"
_VALIDATION_DIR = Path(__file__).resolve().parents[2] / "app" / "shared" / "services" / "validation"
# 流水线级错误码的 emit 点位（超时/中断/空数据/加载失败），占位符键守卫一并扫描
_PIPELINE_SOURCES = ("service.py", "engine.py", "executor.py", "data_loader.py")

# 两种 emit 形态：字典字面量 "error_code": "XXX" 与局部变量赋值 error_code = "XXX"（range.py）
_CODE_PATTERNS = [
    re.compile(r'"error_code":\s*"([A-Z][A-Z0-9_]*)"'),
    re.compile(r'\berror_code\s*=\s*"([A-Z][A-Z0-9_]*)"'),
]
# error_params 字典字面量块（含跨行），用于收集源码中出现过的参数键全集；
# 两种形态：字典内嵌 "error_params": {...} 与局部变量赋值 error_params = {...}（range.py）
_PARAMS_PATTERN = re.compile(r'"error_params":\s*\{(.*?)\}', re.DOTALL)
_PARAMS_ASSIGN_PATTERN = re.compile(r"\berror_params\s*=\s*\{(.*?)\}", re.DOTALL)
_PARAM_KEY_PATTERN = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)"\s*:')


def _scan_emitted_codes() -> set[str]:
    """扫描 domain/constraints/ 全部源码，返回实际 emit 的 error_code 全集。"""
    codes: set[str] = set()
    for py_file in sorted(_CONSTRAINTS_DIR.glob("*.py")):
        source = py_file.read_text(encoding="utf-8")
        for pattern in _CODE_PATTERNS:
            codes.update(pattern.findall(source))
    return codes


def _scan_param_keys() -> set[str]:
    """收集源码中全部 error_params 块出现过的参数键名（跨校验器并集）。"""
    sources = [*(sorted(_CONSTRAINTS_DIR.glob("*.py"))), *(sorted(_VALIDATORS_DIR.glob("*.py")))]
    # 流水线级 emit 点位（executor/engine/data_loader/service），逐个存在性检查后纳入
    for name in _PIPELINE_SOURCES:
        pipeline_file = _VALIDATION_DIR / name
        if pipeline_file.exists():
            sources.append(pipeline_file)
    keys: set[str] = set()
    for py_file in sources:
        source = py_file.read_text(encoding="utf-8")
        for pattern in (_PARAMS_PATTERN, _PARAMS_ASSIGN_PATTERN):
            for block in pattern.findall(source):
                keys.update(_PARAM_KEY_PATTERN.findall(block))
    return keys


class TestRenderMessageEn:
    """render_message_en 渲染与回退行为"""

    def test_render_with_full_params(self):
        result = render_message_en("NOT_NULL_VALUE_EMPTY", {"column": "amount"})
        assert result == "NotNull constraint violation: column 'amount' must not be empty."

    def test_render_fk_violation(self):
        result = render_message_en(
            "FK_VIOLATION",
            {"value": "X1", "from_table": "a", "from_column": "k", "to_table": "b", "to_column": "id"},
        )
        assert result is not None
        assert "X1" in result and "b" in result

    def test_missing_param_returns_none(self):
        # 占位符缺参必须回退 None，不得输出残缺英文
        assert render_message_en("NOT_NULL_VALUE_EMPTY", {}) is None
        assert render_message_en("NOT_NULL_VALUE_EMPTY", None) is None
        # 提供多余参数不影响渲染
        assert render_message_en("NOT_NULL_VALUE_EMPTY", {"column": "c", "extra": 1}) is not None

    def test_unknown_code_returns_none(self):
        assert render_message_en("TOTALLY_UNKNOWN_CODE", {"x": 1}) is None

    def test_none_code_returns_none(self):
        assert render_message_en(None, None) is None
        assert render_message_en("", {}) is None

    def test_no_placeholder_template_renders_without_params(self):
        # 无占位符模板在 params 为 None/空时也可渲染
        assert render_message_en("RANGE_NO_BOUNDS", None) is not None
        assert render_message_en("UNIQUE_CONFIG_NO_COLUMNS", {}) is not None

    def test_param_value_non_str_is_coerced(self):
        # 数值参数经 format 正常字符串化（渲染异常安全回退的实现细节）
        result = render_message_en("RANGE_VALUE_BELOW_MIN", {"value": -5, "op": ">=", "min": 0})
        assert result is not None and "-5" in result


class TestCompletenessGuard:
    """完整性守卫：源码 emit 的每个 error_code 都必须有英文模板且占位符一致"""

    def test_every_emitted_code_has_template(self):
        emitted = _scan_emitted_codes()
        assert emitted, "扫描结果为空说明正则失效，守卫本身需要修复"
        missing = emitted - set(ERROR_MESSAGES_EN)
        assert not missing, f"以下 error_code 缺少英文模板：{sorted(missing)}"

    def test_every_template_placeholder_matches_source_params(self):
        """模板占位符名必须与源码 error_params 键一致（防手写模板时拼错键名）。"""
        source_keys = _scan_param_keys()
        for code, template in ERROR_MESSAGES_EN.items():
            for placeholder in _template_placeholders(template):
                assert placeholder in source_keys, (
                    f"{code} 模板占位符 '{placeholder}' 未在 domain/constraints 源码的 error_params 键中出现"
                )

    def test_templates_render_with_own_placeholders(self):
        """每个模板用自身占位符填充后可成功渲染（自洽性）。"""
        for code, template in ERROR_MESSAGES_EN.items():
            params: dict[str, Any] = {name: "x" for name in _template_placeholders(template)}
            rendered = render_message_en(code, params)
            assert rendered is not None, f"{code} 用自身占位符填充仍渲染失败"
            assert "{" not in rendered.replace("{{", ""), f"{code} 渲染结果残留未替换占位符：{rendered}"
