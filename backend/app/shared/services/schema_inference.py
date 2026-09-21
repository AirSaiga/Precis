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
"""@fileoverview 数据文件 → Schema YAML 推断服务（headless infer_schema）

功能概述:
- 读取 CSV/Excel/JSON 数据文件的头部样本，推断每列的 V2 数据类型
- 产出可直接落盘的 schema 文件内容（dict 形式，YAML 序列化由调用方决定）
- 供 CLI 子命令 `precis infer-schema` 与 MCP tool `infer_schema` 复用

推断规则（按列，忽略空值）:
- 全部可解析为整数 → integer
- 全部可解析为有限浮点（含整数）→ float
- 全部为 true/false 字面量 → boolean
- 全部为 ISO 日期（YYYY-MM-DD）→ date
- 其余（含混合类型、全空列）→ string

已知能力缺口（2026-09-21 审计成文）:
- 推断永不产出 decimal——V2 类型系统含 decimal（精确数值），但头部采样
  无法可靠区分"需要精确十进制"与"普通浮点"（如金额 0.1 与科学计数），
  盲目提升会造成误判。需要 decimal 的列请手工改 schema 类型；
  后续如支持，需引入启发式（如全部字面量 ≤2 位小数且无科学计数法）评估

设计说明:
- CSV/Excel 以 dtype=str 读入，避免 pandas 预转换掩盖原始格式
  （"1.0" 与 "1" 的区别、日期字符串等）；JSON 值为原生类型，
  分类器同时接受 str 与原生标量
- 只采样头部（默认 1000 行）控制大文件成本；类型冲突按保守回退 string
"""

from __future__ import annotations

import json
import math
import re
import uuid
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd

# V2 支持的 6 种数据类型（与 backend schema 类型定义一致）
DATA_TYPES = ("string", "integer", "float", "decimal", "boolean", "date")

# 支持的输入扩展名
_CSV_EXTS = {".csv"}
_EXCEL_EXTS = {".xlsx", ".xls"}
_JSON_EXTS = {".json", ".jsonl"}

# boolean 字面量集合（大小写不敏感）
_BOOL_LITERALS = {"true", "false"}

# 严格日期形态：YYYY-MM-DD（下游 DateType 校验格式）
_STRICT_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

# 默认采样行数
DEFAULT_SAMPLE_ROWS = 1000


def _classify_value(value: Any) -> str | None:
    """对单个非空值做候选类型判定。

    Args:
        value: 单元格值（str 或 JSON 原生标量）

    Returns:
        候选类型（string/integer/float/boolean/date）；无法判定返回 string
    """
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        # 非有限浮点（NaN/Inf）不能作为类型证据
        return "float" if math.isfinite(value) else "string"

    text = str(value).strip()
    if not text:
        return None
    if text.lower() in _BOOL_LITERALS:
        return "boolean"
    # 整数：可选符号的纯数字
    if _is_int_text(text):
        return "integer"
    # 浮点：排除 nan/inf 等非有限字面量
    try:
        parsed = float(text)
        if math.isfinite(parsed):
            return "float"
    except ValueError:
        pass
    # 日期：严格 YYYY-MM-DD 形态（下游 DateType 按 %Y-%m-%d 校验）。
    # 不直接用 fromisoformat 宽松集——Python>=3.11 还接受 ISO 周日期
    # （2025-W01-1）、紧凑格式（20250115）等，推成 date 后下游整列误报
    if _STRICT_DATE_RE.fullmatch(text):
        try:
            date.fromisoformat(text)
            return "date"
        except ValueError:
            pass
    return "string"


def _is_int_text(text: str) -> bool:
    """判断字符串是否为整数文本（允许前后符号）。"""
    body = text[1:] if text[:1] in "+-" else text
    return body.isdigit() and len(body) > 0


def infer_column_type(values: list[Any], dominant_ratio: float = 0.9) -> str:
    """对一列采样值推断 V2 类型。

    规则：
    1. 全部非空值同属一类 → 该类型（integer/float 合并时 float 优先提升）
    2. 否则若单一数值/日期/布尔候选占比 >= dominant_ratio → 采信该候选
       （数据中的少量脏值正是校验要抓的问题，不应把整列拖回 string）
    3. 其余（含混合类型、全空列）→ string

    Args:
        values: 该列的非空采样值列表
        dominant_ratio: 主导类型采信阈值（占非空值的比例）

    Returns:
        6 种 V2 类型之一；空列表（全空列）返回 string（安全默认）
    """
    counts: dict[str, int] = {}
    total = 0
    for value in values:
        candidate = _classify_value(value)
        if candidate is None:
            continue
        total += 1
        counts[candidate] = counts.get(candidate, 0) + 1
    if total == 0:
        return "string"

    def _ratio(kind: str) -> float:
        return counts.get(kind, 0) / total

    # 数值合并视角：integer 与 float 同属数值，浮点出现则整列提升 float
    numeric_count = counts.get("integer", 0) + counts.get("float", 0)
    if numeric_count == total:
        return "float" if counts.get("float") else "integer"
    if _ratio("boolean") == 1.0:
        return "boolean"
    if _ratio("date") == 1.0:
        return "date"

    # 主导采信：少量脏值不拖垮整列（如 17 行里 1 个非法日期）
    if numeric_count >= dominant_ratio * total:
        return "float" if counts.get("float") else "integer"
    for kind in ("boolean", "date"):
        if _ratio(kind) >= dominant_ratio:
            return kind
    return "string"


