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
"""
@fileoverview Excel 数据源加载器模块

功能概述:
- 加载 .xlsx / .xls 格式 Excel 文件为 pandas DataFrame
- 支持单 sheet 加载（load）和多 sheet 批量加载（load_multi_sheet）
- 空文件提前检查，给出清晰的 DataLoadError（B13）
- header_row 配置错误检测：若 header_row 之后无数据行则输出警告（B10）
- 使用 openpyxl 前向填充合并单元格，消除 NotNull/Unique 假阳性（B7）
- 支持 dtype_inference、skip_rows、nrows 等参数（B9）

架构设计:
- 继承 DataSourceLoader[ExcelSourceSpec]，通过注册表自动发现
- load() 针对单 sheet，返回单个 DataFrame
- load_multi_sheet() 针对项目多表场景，返回 {schema_id: DataFrame}
- _apply_merged_cell_fill() 为 openpyxl 级别的合并单元格填充逻辑

输入示例:
    spec = ExcelSourceSpec(
        path="data/users.xlsx",
        sheet="Sheet1",
        header_row=0,
        dtype_inference=True
    )
    loader = ExcelLoader(spec)

输出示例:
    df = loader.load()
    # 返回 pandas.DataFrame，合并单元格已按 Excel 显示值填充
    # 若 sheet 不存在则抛出 DataLoadError（B8）
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd

from ..specs.excel_source import ExcelSourceSpec
from .base import DataLoadError, DataSourceLoader
from .registry import register_loader

logger = logging.getLogger(__name__)

# 扩展名 → 唯一可用引擎：.xls 仅 xlrd 支持、.xlsx/.xlsm 仅 openpyxl 支持
# （xlrd>=2.0 已移除 .xlsx 支持，openpyxl 从不支持 .xls）
_ENGINE_BY_SUFFIX = {".xls": "xlrd", ".xlsx": "openpyxl", ".xlsm": "openpyxl"}


def resolve_excel_engine(file_path: str) -> str:
    """按文件扩展名解析 Excel 读取引擎（.xls→xlrd、.xlsx/.xlsm→openpyxl）。

    供仅需引擎名的场景（如读取工作表列表）使用，与 ExcelLoader 的
    _effective_engine 共用同一份映射，保证两处引擎选择永不漂移。
    """
    return _ENGINE_BY_SUFFIX.get(Path(file_path).suffix.lower(), "openpyxl")


def get_excel_sheet_names(file_path: str) -> list[str]:
    """读取 Excel 文件的全部工作表名，引擎按扩展名自适应，句柄确保关闭。

    供预览等只需工作表列表的场景使用。预览路由曾各自硬编码 openpyxl 导致
    .xls 必然 500，且 ExcelFile 打开后未 close 使 Windows 下数据文件被锁定。
    """
    excel_file = pd.ExcelFile(file_path, engine=resolve_excel_engine(file_path))
    try:
        return list(excel_file.sheet_names)
    finally:
        excel_file.close()


# OOXML 命名空间：xlsx 内部 XML 的主命名空间、officeDocument 关系 id 属性、
# 以及 *_rels 关系文件元素所属的 package 关系命名空间（注意 .iter() 不支持
# "{*}" 通配——find/findall 的路径通配语法在标签匹配上是字面量，恒不命中）
_XLSX_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_XLSX_REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
_XLSX_PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

# 严格 OOXML（ECMA-376 Strict）的主命名空间—— transitional 与 strict 仅 URI
# 不同，元素局部名一致。合并填充解析按局部名匹配即可同时兼容两种文件
_XLSX_STRICT_MAIN_NS = "{http://purl.oclc.org/ooxml/spreadsheetml/2006/main}"


def _xlsx_local_name(tag: str) -> str:
    """剥离命名空间返回 XML 局部名（transitional/strict OOXML 通吃）。"""
    return tag.rpartition("}")[2]


def _xlsx_find_child(elem: Any, local: str) -> Any:
    """按局部名查找首个子元素（等价于 find('{ns}local')，但命名空间无关）。"""
    for child in elem:
        if _xlsx_local_name(child.tag) == local:
            return child
    return None


def _xlsx_iter_local(elem: Any, local: str) -> Iterator[Any]:
    """按局部名遍历后代元素（命名空间无关版 elem.iter('{ns}local')）。"""
    return (e for e in elem.iter() if _xlsx_local_name(e.tag) == local)


def _xlsx_col_letters_to_index(letters: str) -> int:
    """Excel 列字母（A/B/.../AA）转 1-based 列号。"""
    index = 0
    for ch in letters.upper():
        index = index * 26 + (ord(ch) - ord("A") + 1)
    return index


def _xlsx_parse_cell_ref(ref: str) -> tuple[int, int]:
    """单元格引用（如 B5）转 (row, col)，均 1-based。"""
    i = 0
    while i < len(ref) and ref[i].isalpha():
        i += 1
    return int(ref[i:]), _xlsx_col_letters_to_index(ref[:i])


def _xlsx_date_style_indexes(zf: Any) -> set[int] | None:
    """解析 styles.xml，返回数字格式为日期型的样式索引集合（R1）。

    对齐 openpyxl apply_stylesheet 的判定：cellXfs 中每个 xf 的 numFmtId 解析为
    格式串（自定义 numFmts 优先，其次内置格式表），is_date_format 判定。
    styles.xml 缺失（极简工作簿）返回 None——调用方按纯数值处理。
    """
    from xml.etree import ElementTree as ET

    from openpyxl.styles.numbers import builtin_format_code, is_date_format

    if "xl/styles.xml" not in zf.namelist():
        return None
    styles_root = ET.fromstring(zf.read("xl/styles.xml"))
    custom: dict[int, str] = {}
    for numfmt in _xlsx_iter_local(styles_root, "numFmt"):
        fmt_id, code = numfmt.get("numFmtId"), numfmt.get("formatCode")
        if fmt_id is not None and code is not None:
            custom[int(fmt_id)] = code
    date_styles: set[int] = set()
    cell_xfs = _xlsx_find_child(styles_root, "cellXfs")
    if cell_xfs is None:
        return date_styles
    for idx, xf in enumerate(cell_xfs):
        if _xlsx_local_name(xf.tag) != "xf":
            continue
        raw_id = xf.get("numFmtId")
        if raw_id is None:
            continue
        fmt = custom.get(int(raw_id)) or builtin_format_code(int(raw_id))
        if fmt and is_date_format(fmt):
            date_styles.add(idx)
    return date_styles


def _xlsx_cell_value(
    elem: Any, shared: list[str] | None, date_styles: set[int] | None = None, epoch: Any = None
) -> Any:
    """从 <c> 元素解析单元格值，对齐 openpyxl data_only=True 的缓存值语义。

    date_styles 为 ``_xlsx_date_style_indexes`` 产出的日期样式索引集合：命中的数值
    单元格按 Excel 序列号换算为 datetime（R1——此前返回序列号 int，跨块合并填充后
    同列混 Timestamp/int 导致日期约束误报、两路径判定不一致）。
    """
    cell_type = elem.get("t")
    if cell_type == "inlineStr":
        return "".join(t.text or "" for t in _xlsx_iter_local(elem, "t"))
    v_elem = _xlsx_find_child(elem, "v")
    if v_elem is None or v_elem.text is None:
        return None
    raw = v_elem.text
    if cell_type == "s":
        # 共享字符串：v 为 sharedStrings.xml 中的下标
        if shared is None:
            return None
        idx = int(raw)
        return shared[idx] if 0 <= idx < len(shared) else None
    if cell_type == "b":
        return raw == "1"
    if cell_type == "str":
        return raw  # 公式字符串结果
    # 数值（默认/公式缓存数值结果）：日期样式先行换算，其余 int→float→原样回退
    if date_styles is not None:
        style_attr = elem.get("s")
        if style_attr is not None and int(style_attr) in date_styles:
            from openpyxl.utils.datetime import from_excel

            try:
                return from_excel(float(raw), epoch=epoch)
            except (ValueError, OverflowError, TypeError):
                pass  # 脏序列号按普通数值回退
    try:
        return int(raw)
    except ValueError:
        try:
            return float(raw)
        except ValueError:
            return raw


def read_merged_ranges_from_xlsx(
    file_path: str | Path, sheet_name: str
) -> list[tuple[int, int, int, int, list[Any]]] | None:
    """流式读取 xlsx 目标 sheet 的合并单元格区域及各区域首行值（§1.27 分块路径专用）。

    返回 (min_row, min_col, max_row, max_col, values) 五元组列表，values 为区域首行
    min_col..max_col 各列的值（供跨块悬挂区域直接赋值续填）；sheet 不存在返回 None；
    无合并区域返回 []。

    为何不走 openpyxl：read_only 模式的 ReadOnlyWorksheet 不解析 merged_cells（无该
    属性），普通模式则把全部 sheet 的 Cell 对象图整体物化——分块路径本是为 >500MB
    大文件省内存而设，普通模式峰值内存约为 read_only 的 120 倍（0.5MB/15 万格实测
    55MB vs ≈0MB）。故按 OOXML 结构直接 zipfile+ElementTree 流式解析：workbook.xml
    定位目标 sheet → 第一遍扫描 <mergeCells> 取区域 → 第二遍流式扫描 <sheetData>
    仅物化各区域首行的取值。共享字符串表按 openpyxl read_only 同口径全量载入
    （上界为去重字符串数）。.xls（非 zip 容器）会抛 BadZipFile，由调用方降级处理。
    """
    import zipfile
    from xml.etree import ElementTree as ET

    from openpyxl.utils.datetime import MAC_EPOCH, WINDOWS_EPOCH

    with zipfile.ZipFile(file_path) as zf:
        # 1) sheet 名 → 工作表 XML 条目路径（workbook.xml 的 r:id + 其关系文件）
        # 标签按局部名匹配：transitional 与 strict OOXML 主命名空间 URI 不同但局部名一致
        rid: str | None = None
        wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
        for sheet in _xlsx_iter_local(wb_root, "sheet"):
            if sheet.get("name") == sheet_name:
                rid = sheet.get(_XLSX_REL_ID)
                break
        if not rid:
            return None
        # 日期序列号换算基准：workbookPr date1904 声明 MAC 1904 体系（默认 Windows 1900）
        epoch = WINDOWS_EPOCH
        for wb_pr in _xlsx_iter_local(wb_root, "workbookPr"):
            if (wb_pr.get("date1904") or "").lower() in ("1", "true"):
                epoch = MAC_EPOCH
            break
        target: str | None = None
        rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        for rel in _xlsx_iter_local(rels_root, "Relationship"):
            if rel.get("Id") == rid:
                target = rel.get("Target")
                break
        if not target:
            return None
        entry = target.lstrip("/") if target.startswith("/") else f"xl/{target}"

        # 2) 第一遍：mergeCells 区域引用（行元素即扫即弃，内存有界）
        ranges: list[tuple[int, int, int, int]] = []
        with zf.open(entry) as stream:
            for _event, elem in ET.iterparse(stream, events=("end",)):
                if _xlsx_local_name(elem.tag) == "mergeCell":
                    ref = elem.get("ref") or ""
                    if ":" in ref:
                        start, end = ref.split(":", 1)
                        r1, c1 = _xlsx_parse_cell_ref(start)
                        r2, c2 = _xlsx_parse_cell_ref(end)
                        ranges.append((min(r1, r2), min(c1, c2), max(r1, r2), max(c1, c2)))
                    elem.clear()
                elif _xlsx_local_name(elem.tag) == "row":
                    elem.clear()
        if not ranges:
            return []

        # 3) 共享字符串表（存在时全量载入；openpyxl read_only 取值同口径）
        shared: list[str] | None = None
        if "xl/sharedStrings.xml" in zf.namelist():
            shared = []
            with zf.open("xl/sharedStrings.xml") as stream:
                for _event, si in ET.iterparse(stream, events=("end",)):
                    if _xlsx_local_name(si.tag) == "si":
                        shared.append("".join(t.text or "" for t in _xlsx_iter_local(si, "t")))
                        si.clear()

        # 4) 第二遍：仅物化各区域首行的单元格值（日期样式表用于序列号→datetime 换算）
        date_styles = _xlsx_date_style_indexes(zf)
        needed_rows = {r[0] for r in ranges}
        row_values: dict[int, dict[int, Any]] = {}
        with zf.open(entry) as stream:
            for _event, row in ET.iterparse(stream, events=("end",)):
                if _xlsx_local_name(row.tag) != "row":
                    continue
                row_num = row.get("r")
                if row_num is not None and int(row_num) in needed_rows:
                    cells: dict[int, Any] = {}
                    fallback_col = 0
                    for cell in row:
                        cell_ref = cell.get("r")
                        col = _xlsx_parse_cell_ref(cell_ref)[1] if cell_ref else fallback_col + 1
                        fallback_col = col
                        cells[col] = _xlsx_cell_value(cell, shared, date_styles, epoch)
                    row_values[int(row_num)] = cells
                row.clear()

        result: list[tuple[int, int, int, int, list[Any]]] = []
        for min_row, min_col, max_row, max_col in ranges:
            cells = row_values.get(min_row, {})
            values = [cells.get(c) for c in range(min_col, max_col + 1)]
            result.append((min_row, min_col, max_row, max_col, values))
        return result


def apply_merged_ranges_fill(
    df: pd.DataFrame,
    merged_ranges: Any,
    *,
    header_row: int = 0,
    skip_rows: int = 0,
    global_row_offset: int = 0,
) -> tuple[pd.DataFrame, int, int]:
    """对合并单元格区域做列向前向填充（B7 核心，标准路径与分块路径单一事实源）。

    参数:
        df: 待填充的 DataFrame（标准路径=整表；分块路径=单块，此时传 global_row_offset）
        merged_ranges: openpyxl merged_cells.ranges 对象（标准路径），或
            (min_row, min_col, max_row, max_col, values) 五元组列表（分块路径——values 为
            区域首行各列的值，供跨块悬挂区域直接赋值，合并单元格区域内所有格本就同值）
        header_row: 表头行号（0-based，不含 skip_rows）
        skip_rows: 表头前跳过的行数（openpyxl→df 行号换算基准；标准与分块路径同值透传）
        global_row_offset: 本 df 首行对应的全局数据行号（0-based；标准路径整表为 0）

    返回:
        (填充后的 df 副本, 填充的区域数, 无法填充的悬挂区域数)
    """
    df_filled = df.copy()
    df_start_global = global_row_offset
    filled_count = 0
    skipped_cross = 0
    for merged in merged_ranges:
        if isinstance(merged, tuple):
            min_row, min_col, max_row, max_col, values = (
                merged[0],
                merged[1],
                merged[2],
                merged[3],
                merged[4] if len(merged) > 4 else None,
            )
        else:
            min_row, min_col, max_row, max_col = (
                merged.min_row,
                merged.min_col,
                merged.max_row,
                merged.max_col,
            )
            values = None
        # openpyxl 是 1-based；pandas 读取时先跳过 skip_rows 行再把第 header_row
        # 行作为表头，因此全局数据行 0 对应 Excel 第 (skip_rows + header_row + 2) 行。
        start_global = min_row - header_row - skip_rows - 2
        end_global = max_row - header_row - skip_rows - 2
        start_df_col = min_col - 1
        end_df_col = max_col - 1

        if start_df_col < 0:
            continue
        # 区域在本 df 范围之前（分块场景：整个区域属于更早的块）
        if end_global < df_start_global:
            continue
        # 区域首行不在本 df 内（跨块悬挂）：携带首行值时直接赋值（区域内所有格同值），
        # 否则跳过并计数（标准路径整表调用不会走到这里）
        if start_global < df_start_global:
            if end_global >= df_start_global:
                if values is not None:
                    seg_end = min(end_global - df_start_global, len(df_filled) - 1)
                    actual_end_col = min(end_df_col, len(df_filled.columns) - 1)
                    if seg_end >= 0 and actual_end_col >= start_df_col:
                        for k, col_idx in enumerate(range(start_df_col, actual_end_col + 1)):
                            if k < len(values) and values[k] is not None:
                                df_filled.iloc[0 : seg_end + 1, col_idx] = values[k]
                        filled_count += 1
                else:
                    skipped_cross += 1
            continue
        # 区域首行在本 df 内：换算为 df 内行号
        start_df_row = start_global - df_start_global
        if start_df_row >= len(df_filled):
            continue

        # 限定区域边界（防止越界；分块场景区域尾部超出本块属正常——下一块经悬挂赋值续填）
        actual_end_row = min(end_global - df_start_global, len(df_filled) - 1)
        actual_end_col = min(end_df_col, len(df_filled.columns) - 1)
        if actual_end_row < start_df_row or actual_end_col < start_df_col:
            continue

        # 按列向量化前向填充：区域内 NaN 被区域起点方向的最近非空值填充，
        # 已有非空值不动。ffill 从区域起点开始，不跨越区域边界。
        for col_idx in range(start_df_col, actual_end_col + 1):
            region = df_filled.iloc[start_df_row : actual_end_row + 1, col_idx]
            df_filled.iloc[start_df_row : actual_end_row + 1, col_idx] = region.ffill()
        filled_count += 1
    return df_filled, filled_count, skipped_cross


@register_loader("excel")
class ExcelLoader(DataSourceLoader[ExcelSourceSpec]):
    """
    @classdesc Excel 文件加载器

    支持 .xlsx 和 .xls 格式的 Excel 文件。
    使用 pandas.read_excel 进行读取。

    支持两种模式：
    - 单 sheet 加载：通过 load() 返回单个 DataFrame
    - 多 sheet 批量加载：通过 load_multi_sheet() 返回 {sheet_name: DataFrame}
    """

    spec_class = ExcelSourceSpec

    def _effective_engine(self) -> str:
        """
        @methoddesc 按文件扩展名解析实际读取引擎，与 spec.engine 不符时以扩展名为准

        业务用途:
        - spec.engine 默认 openpyxl，但 .xls 文件 openpyxl 无法读取（抛
          InvalidFileException/BadZipFile）——此前"宣告支持 .xls 却必炸"的根因之一。
          引擎与扩展名唯一对应，冲突时按扩展名纠正并提示，避免必然失败的组合。
        - 无扩展名（或不识别的扩展名）时尊重 spec.engine 原值。
        """
        expected = _ENGINE_BY_SUFFIX.get(Path(self.spec.path).suffix.lower())
        if expected and expected != self.spec.engine:
            logger.info(
                "引擎配置（%s）与文件扩展名不符，已按扩展名使用 %s: %s",
                self.spec.engine,
                expected,
                self.spec.path,
            )
            return expected
        return self.spec.engine

    def load(self) -> pd.DataFrame:
        """
        @methoddesc 加载 Excel 文件并返回 DataFrame。

        根据 spec 中的 sheet 名称或索引读取指定工作表，
        支持 header_row、skip_rows、nrows 等配置。
        读取后会应用合并单元格前向填充（仅 openpyxl 引擎）。

        Returns:
            加载的 DataFrame

        Raises:
            DataLoadError: 文件不存在、为空、加载失败或 sheet 不存在时抛出

        示例:
            >>> spec = ExcelSourceSpec(path="data.xlsx", sheet="Sheet1", header_row=0)
            >>> loader = ExcelLoader(spec)
            >>> df = loader.load()
        """
        try:
            # 空文件提前检查，给出清晰错误（B13）
            path = Path(self.spec.path)
            if path.exists() and path.stat().st_size == 0:
                raise DataLoadError(f"Excel 文件为空: {self.spec.path}", self.spec)

            read_kwargs = self._build_read_kwargs()

            df = pd.read_excel(self.spec.path, **read_kwargs)

            if not self.spec.header_enabled:
                df.columns = [f"col_{i}" for i in range(len(df.columns))]

            # header_row 配置错误导致空数据时给出警告（B10）
            if len(df) == 0 and self.spec.header_row > 0:
                logger.warning(
                    f"Excel 表 '{self.spec.sheet or self.spec.sheet_index}' "
                    f"在 header_row={self.spec.header_row} 之后没有数据行，"
                    f"请检查 header_row 配置是否正确"
                )

            df = self._apply_merged_cell_fill(df, self.spec.sheet, self.spec.header_row, self.spec.skip_rows)
            return df

        except FileNotFoundError as e:
            raise DataLoadError(f"文件不存在: {self.spec.path}", self.spec, e)
        except DataLoadError:
            raise
        except Exception as e:
            raise DataLoadError(f"Excel 加载失败: {e}", self.spec, e)

    def load_multi_sheet(
        self,
        sheet_configs: dict[str, dict[str, Any]],
    ) -> dict[str, pd.DataFrame]:
        """
        @methoddesc 批量加载多个 sheet。

        :param sheet_configs: 字典，键为 schema_id，值包含:
            - sheet_name: sheet 名称
            - header_row: 表头行号
        :return: 字典，键为 schema_id，值为对应的 DataFrame
        """
        if not sheet_configs:
            return {}

        sheet_names = list({cfg["sheet_name"] for cfg in sheet_configs.values() if cfg.get("sheet_name")})

        if not sheet_names:
            return {}

        try:
            loaded_sheets: dict = pd.read_excel(
                self.spec.path,
                sheet_name=sheet_names,
                header=None,
                engine=self._effective_engine(),
                **self._engine_kwargs(),
            )

            results: dict[str, pd.DataFrame] = {}
            for schema_id, cfg in sheet_configs.items():
                sheet_name = cfg.get("sheet_name")
                header_row = cfg.get("header_row", 0)
                skip_rows = cfg.get("skip_rows", 0)
                nrows = cfg.get("nrows")
                dtype_inference = cfg.get("dtype_inference", True)

                if not sheet_name:
                    continue
                # 缺失 sheet 时显式报错，避免静默跳过导致假阴性（B8）
                if sheet_name not in loaded_sheets:
                    raise DataLoadError(
                        f"Sheet '{sheet_name}' 不存在于文件 {self.spec.path} 中",
                        self.spec,
                    )

                df = loaded_sheets[sheet_name]
                effective_header = header_row + skip_rows
                df.columns = df.iloc[effective_header]
                df = df.drop(index=range(effective_header + 1)).reset_index(drop=True)

                # 应用 nrows 限制（B9）
                if nrows is not None:
                    df = df.head(nrows)

                # 应用 dtype_inference（B9）
                if not dtype_inference:
                    df = df.astype(str)

                # header_row 配置错误导致空数据时给出警告（B10）
                if len(df) == 0:
                    logger.warning(
                        f"Sheet '{sheet_name}' 在 header_row={header_row} 之后没有数据行，"
                        f"请检查 header_row 配置是否正确"
                    )
                df = self._apply_merged_cell_fill(df, sheet_name, effective_header)
                results[schema_id] = df

            return results

        except FileNotFoundError as e:
            raise DataLoadError(f"文件不存在: {self.spec.path}", self.spec, e)
        except Exception as e:
            raise DataLoadError(f"Excel 多 sheet 加载失败: {e}", self.spec, e)

    def _engine_kwargs(self) -> dict[str, Any]:
        """@methoddesc 构造 pandas.read_excel 的 engine_kwargs。

        data_only=True 让 openpyxl 读取公式计算结果而非公式本身。
        仅 openpyxl 引擎支持该参数——xlrd（.xls）的 open_workbook 没有
        data_only 形参，pandas 原样转发会 TypeError，导致 .xls 必炸。
        因此 xlrd 分支不传任何 engine_kwargs。
        """
        if self._effective_engine() == "openpyxl":
            return {"engine_kwargs": {"data_only": True}}
        return {}

    def _build_read_kwargs(self) -> dict[str, Any]:
        """
        @methoddesc 构造 pandas.read_excel 的参数字典

        业务用途:
        - 根据 self.spec 配置（header 行、engine、dtype、sheet 索引、skip_rows、nrows）组装参数
        - engine_kwargs.data_only=True 用于读取公式结果而非公式本身

        返回:
            可直接传入 pd.read_excel 的参数字典
        """
        read_kwargs: dict[str, Any] = {
            "header": self.spec.header_row if self.spec.header_enabled else None,
            "engine": self._effective_engine(),
            "dtype": None if self.spec.dtype_inference else str,
            **self._engine_kwargs(),
        }

        if self.spec.sheet:
            read_kwargs["sheet_name"] = self.spec.sheet
        else:
            read_kwargs["sheet_name"] = self.spec.sheet_index

        if self.spec.skip_rows > 0:
            read_kwargs["skiprows"] = self.spec.skip_rows
        if self.spec.nrows:
            read_kwargs["nrows"] = self.spec.nrows

        return read_kwargs

    def _apply_merged_cell_fill(
        self,
        df: pd.DataFrame,
        sheet_name: str | None = None,
        header_row: int = 0,
        skip_rows: int = 0,
    ) -> pd.DataFrame:
        """@methoddesc 对合并单元格进行前向填充，避免 NotNull/Unique 误报（B7）。

        使用 openpyxl 检测合并单元格区域，然后仅对区域内的 NaN 进行填充。
        填充核心在模块级 apply_merged_ranges_fill（§1.27 起与分块路径共用）。

        参数:
            df: 已加载的 DataFrame
            sheet_name: 数据来源的 sheet 名称；None 时按 spec 的 sheet/sheet_index 解析
            header_row: 表头行号（0-based，不含 skip_rows）
            skip_rows: 表头前跳过的行数（load_multi_sheet 路径已把 skip_rows 折入
                effective_header，此时应保持默认 0，避免重复扣减）
        """
        if self._effective_engine() != "openpyxl":
            return df
        try:
            from openpyxl import load_workbook

            wb = load_workbook(self.spec.path, data_only=True)
            try:
                if sheet_name is None:
                    # 回归修复: 填充逻辑必须定位到与读取一致的工作表。读取时 sheet 未指定
                    # 名称会按 sheet_index 选表（见 _build_read_kwargs），此处解析需保持
                    # 同一优先级；过去无条件回退到第一张表，sheet_index>0 时填错表。
                    if self.spec.sheet:
                        sheet_name = self.spec.sheet
                    elif 0 <= self.spec.sheet_index < len(wb.sheetnames):
                        sheet_name = wb.sheetnames[self.spec.sheet_index]
                    else:
                        sheet_name = wb.sheetnames[0]
                ws = wb[sheet_name]
                df_filled, _filled, _skipped = apply_merged_ranges_fill(
                    df,
                    ws.merged_cells.ranges,
                    header_row=header_row,
                    skip_rows=skip_rows,
                )
                return df_filled
            finally:
                wb.close()
        except Exception as e:
            # B27: 合并单元格前向填充失败时降级为返回原始 df（不中断加载），
            # 但必须留有诊断痕迹——否则 NotNull/Unique 会因未填充的合并单元格 NaN 静默误报，
            # 且无法定位根因（损坏的工作簿、权限错误、openpyxl 版本差异等都会落到这里）。
            logger.warning(
                "合并单元格前向填充失败，降级返回未填充数据（可能导致 NotNull/Unique 误报），file=%s: %s",
                self.spec.path,
                e,
                exc_info=True,
            )
            return df

    def validate(self) -> list[str]:
        """
        @methoddesc 验证 Excel 文件配置和文件本身。

        检查项：
        - 文件是否存在
        - 文件扩展名是否为 .xlsx 或 .xls
        - 文件大小是否超过 100MB（发出警告）

        Returns:
            错误信息列表，空列表表示验证通过

        示例:
            >>> errors = loader.validate()
            >>> if errors:
            ...     print("验证失败:", errors)
        """
        errors = []
        path = Path(self.spec.path)

        if not path.exists():
            errors.append(f"文件不存在: {self.spec.path}")
            return errors

        ext = path.suffix.lower()
        # 与 _ENGINE_BY_SUFFIX/加载路径同口径：.xlsm 同为 openpyxl 可读格式
        if ext not in [".xlsx", ".xls", ".xlsm"]:
            errors.append(f"不支持的 Excel 格式: {ext}")

        size_mb = path.stat().st_size / (1024 * 1024)
        if size_mb > 100:
            errors.append(f"警告: 文件较大 ({size_mb:.1f}MB)")

        return errors

    def preview(self, nrows: int = 10) -> pd.DataFrame:
        """
        @methoddesc 预览 Excel 文件的前 n 行数据。

        通过限制 nrows 参数快速加载文件头部数据，
        比加载完整文件更高效。同样会应用合并单元格填充。

        Args:
            nrows: 要预览的行数，默认为 10

        Returns:
            包含前 n 行数据的 DataFrame

        示例:
            >>> df = loader.preview(nrows=5)
            >>> print(df.head())
        """
        try:
            read_kwargs: dict[str, Any] = {
                "nrows": nrows,
                "header": self.spec.header_row if self.spec.header_enabled else None,
                "engine": self._effective_engine(),
                **self._engine_kwargs(),
            }

            if self.spec.sheet:
                read_kwargs["sheet_name"] = self.spec.sheet
            else:
                read_kwargs["sheet_name"] = self.spec.sheet_index

            # 预览同样要跳过表头前的说明行，且合并单元格填充的行号换算依赖 skip_rows，
            # 读取与填充必须使用同一值，否则填充区域错位
            if self.spec.skip_rows > 0:
                read_kwargs["skiprows"] = self.spec.skip_rows

            df = pd.read_excel(self.spec.path, **read_kwargs)

            if not self.spec.header_enabled:
                df.columns = [f"col_{i}" for i in range(len(df.columns))]

            df = self._apply_merged_cell_fill(df, self.spec.sheet, self.spec.header_row, self.spec.skip_rows)
            return df

        except Exception:
            return super().preview(nrows)
