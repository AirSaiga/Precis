"""@fileoverview 分块校验跨表/跨块约束正确性回归测试

这是 P0-2 修复的核心验证。修复前:
- 分块模式下 ForeignKeyConstraint 因目标表不在单块数据集里,产生假阳性 ConstraintConfigError
- 分块模式下 UniqueConstraint 因每块独立判重,跨块重复值漏检(假阴性)

修复后(skip_constraints 分块解析 + concat 后全量约束校验):
- FK 能同时拿到 from_table 和 to_table,正确校验
- Unique 在 concat 后的整列上判重,跨块重复被检出

本测试用真实 validate_full_dataset / validate_constraints(不 mock 引擎),
确保约束校验语义与全量模式等价。
"""

from __future__ import annotations

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock

import pandas as pd

from app.shared.domain.constraints import ForeignKeyConstraints, UniqueConstraint
from app.shared.domain.data_types import StringType
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.services.validation.engine import validate_constraints, validate_full_dataset
from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions


def _make_schema_with_fk() -> DataSetSchema:
    """构造带跨表外键的 schema:orders.user_id -> users.id"""
    return DataSetSchema(
        tables={
            "users": TableSchema(
                id="users",
                name="Users",
                columns=[ColumnSchema(name="id", id="id", data_type=StringType())],
            ),
            "orders": TableSchema(
                id="orders",
                name="Orders",
                columns=[ColumnSchema(name="user_id", id="user_id", data_type=StringType())],
            ),
        },
        constraints=[
            ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        ],
    )


def _make_schema_with_unique() -> DataSetSchema:
    """构造带唯一性约束的 schema:users.id 唯一"""
    return DataSetSchema(
        tables={
            "users": TableSchema(
                id="users",
                name="Users",
                columns=[ColumnSchema(name="id", id="id", data_type=StringType())],
            ),
        },
        constraints=[UniqueConstraint(table="users", column="id")],
    )


def _make_minimal_executor(schema: DataSetSchema):
    """创建带真实 schema 的 executor(绕过 __init__ 文件检查)"""
    executor = ValidationExecutor.__new__(ValidationExecutor)
    executor.project_root = "D:\\project"
    executor.loaded_project = MagicMock()
    executor.loaded_project.loading_errors = []
    executor.loaded_project.warnings = []
    executor.dataset_schema = schema
    executor.settings = MagicMock()
    executor.manifest = MagicMock()
    executor.allow_unsafe_eval = None
    executor._schema_by_id = {}
    executor._resolver = MagicMock()
    executor._data_loader = MagicMock()
    executor._memory_monitor = MagicMock()
    executor._memory_monitor.get_progress_info.return_value = {}
    executor._chunked_loader = None
    return executor


def _make_result_dict():
    return {
        "raw_datasets": {},
        "parsed_datasets": {},
        "errors": [],
        "loading_errors": [],
        "duration_ms": 0,
        "timeout_occurred": False,
        "validation_details": {"format_checks": [], "constraint_checks": []},
        "chunked_mode": False,
        "memory_info": {},
    }


class TestForeignKeyChunkedNoFalsePositive:
    """修复前:分块模式下 FK 误报 ConstraintConfigError;修复后应正确校验"""

    def test_chunked_fk_valid_references_pass(self):
        """分块模式下,合法外键引用不应产生假阳性"""
        schema = _make_schema_with_fk()
        executor = _make_minimal_executor(schema)

        chunked_loader = MagicMock()
        # users 和 orders 在不同"表"的不同块,模拟分块加载
        chunked_loader.load_chunked_sources.return_value = {
            "users": [pd.DataFrame({"id": ["u1", "u2"]})],
            "orders": [pd.DataFrame({"user_id": ["u1", "u2"]})],
        }
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        import time

        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), time.monotonic(), _make_result_dict()
        )

        # 不应有 ConstraintConfigError(假阳性)——FK 引用全部合法
        config_errors = [e for e in result["errors"] if e.get("error_type") == "ConstraintConfigError"]
        assert config_errors == [], f"FK 出现假阳性: {config_errors}"
        # 不应有任何 FK 违规错误(error_type 为 ForeignKeyViolation)
        fk_errors = [e for e in result["errors"] if "foreignkey" in str(e.get("error_type", "")).lower()]
        assert fk_errors == [], f"合法 FK 被误报为违规: {fk_errors}"

    def test_chunked_fk_invalid_references_detected(self):
        """分块模式下,真正的 FK 违规应被检出"""
        schema = _make_schema_with_fk()
        executor = _make_minimal_executor(schema)

        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {
            "users": [pd.DataFrame({"id": ["u1", "u2"]})],
            "orders": [pd.DataFrame({"user_id": ["u1", "u_nonexistent"]})],
        }
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        import time

        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), time.monotonic(), _make_result_dict()
        )

        # 应检出 1 个 FK 违规(u_nonexistent 不在 users.id 中)
        # error_type 为 ForeignKeyViolation
        fk_errors = [e for e in result["errors"] if "foreignkey" in str(e.get("error_type", "")).lower()]
        assert len(fk_errors) >= 1, "FK 违规未被检出(应检出 u_nonexistent)"
        # 不应有假阳性 ConstraintConfigError
        config_errors = [e for e in result["errors"] if e.get("error_type") == "ConstraintConfigError"]
        assert config_errors == []


