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
"""@fileoverview 数据文件画像

读取数据文件的前 N 行，提取列名、数据类型、空值数和样本值，生成供
Prompt 构建与 Agent 任务消息使用的画像数据。纯数据加工逻辑，无 Provider
依赖；取消检查通过 is_cancelled 回调注入，保持模块无状态。
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .errors import CancelledError

logger = logging.getLogger(__name__)


@dataclass
class ProfilingOptions:
    """数据画像选项"""

    sample_rows: int = 100
    sample_values_per_column: int = 100
    max_files: int = 50
    max_cell_chars: int = 500


async def profile_files(
    file_paths: list[str], options: ProfilingOptions, is_cancelled: Callable[[], bool]
) -> list[dict]:
    """分析数据文件获取画像。

    读取各类数据文件的前 N 行，提取列名、数据类型、空值数和样本值。
    Excel 多 sheet 时每个 sheet 产出独立的 table 画像。

    参数:
        file_paths: 数据文件路径列表
        options: 画像选项（采样行数/每列样本数/文件数上限/单元格截断长度）
        is_cancelled: 取消状态探测回调，返回 True 时抛出 CancelledError

    返回:
        画像结果列表，每项含 path/table_name/sheet_name/columns
    """
    import pandas as pd

    results = []

    # 限制最多处理的文件数量
    for path in file_paths[: options.max_files]:
        if is_cancelled():
            raise CancelledError("Generation cancelled")
        if not os.path.exists(path):
            continue

        ext = os.path.splitext(path)[1].lower()
        # 使用文件名（不含扩展名）作为默认表名
        table_name = os.path.splitext(os.path.basename(path))[0]

        try:
            # 收集该文件的所有 sheets：(sheet_name, df) 列表。
            # Excel 可能多 sheet，每个 sheet 作为独立 table 画像；其他类型单 sheet（sheet_name=None）
            sheets: list[tuple[str | None, pd.DataFrame]] = []
            if ext in [".xlsx", ".xls"]:
                xl = pd.ExcelFile(path)
                if not xl.sheet_names:
                    continue
                # 读取所有 sheet（修复：原仅读 sheet_names[0]，多 sheet Excel 会丢数据）
                for sn in xl.sheet_names:
                    sheet_df = pd.read_excel(path, sheet_name=sn, nrows=options.sample_rows)
                    sheets.append((sn, sheet_df))
            elif ext == ".csv":
                df = pd.read_csv(path, nrows=options.sample_rows, encoding="utf-8")
                sheets.append((None, df))
            elif ext == ".json":
                # JSON 文件处理
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                # 处理嵌套结构
                if isinstance(data, dict):
                    # 查找数据记录数组
                    records = find_json_records(data)
                    if records:
                        df = pd.json_normalize(records)
                    else:
                        df = pd.json_normalize([data])
                elif isinstance(data, list):
                    df = pd.json_normalize(data)
                else:
                    continue
                # 限制行数
                sheets.append((None, df.head(options.sample_rows)))
            elif ext == ".jsonl":
                # JSON Lines 文件处理
                records = []
                with open(path, encoding="utf-8") as f:
                    for i, line in enumerate(f):
                        if i >= options.sample_rows:
                            break
                        line = line.strip()
                        if line:
                            records.append(json.loads(line))
                sheets.append((None, pd.json_normalize(records)))
            else:
                # 不支持的文件类型
                continue

            # 每个 sheet 独立构建画像结果（Excel 多 sheet 会产出多个 table 画像）
            multi_sheet = len(sheets) > 1
            for sheet_name, df in sheets:
                if df is None or df.empty:
                    continue
                # 分析列信息
                columns = []
                for col_name in df.columns:
                    if is_cancelled():
                        raise CancelledError("Generation cancelled")
                    col_data = df[col_name]

                    # 获取样本值（处理复杂类型如列表、字典）
                    # 使用 dict.fromkeys 保序去重，避免 list 的 O(n) in 查找导致的 O(n²) 开销
                    seen: dict[str, None] = {}
                    max_samples = options.sample_values_per_column
                    for v in col_data.dropna():
                        if len(seen) >= max_samples:
                            break
                        # 处理复杂类型并截断
                        v_str = str(v)[: options.max_cell_chars]
                        if v_str not in seen:
                            seen[v_str] = None
                    sample_values: list[str] = list(seen.keys())

                    columns.append(
                        {
                            "name": str(col_name),
                            "dtype": str(col_data.dtype),
                            "null_count": int(col_data.isna().sum()),
                            "sample_values": sample_values,
                        }
                    )

                # 多 sheet Excel 时用 "文件名_sheet名" 作为 table_name 区分，避免多表同名
                effective_table_name = f"{table_name}_{sheet_name}" if (multi_sheet and sheet_name) else table_name
                result = {
                    "path": path,
                    "table_name": effective_table_name,
                    "sheet_name": sheet_name,
                    "columns": columns,
                }
                results.append(result)

        except Exception as e:
            # 读取失败，记录警告并跳过，不影响其他文件的处理。
            # 注意：与原实现一致，列循环内取消抛出的 CancelledError 也会走到这里被记为
            # 警告跳过——取消最终由调用方的阶段边界检查（_check_cancelled）兜底。
            logger.warning(f"无法分析文件 {path}: {e}")
            continue

    return results


def find_json_records(data: dict) -> list[dict] | None:
    """在嵌套 JSON 对象中查找数据记录数组。

    策略：递归遍历 JSON 的所有节点，找到最长的、元素为字典的数组。

    参数:
        data: 已解析的 JSON 对象

    返回:
        最长的记录数组；不存在时返回 None
    """
    best_array = None
    best_length = 0

    def search(obj: Any) -> None:
        nonlocal best_array, best_length

        if isinstance(obj, dict):
            for key, value in obj.items():
                if isinstance(value, list):
                    # 检查是否是数据记录数组（元素是字典）
                    if value and isinstance(value[0], dict):
                        if len(value) > best_length:
                            best_length = len(value)
                            best_array = value
                    # 继续搜索数组内部（处理嵌套列表）
                    for item in value:
                        if isinstance(item, (dict, list)):
                            search(item)
                elif isinstance(value, (dict, list)):
                    search(value)
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    search(item)

    search(data)
    return best_array


def filter_profiling(
    profiling_data: list[dict],
    table_names: list[str] | None,
    columns_filter: list[str] | None,
) -> list[dict]:
    """根据 scope 过滤画像数据。

    参数:
        profiling_data: 完整画像数据
        table_names: 表名白名单，None 表示不过滤表
        columns_filter: 列过滤，支持 "table.column" 或裸列名，None 表示不过滤列

    返回:
        过滤后的画像数据（浅拷贝，columns 为新列表）
    """
    result = []
    table_col_map: dict[str, list[str]] = {}
    if columns_filter:
        for tc in columns_filter:
            if "." in tc:
                t, c = tc.split(".", 1)
                table_col_map.setdefault(t, []).append(c)
            else:
                table_col_map.setdefault("", []).append(tc)

    for item in profiling_data:
        table_name = item.get("table_name", "")
        if table_names and table_name not in table_names:
            continue

        columns = item.get("columns", [])
        if columns_filter:
            allowed = set(table_col_map.get(table_name, []) + table_col_map.get("", []))
            if allowed:
                columns = [c for c in columns if c.get("name", "") in allowed]

        if columns:
            filtered = dict(item)
            filtered["columns"] = columns
            result.append(filtered)
    return result


def format_profiling_for_agent(profiling_data: list[dict]) -> str:
    """将画像数据格式化为 Agent 任务消息中的文本段落。"""
    lines = []
    for item in profiling_data:
        table_name = item.get("table_name", "")
        lines.append(f"### {table_name}")
        lines.append(f"文件: {item.get('path', '')}")
        if item.get("sheet_name"):
            lines.append(f"Sheet: {item['sheet_name']}")
        for col in item.get("columns", []):
            samples = col.get("sample_values", [])[:3]
            samples_str = ", ".join(str(s)[:30] for s in samples)
            line = f"- {col['name']}: {col['dtype']}, 空值{col['null_count']}"
            if samples_str:
                line += f", 例: {samples_str}"
            lines.append(line)
    return "\n".join(lines)
