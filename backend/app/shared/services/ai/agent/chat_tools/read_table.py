"""@fileoverview read_table 工具

Chat mini-agent 可调用的工具：读取指定表的数据样本。

根据表名定位 schema 文件，解析其 source 配置找到数据文件，
加载前 N 行采样数据返回给 LLM。让 LLM 在设计约束规则前能"看到真实数据"，
从而做出更准确的判断（如合理的 Range 范围、AllowedValues 取值等）。
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

logger = logging.getLogger(__name__)

# read_table 最多返回的单元格字符数，避免 observation 过长
_MAX_CELL_CHARS = 200
# 默认采样行数
_DEFAULT_SAMPLE_ROWS = 10
# 最大采样行数上限，防止 LLM 传入过大值
_MAX_SAMPLE_ROWS = 100


class ReadTableTool:
    """
    @classdesc 读取表数据样本工具

    根据表名查找 schema，加载对应数据文件的前 N 行。
    """

    NAME = "read_table"

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径
        """
        self.project_path = project_path

        # schema 索引缓存：避免每次 read_table 都 glob + 逐个解析 YAML
        # 结构: {table_name_lower: (schema_path, source_config)}
        # _schema_index_mtime 记录构建缓存时 schemas 目录的 mtime，用于失效检测
        self._schema_index: dict[str, tuple[str, dict[str, Any]]] = {}
        self._schema_index_mtime: float | None = None

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "读取指定表的数据样本（前 N 行），展示列结构和真实数据值。"
                    "当需要为某列设计约束规则（如 Range/AllowedValues）时，"
                    "先调用此工具查看真实数据分布，再决定合理的参数。"
                    "表名可以是 schema 的 name 或 id。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "要查看的表名（schema 的 name 或 id）",
                        },
                        "sample_rows": {
                            "type": "integer",
                            "description": f"采样行数，默认 {_DEFAULT_SAMPLE_ROWS}，最大 {_MAX_SAMPLE_ROWS}",
                        },
                    },
                    "required": ["table_name"],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行表数据采样读取

        参数:
            arguments: tool 参数，包含 table_name 和可选 sample_rows

        返回:
            {"success": bool, "table_name": str, "columns": [...], "sample_rows": [...], "error": str}
        """
        table_name = arguments.get("table_name", "")
        if not table_name:
            return {"success": False, "error": "未指定 table_name", "table_name": ""}

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "table_name": table_name}

        sample_rows = arguments.get("sample_rows", _DEFAULT_SAMPLE_ROWS)
        sample_rows = max(1, min(int(sample_rows), _MAX_SAMPLE_ROWS))

        try:
            # 同步文件读取 + DataFrame 加载，放到线程池
            result = await asyncio.to_thread(self._load_table_sample, table_name, sample_rows)
            return result
        except Exception as e:
            logger.exception("read_table 工具执行失败")
            return {"success": False, "error": f"读取表数据失败: {e}", "table_name": table_name}

    def _load_table_sample(self, table_name: str, sample_rows: int) -> dict[str, Any]:
        """
        @methoddesc 同步加载表数据样本（在线程池中执行）

        参数:
            table_name: 表名
            sample_rows: 采样行数

        返回:
            结果字典
        """
        # 步骤 1+2: 查 schema 文件路径 + source 配置（带缓存，合并原两步）
        entry = self._get_schema_entry(table_name)
        if not entry:
            return {"success": False, "error": f"未找到表 '{table_name}' 的 schema 文件", "table_name": table_name}

        _schema_path, source_config = entry
        if not source_config.get("path"):
            return {
                "success": False,
                "error": f"表 '{table_name}' 的 schema 未配置 source.path，无法读取数据",
                "table_name": table_name,
            }

        # 步骤 3: 解析数据文件绝对路径
        data_file = source_config["path"]
        if not os.path.isabs(data_file):
            # relative_file 模式：路径相对于项目根目录
            data_file = os.path.join(self.project_path, data_file)

        if not os.path.isfile(data_file):
            return {
                "success": False,
                "error": f"数据文件不存在: {data_file}",
                "table_name": table_name,
            }

        # 步骤 4: 加载数据文件
        df = self._load_data_file(data_file, source_config)
        if df is None:
            return {
                "success": False,
                "error": f"无法加载数据文件: {data_file}",
                "table_name": table_name,
            }

        # 步骤 5: 采样并格式化
        df_sample = df.head(sample_rows)

        # 列结构
        columns = []
        for col in df.columns:
            col_str = str(col)
            dtype = str(df[col].dtype)
            null_count = int(df[col].isna().sum())
            columns.append({"name": col_str, "dtype": dtype, "null_count": null_count})

        # 采样行（转为可 JSON 序列化的列表，处理 NaN）
        sample_records = self._dataframe_to_records(df_sample)

        return {
            "success": True,
            "table_name": table_name,
            "file_path": data_file,
            "total_rows": int(len(df)),
            "columns": columns,
            "sample_rows": sample_records,
        }

    def _ensure_schema_index(self) -> None:
        """
        @methoddesc 构建/刷新 schema 索引缓存

        首次调用或 schemas 目录 mtime 变化时，扫描所有 *.yaml 文件，
        构建 {table_name_lower: (schema_path, source_config)} 映射。
        之后同一 tool 实例内的 read_table 调用直接查缓存，避免重复 glob + 解析。

        失效策略：比较目录 mtime。单文件内容变更（不触发目录 mtime）极少见，
        且 agent 会话内通常不编辑 schema 文件，该策略足够可靠。
        """
        import os

        schemas_dir = Path(self.project_path) / "schemas"
        if not schemas_dir.exists():
            self._schema_index = {}
            self._schema_index_mtime = None
            return

        try:
            current_mtime = os.path.getmtime(schemas_dir)
        except OSError:
            current_mtime = 0.0

        # mtime 未变 → 缓存有效，直接返回
        if self._schema_index_mtime is not None and current_mtime == self._schema_index_mtime:
            return

        # 重建索引：一次扫描收集所有 schema 的 id/name → (path, source)
        index: dict[str, tuple[str, dict[str, Any]]] = {}
        for schema_file in schemas_dir.glob("*.yaml"):
            try:
                with open(schema_file, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                schema_id = str(data.get("id", "")).strip().lower()
                schema_name = str(data.get("name", "")).strip().lower()
                source_config = data.get("source") or {}
                entry = (str(schema_file), source_config)
                # id 和 name 都建索引（两者都可能作为 table_name 传入）
                if schema_id:
                    index[schema_id] = entry
                if schema_name:
                    index[schema_name] = entry
            except Exception:
                continue

        self._schema_index = index
        self._schema_index_mtime = current_mtime
        logger.debug(f"[read_table] schema 索引已重建: {len(index)} 个条目")

    def _get_schema_entry(self, table_name: str) -> tuple[str, dict[str, Any]] | None:
        """
        @methoddesc 查询 schema 文件路径和 source 配置（带缓存）

        合并了原 _find_schema_file + _parse_schema_source 两步：
        首次扫描 schemas 目录构建索引，之后直接查内存缓存。

        参数:
            table_name: 表名（schema 的 id 或 name）

        返回:
            (schema_path, source_config) 或 None（未找到）
        """
        self._ensure_schema_index()
        target = table_name.strip().lower()
        return self._schema_index.get(target)

    def _load_data_file(self, data_file: str, source_config: dict[str, Any]) -> pd.DataFrame | None:
        """
        @methoddesc 根据文件扩展名加载数据文件

        使用 load_file_data 统一入口，避免重复实现格式适配逻辑。
        """
        try:
            from app.shared.services.validation.loader import load_file_data

            sheet_name = source_config.get("sheet")
            header_row = source_config.get("header_row", 0)
            return load_file_data(
                source_file_path=data_file,
                sheet_name=sheet_name,
                header_row=header_row,
            )
        except Exception as e:
            logger.warning(f"load_file_data 加载失败 {data_file}: {e}")
            return None

    @staticmethod
    def _dataframe_to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
        """将 DataFrame 转为可 JSON 序列化的记录列表，处理 NaN 和超长值。"""
        records: list[dict[str, Any]] = []
        for _, row in df.iterrows():
            record: dict[str, Any] = {}
            for col in df.columns:
                value = row[col]
                # NaN/None 转为 null
                if pd.isna(value):
                    record[str(col)] = None
                    continue
                # 截断超长字符串
                value_str = str(value)
                if len(value_str) > _MAX_CELL_CHARS:
                    value_str = value_str[:_MAX_CELL_CHARS] + "..."
                record[str(col)] = value_str
            records.append(record)
        return records