class TestUniqueChunkedNoFalseNegative:
    """修复前:分块模式下跨块重复漏检(假阴性);修复后应检出"""

    def test_chunked_unique_cross_chunk_duplicate_detected(self):
        """重复值分布在两个不同 chunk 中,应被检出(修复前漏检)"""
        schema = _make_schema_with_unique()
        executor = _make_minimal_executor(schema)

        chunked_loader = MagicMock()
        # 两个 chunk,各自内部唯一,但跨块有重复值 "u1"
        chunked_loader.load_chunked_sources.return_value = {
            "users": [
                pd.DataFrame({"id": ["u1", "u2"]}),
                pd.DataFrame({"id": ["u1", "u3"]}),  # u1 与第一块重复
            ],
        }
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        import time

        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), time.monotonic(), _make_result_dict()
        )

        # 应检出 unique 违规(u1 在 chunk0 和 chunk1 各出现一次)
        unique_errors = [e for e in result["errors"] if "unique" in str(e.get("error_type", "")).lower()]
        assert len(unique_errors) >= 1, "跨块 unique 重复未被检出(假阴性,修复前会漏)"

    def test_chunked_unique_no_false_positive_when_distinct(self):
        """各 chunk 内部各自唯一,跨块也无重复时,不应误报"""
        schema = _make_schema_with_unique()
        executor = _make_minimal_executor(schema)

        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {
            "users": [
                pd.DataFrame({"id": ["u1", "u2"]}),
                pd.DataFrame({"id": ["u3", "u4"]}),
            ],
        }
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        import time

        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), time.monotonic(), _make_result_dict()
        )

        unique_errors = [e for e in result["errors"] if "unique" in str(e.get("error_type", "")).lower()]
        assert unique_errors == [], f"无重复却误报 unique 违规: {unique_errors}"


class TestChunkedEquivalentToFull:
    """分块模式校验结果应与全量模式语义等价(对同一份数据)"""

    def test_unique_equivalence_chunked_vs_full(self):
        """同一份数据,分块与全量的 unique 违规检出应一致"""
        schema = _make_schema_with_unique()

        # 全量校验
        full_raw = {"users": pd.DataFrame({"id": ["u1", "u2", "u1", "u3"]})}
        _, full_errors, _ = validate_full_dataset(full_raw, schema)
        full_unique = [e for e in full_errors if "unique" in str(e.get("error_type", "")).lower()]

        # 模拟分块(拆成两块)
        executor = _make_minimal_executor(schema)
        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {
            "users": [
                pd.DataFrame({"id": ["u1", "u2"]}),
                pd.DataFrame({"id": ["u1", "u3"]}),
            ],
        }
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        import time

        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), time.monotonic(), _make_result_dict()
        )
        chunked_unique = [e for e in result["errors"] if "unique" in str(e.get("error_type", "")).lower()]

        # 两者都应检出 unique 违规,且数量一致(违规的行数相同)
        assert len(full_unique) > 0, "全量模式应检出重复"
        assert len(chunked_unique) > 0, "分块模式应检出重复"
        assert len(chunked_unique) == len(full_unique), (
            f"分块与全量 unique 检出数不一致: 全量={len(full_unique)}, 分块={len(chunked_unique)}"
        )


