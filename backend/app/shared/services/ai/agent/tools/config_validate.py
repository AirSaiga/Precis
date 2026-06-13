"""@fileoverview 配置校验工具

Agent 可调用的工具：对生成的配置做快速抽样校验，返回命中率和问题列表。
"""

from __future__ import annotations

import logging
import re
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)


class ConfigValidateTool:
    """
    @classdesc 配置校验工具

    对生成的约束规则进行快速抽样验证。
    """

    NAME = "validate_config"

    def __init__(self, file_paths: list[str], profiling_data: list[dict], sample_size: int = 1000):
        """
        @methoddesc 初始化工具

        参数:
            file_paths: 数据文件路径列表
            profiling_data: 数据画像
            sample_size: 校验采样行数
        """
        self.file_paths = file_paths
        self.profiling_data = profiling_data
        self.sample_size = sample_size
        self._dataframes: dict[str, pd.DataFrame] = {}

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": "对生成的配置进行快速抽样校验，返回每个约束的命中情况。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "config": {
                            "type": "object",
                            "description": "待校验的配置，包含 schemas、constraints、regex_nodes",
                        },
                        "sample_size": {
                            "type": "integer",
                            "description": "校验采样行数，覆盖默认值",
                        },
                    },
                    "required": ["config"],
                },
            },
        }

    def _load_dataframe(self, file_path: str) -> pd.DataFrame | None:
        """加载数据文件为 DataFrame（带缓存）。"""
        if file_path in self._dataframes:
            return self._dataframes[file_path]

        if not file_path or not __import__("os").path.exists(file_path):
            return None

        ext = __import__("os").path.splitext(file_path)[1].lower()
        try:
            if ext in [".xlsx", ".xls"]:
                df = pd.read_excel(file_path, nrows=self.sample_size)
            elif ext == ".csv":
                df = pd.read_csv(file_path, nrows=self.sample_size, encoding="utf-8")
            elif ext == ".json":
                with open(file_path, encoding="utf-8") as f:
                    data = __import__("json").load(f)
                if isinstance(data, list):
                    df = pd.json_normalize(data)
                else:
                    df = pd.json_normalize([data])
                df = df.head(self.sample_size)
            elif ext == ".jsonl":
                records = []
                with open(file_path, encoding="utf-8") as f:
                    for i, line in enumerate(f):
                        if i >= self.sample_size:
                            break
                        line = line.strip()
                        if line:
                            records.append(__import__("json").loads(line))
                df = pd.json_normalize(records)
            else:
                return None
            self._dataframes[file_path] = df
            return df
        except Exception as e:
            logger.warning(f"加载文件失败 {file_path}: {e}")
            return None

    def _find_file_path(self, table_id: str, schemas: dict[str, Any]) -> str | None:
        """根据 table_id 找到对应的数据文件路径。"""
        schema = schemas.get(table_id)
        if not schema:
            return None
        source = schema.get("source", {})
        path = source.get("path", "")
        # 尝试匹配绝对路径或相对路径
        for fp in self.file_paths:
            if fp.endswith(path) or path.endswith(__import__("os").path.basename(fp)):
                return fp
        return path if __import__("os").path.exists(path) else None

    def _get_column(self, df: pd.DataFrame, column_id: str) -> pd.Series:
        """获取列，支持 column_id 和 name 映射。"""
        if column_id in df.columns:
            return df[column_id]
        # 尝试大小写不敏感匹配
        for col in df.columns:
            if str(col).lower() == column_id.lower():
                return df[col]
        return pd.Series(dtype=object)

    def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行校验

        参数:
            arguments: tool 参数

        返回:
            {"success": bool, "total_rules": int, "passed": int, "issues": [...]}
        """
        config = arguments.get("config", {})
        sample_size = arguments.get("sample_size", self.sample_size)
        if sample_size != self.sample_size:
            self.sample_size = sample_size
            self._dataframes.clear()

        constraints = config.get("constraints", {})
        if isinstance(constraints, list):
            constraints = {c.get("id", f"c_{i}"): c for i, c in enumerate(constraints)}
        schemas = config.get("schemas", {})
        if isinstance(schemas, list):
            schemas = {s.get("id", f"s_{i}"): s for i, s in enumerate(schemas)}

        if not constraints:
            return {"success": True, "total_rules": 0, "passed": 0, "issues": []}

        total = 0
        passed = 0
        issues: list[dict[str, Any]] = []

        for cid, cdef in constraints.items():
            total += 1
            ctype = cdef.get("type", "")
            refs = cdef.get("refs", {})
            params = cdef.get("params", {})
            table_id = refs.get("table_id", "")
            file_path = self._find_file_path(table_id, schemas)
            if not file_path:
                issues.append(
                    {
                        "rule_id": cid,
                        "type": ctype,
                        "severity": "warning",
                        "message": f"找不到 table_id={table_id} 对应的数据文件",
                    }
                )
                continue

            df = self._load_dataframe(file_path)
            if df is None:
                issues.append(
                    {
                        "rule_id": cid,
                        "type": ctype,
                        "severity": "warning",
                        "message": f"无法加载文件 {file_path}",
                    }
                )
                continue

            result = self._validate_constraint(df, ctype, refs, params, cid)
            if result.get("passed"):
                passed += 1
            else:
                issues.append(result.get("issue", {}))

        # 同时校验 regex_nodes
        regex_nodes = config.get("regex_nodes", {})
        if isinstance(regex_nodes, list):
            regex_nodes = {r.get("id", f"r_{i}"): r for i, r in enumerate(regex_nodes)}
        for rid, rdef in regex_nodes.items():
            total += 1
            source_ref = rdef.get("source_ref", {})
            table_id = source_ref.get("table_id", "")
            column_id = source_ref.get("column_id", "")
            file_path = self._find_file_path(table_id, schemas)
            if not file_path:
                issues.append(
                    {
                        "rule_id": rid,
                        "type": "Regex",
                        "severity": "warning",
                        "message": "找不到 regex 对应的数据文件",
                    }
                )
                continue
            df = self._load_dataframe(file_path)
            if df is None:
                continue
            col = self._get_column(df, column_id)
            pattern = rdef.get("pattern", "")
            match_mode = rdef.get("match_mode", "full")
            try:
                regex = re.compile(pattern)
                total_values = len(col.dropna())
                if total_values == 0:
                    continue
                if match_mode == "full":
                    matched = col.dropna().astype(str).str.fullmatch(regex).sum()
                else:
                    matched = col.dropna().astype(str).str.contains(regex).sum()
                match_rate = float(matched) / float(total_values)
                if match_rate < 0.5:
                    issues.append(
                        {
                            "rule_id": rid,
                            "type": "Regex",
                            "severity": "error",
                            "message": f"正则匹配率仅 {match_rate:.1%}，可能过于严格或模式错误",
                            "match_rate": match_rate,
                            "column": column_id,
                        }
                    )
                else:
                    passed += 1
            except re.error as e:
                issues.append(
                    {
                        "rule_id": rid,
                        "type": "Regex",
                        "severity": "error",
                        "message": f"正则表达式无效: {e}",
                    }
                )

        return {
            "success": True,
            "total_rules": total,
            "passed": passed,
            "failed": total - passed,
            "issues": issues,
        }

    def _validate_constraint(
        self,
        df: pd.DataFrame,
        ctype: str,
        refs: dict[str, Any],
        params: dict[str, Any],
        rule_id: str,
    ) -> dict[str, Any]:
        """校验单个约束。"""
        column_id = refs.get("column_id", "")
        col = self._get_column(df, column_id)

        if ctype == "NotNull":
            null_count = int(col.isna().sum()) + int((col.astype(str).str.strip() == "").sum())
            total = len(col)
            if total == 0:
                return {"passed": True}
            null_rate = null_count / total
            if null_rate > 0.05:
                return {
                    "passed": False,
                    "issue": {
                        "rule_id": rule_id,
                        "type": ctype,
                        "severity": "error",
                        "message": f"空值比例 {null_rate:.1%}，不适合 NotNull 约束",
                        "null_rate": null_rate,
                        "column": column_id,
                    },
                }
            return {"passed": True}

        if ctype == "Unique":
            column_ids = refs.get("column_ids", [column_id])
            cols = [self._get_column(df, c) for c in column_ids]
            combined = pd.concat(cols, axis=1).dropna()
            if len(combined) == 0:
                return {"passed": True}
            dup_rate = 1 - float(len(combined.drop_duplicates())) / float(len(combined))
            if dup_rate > 0.05:
                return {
                    "passed": False,
                    "issue": {
                        "rule_id": rule_id,
                        "type": ctype,
                        "severity": "error",
                        "message": f"重复率 {dup_rate:.1%}，不适合 Unique 约束",
                        "dup_rate": dup_rate,
                        "columns": column_ids,
                    },
                }
            return {"passed": True}

        if ctype == "AllowedValues":
            allowed = params.get("allowed_values", [])
            if not allowed:
                return {"passed": True}
            total = len(col.dropna())
            if total == 0:
                return {"passed": True}
            invalid = col.dropna().apply(lambda x: x not in allowed)
            invalid_rate = float(invalid.sum()) / float(total)
            if invalid_rate > 0.05:
                # 收集不在白名单中的高频值
                invalid_values = col[invalid].value_counts().head(5).to_dict()
                return {
                    "passed": False,
                    "issue": {
                        "rule_id": rule_id,
                        "type": ctype,
                        "severity": "error",
                        "message": f"{invalid_rate:.1%} 的值不在允许列表中",
                        "invalid_rate": invalid_rate,
                        "invalid_values": invalid_values,
                        "column": column_id,
                    },
                }
            return {"passed": True}

        if ctype == "Range":
            min_val = params.get("min")
            max_val = params.get("max")
            numeric = pd.to_numeric(col, errors="coerce").dropna()
            if len(numeric) == 0:
                return {"passed": True}
            violations = 0
            if min_val is not None:
                violations += int((numeric < min_val).sum())
            if max_val is not None:
                violations += int((numeric > max_val).sum())
            violation_rate = violations / len(numeric)
            if violation_rate > 0.05:
                return {
                    "passed": False,
                    "issue": {
                        "rule_id": rule_id,
                        "type": ctype,
                        "severity": "error",
                        "message": f"越界比例 {violation_rate:.1%}，请调整 Range 范围",
                        "violation_rate": violation_rate,
                        "column": column_id,
                    },
                }
            return {"passed": True}

        if ctype == "ForeignKey":
            # 外键需要目标表数据，简化处理：仅检查 from_column 非空率
            from_col = self._get_column(df, refs.get("from_column_id", column_id))
            null_count = int(from_col.isna().sum())
            total = len(from_col)
            if total > 0 and null_count / total > 0.1:
                return {
                    "passed": False,
                    "issue": {
                        "rule_id": rule_id,
                        "type": ctype,
                        "severity": "warning",
                        "message": f"外键列空值比例 {(null_count / total):.1%}，可能影响引用完整性",
                        "column": refs.get("from_column_id", column_id),
                    },
                }
            return {"passed": True}

        # 其他类型默认通过
        return {"passed": True}
