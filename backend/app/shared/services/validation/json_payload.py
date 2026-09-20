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
"""@fileoverview 校验结果 → JSON 契约 payload（CLI 与 MCP 共用单一事实源）

契约文档：docs/contracts/validate-json-v1.md（v1 已冻结，只增不减）。
本模块是 `_build_json_payload` 结构的唯一实现：
- CLI `--format json` 的 stdout 输出
- MCP tool `validate_data` 的返回值
- `--report` 报告导出的数据源
三处消费同一结构，禁止分叉出第二套输出格式。
"""

from __future__ import annotations

import math
from collections.abc import Sized
from typing import Any

# JSON 输出契约的版本号（未来契约演进时递增）
JSON_SCHEMA_VERSION = 1


def json_safe_value(value: Any) -> Any:
    """将校验错误中的单元格值转换为 JSON 可序列化的原生类型。

    pandas 校验链路可能透出 numpy 标量（int64/float64 等）与非有限浮点
    （NaN/Inf），两者均非合法 JSON。numpy 标量经 .item() 归一为 Python
    原生类型；非有限浮点转为字符串保留诊断信息。

    Args:
        value: 错误条目中的任意取值

    Returns:
        JSON 可序列化的值（None/bool/int/有限 float/str）
    """
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        # np.float64 是 float 子类可直接命中；NaN/Inf 不是合法 JSON，转字符串
        return value if math.isfinite(value) else str(value)
    if hasattr(value, "item"):
        # numpy 标量统一经 .item() 归一后再递归判定
        try:
            return json_safe_value(value.item())
        except (AttributeError, ValueError):
            pass
    # 兜底：其余类型（如 dict/list 以外的对象）转字符串，保证不破坏序列化
    return str(value)


def build_json_payload(result: dict) -> dict:
    """将 ValidationExecutor.execute() 的结果转换为 JSON 输出契约结构。

    契约字段必须齐全，无法取到的值填 null：
    - tables 来自 validation_details.format_checks（表显示名），
      行数优先取 raw_datasets 中的 DataFrame 长度，分块模式取 row_count
    - summary 来自 validation_details.constraint_checks 的 passed 统计
    - errors 中 table/column/constraint_type(check_type)/constraint_file
      由校验链路提供（constraint_file 由 executor 挂载，见 P0-3）
    - loading_errors 原样透传为 loading_warnings

    Args:
        result: ValidationExecutor.execute() 返回的结果字典

    Returns:
        符合契约 v1 的字典（可直接 json.dumps）
    """
    errors = result.get("errors", [])
    validation_details = result.get("validation_details") or {}
    constraint_checks = validation_details.get("constraint_checks") or []
    format_checks = validation_details.get("format_checks") or []
    raw_datasets = result.get("raw_datasets") or {}

    tables: list[dict[str, Any]] = []
    for check in format_checks:
        # postprocess 已把 table 换成显示名并保留原 ID 到 table_id；
        # raw_datasets 以表 ID 为键，优先按 ID 查（显示名与 ID 不同时也能命中行数）
        dataset = raw_datasets.get(check.get("table_id") or check.get("table"))
        rows: int | None = None
        if isinstance(dataset, dict):
            # 分块模式下 raw_datasets 值为 {"chunk_count": ..., "row_count": ...}
            rows = dataset.get("row_count")
        elif isinstance(dataset, Sized):
            # 标准模式下值为 DataFrame，行数即长度
            rows = len(dataset)
        tables.append({"name": check.get("table"), "rows": rows})

    constraints_total = len(constraint_checks)
    constraints_failed = sum(1 for check in constraint_checks if not check.get("passed", True))

    error_entries: list[dict[str, Any]] = []
    for error in errors:
        # 格式错误携带 cell_value/error_message；域约束错误携带 value/message，做双字段兼容
        cell_value = error.get("cell_value") if "cell_value" in error else error.get("value")
        error_message = error.get("error_message") if error.get("error_message") is not None else error.get("message")
        error_entries.append(
            {
                "table": error.get("table"),
                "column": error.get("column"),
                "constraint_type": error.get("check_type"),
                "constraint_file": error.get("constraint_file"),
                "row_index": error.get("row_index"),
                "cell_value": json_safe_value(cell_value),
                "error_message": error_message,
                # 可选修复建议（AllowedValues 相近值 / 日期布局提示等），生成器未给则为 null
                "suggestion": error.get("suggestion"),
            }
        )

    return {
        "schema_version": JSON_SCHEMA_VERSION,
        "is_valid": not errors,
        "interrupted": bool(result.get("interrupted", False)),
        "duration_ms": result.get("duration_ms", 0),
        "tables": tables,
        "summary": {
            "constraints_total": constraints_total,
            "constraints_passed": constraints_total - constraints_failed,
            "constraints_failed": constraints_failed,
        },
        "errors": error_entries,
        "loading_warnings": result.get("loading_errors", []),
    }