class TestValidateConstraintsIsolated:
    """validate_constraints 独立函数行为"""

    def test_empty_datasets_skips_constraints(self):
        """全空数据集应跳过约束校验"""
        schema = _make_schema_with_unique()
        errors, details = validate_constraints({"users": pd.DataFrame({"id": []})}, schema)
        assert errors == []
        assert details["constraint_checks"] == []

    def test_validate_constraints_runs_on_parsed(self):
        """validate_constraints 对已解析数据正常执行约束"""
        schema = _make_schema_with_unique()
        parsed = {"users": pd.DataFrame({"id": ["u1", "u1"]})}
        errors, details = validate_constraints(parsed, schema)
        unique_errors = [e for e in errors if "unique" in str(e.get("error_type", "")).lower()]
        assert len(unique_errors) >= 1
        assert any(c["passed"] is False for c in details["constraint_checks"])


class TestTransformDagChunkedCorrectness:
    """分块模式下 Transform DAG 正确性

    修复前:行变 transform(DropDuplicates/FilterRows)在分块下逐块执行,
    跨块去重失效,结果与全量不一致。修复后 DAG 移到 concat 全量 parsed 后执行。
    """

    def _make_schema_for_dedup(self) -> tuple[DataSetSchema, str]:
        """构造 users 表(id 列)的 schema,返回 (schema, table_id)"""
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="Users",
                    columns=[ColumnSchema(name="id", id="id", data_type=StringType())],
                ),
            },
            constraints=[],
        )
        return schema, "users"

    def test_chunked_dedup_removes_cross_chunk_duplicates(self):
        """DropDuplicates 应跨块去重:两块各有重复值,全量去重后行数正确"""
        from app.shared.core.project.transform.types import TransformFile

        schema, table_id = self._make_schema_for_dedup()
        executor = _make_minimal_executor(schema)

        # 构造 DropDuplicates transform(对全列去重)
        tfile = TransformFile(
            id="t_dedup",
            type="DropDuplicates",
            input_from_node=table_id,
            params={"subset": "id", "keep": "first"},
            output_columns=[],
        )
        executor.loaded_project.transform_files = {"t_dedup.yaml": tfile}
        executor.loaded_project.regex_node_files = None

        chunked_loader = MagicMock()
        # 两块:chunk0=[u1,u2],chunk1=[u1,u3];u1 跨块重复
        chunked_loader.load_chunked_sources.return_value = {
            "users": [
                pd.DataFrame({"id": ["u1", "u2"]}),
                pd.DataFrame({"id": ["u1", "u3"]}),
            ],
        }
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        import time

        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), time.monotonic(), _make_result_dict()
        )

        # 全量去重后应剩 3 行(u1,u2,u3),修复前会剩 4 行(块内各去重一次,u1 在两块各保留)
        parsed = result["parsed_datasets"].get("users")
        assert parsed is not None, "DAG 执行后 parsed_datasets 应含 users 表"
        assert len(parsed) == 3, (
            f"跨块去重失败:期望 3 行(u1,u2,u3),实际 {len(parsed)} 行。"
            f"修复前会因逐块去重保留 4 行(块0去重后[u1,u2],块1去重后[u1,u3])。"
        )
        assert set(parsed["id"].tolist()) == {"u1", "u2", "u3"}

    def test_chunked_dedup_equivalent_to_full(self):
        """分块去重结果应与全量去重等价"""
        from app.shared.core.project.transform.types import TransformFile
        from app.shared.services.validation.engine import validate_full_dataset

        schema, table_id = self._make_schema_for_dedup()
        tfile = TransformFile(
            id="t_dedup",
            type="DropDuplicates",
            input_from_node=table_id,
            params={"subset": "id", "keep": "first"},
            output_columns=[],
        )

        # 全量:一次性传入所有数据 + transform_files
        full_raw = {"users": pd.DataFrame({"id": ["u1", "u2", "u1", "u3", "u2"]})}
        full_parsed, _, _ = validate_full_dataset(full_raw, schema, transform_files={"t_dedup.yaml": tfile})
        full_count = len(full_parsed["users"])

        # 分块:拆成两块
        executor = _make_minimal_executor(schema)
        executor.loaded_project.transform_files = {"t_dedup.yaml": tfile}
        executor.loaded_project.regex_node_files = None
        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {
            "users": [
                pd.DataFrame({"id": ["u1", "u2", "u1"]}),
                pd.DataFrame({"id": ["u3", "u2"]}),
            ],
        }
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        import time

        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), time.monotonic(), _make_result_dict()
        )
        chunked_count = len(result["parsed_datasets"]["users"])

        assert full_count == chunked_count == 3, f"分块与全量去重不一致:全量={full_count},分块={chunked_count},期望=3"