def _read_head(data_file: Path, sample_rows: int) -> pd.DataFrame:
    """按扩展名读取数据文件头部样本。

    CSV/Excel 以 dtype=str 读入保留原始格式；JSON 解析原生类型。
    JSONL（.jsonl / 逐行 JSON 对象）按行解析。

    Args:
        data_file: 数据文件路径
        sample_rows: 采样行数上限

    Returns:
        采样 DataFrame（空数据返回空 DataFrame）

    Raises:
        ValueError: 文件不存在或不支持的扩展名
    """
    if not data_file.exists():
        raise ValueError(f"数据文件不存在: {data_file}")

    suffix = data_file.suffix.lower()
    try:
        if suffix in _CSV_EXTS:
            return pd.read_csv(data_file, dtype=str, nrows=sample_rows, keep_default_na=True)
        if suffix in _EXCEL_EXTS:
            # 2026-09-21：Excel 走 nrows 头部截断（此前整体读入后取头部，
            # 大文件在推断场景被全量物化——MCP infer_schema 可被任意数据文件触发）
            return pd.read_excel(data_file, dtype=str, nrows=sample_rows)
        if suffix in _JSON_EXTS:
            return _read_json_head(data_file, sample_rows)
    except pd.errors.EmptyDataError as e:
        raise ValueError(f"数据文件无表头或无数据行，无法推断 schema: {data_file}") from e
    raise ValueError(f"不支持的文件扩展名: {suffix}（支持 CSV/Excel/JSON）")


def _read_json_head(data_file: Path, sample_rows: int) -> pd.DataFrame:
    """读取 JSON（对象数组）或 JSONL（逐行对象）头部样本。

    JSONL 按行流式截断（凑满 sample_rows 即停，不把大文件全文读入）；
    .json 顶层对象数组无法部分解析，仅对结果截断。
    """
    if data_file.suffix.lower() == ".jsonl":
        records: list[Any] = []
        with data_file.open(encoding="utf-8") as f:
            for line in f:
                if len(records) >= sample_rows:
                    break
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        return pd.DataFrame(records)
    text = data_file.read_text(encoding="utf-8")
    data = json.loads(text)
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise ValueError(f"JSON 顶层必须是对象数组: {data_file}")
    return pd.DataFrame(data).head(sample_rows)


def infer_schema(
    data_file: str | Path,
    sample_rows: int = DEFAULT_SAMPLE_ROWS,
    table_id: str | None = None,
    table_name: str | None = None,
    source_path: str | None = None,
) -> dict[str, Any]:
    """推断数据文件的 V2 schema 结构。

    Args:
        data_file: 数据文件路径
        sample_rows: 类型推断的采样行数上限
        table_id: 表 ID（默认生成 UUID v4；替换既有 schema 时传入原 id 保持引用不变）
        table_name: 表显示名（默认取文件名去扩展名）
        source_path: 写入 schema 的 source.path（默认为 data_file 原样路径）

    Returns:
        schema 文件结构的字典（version/id/name/source/columns），
        经 yaml.safe_dump 即可落盘为合法 *.schema.yaml

    Raises:
        ValueError: 文件不存在、扩展名不支持或无任何列可推断
    """
    path = Path(data_file)
    df = _read_head(path, sample_rows)

    if df.empty or len(df.columns) == 0:
        raise ValueError(f"数据文件无表头或无数据行，无法推断 schema: {data_file}")

    columns: list[dict[str, Any]] = []
    for col in df.columns:
        # 逐列收集非空采样值后推断类型
        non_null = [v for v in df[col].tolist() if v is not None and not (isinstance(v, float) and math.isnan(v))]
        columns.append(
            {
                "id": str(col),
                "name": str(col),
                "type": infer_column_type(non_null),
            }
        )

    return {
        "version": 2,
        "id": table_id or str(uuid.uuid4()),
        "name": table_name or path.stem,
        "source": {
            "mode": "relative_file",
            "path": source_path if source_path is not None else str(data_file),
        },
        "columns": columns,
    }
