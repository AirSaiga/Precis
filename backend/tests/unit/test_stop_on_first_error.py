"""@fileoverview "遇错即停"(error_handling=stop)功能测试

覆盖 validate_constraints / validate_full_dataset 在 stop_on_first_error=True 时,
发现第一个错误即停止剩余校验的行为(C6)。
"""

from __future__ import annotations

import pandas as pd

from app.shared.domain.data_types import IntegerType, StringType
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.domain.validation_constraints import NotNullConstraint
from app.shared.services.validation.engine import validate_constraints, validate_full_dataset


def _make_schema_with_multiple_constraints():
    """构造含 2 个约束的 schema:第一个 NotNull(id) 会触发错误,第二个 NotNull(name) 不应被执行。"""
    return DataSetSchema(
        tables={
            "users": TableSchema(
                id="users",
                name="users",
                columns=[
                    ColumnSchema(name="id", data_type=IntegerType()),
                    ColumnSchema(name="name", data_type=StringType()),
                ],
            )
        },
        constraints=[
            NotNullConstraint(table="users", column="id"),  # 第 1 个:id 有空值 → 会报错
            NotNullConstraint(table="users", column="name"),  # 第 2 个:name 也有空值,但应被跳过
        ],
    )


class TestValidateConstraintsStopOnFirstError:
    def test_stops_after_first_constraint_error(self):
        """stop_on_first_error=True 时,发现第一个约束错误后应停止,剩余约束不执行。

        断言:只有第 1 个约束(id)的错误,没有第 2 个约束(name)的错误,
        且 validation_details 里第 2 个约束未被记录(说明循环 break)。
        """
        schema = _make_schema_with_multiple_constraints()
        # id 和 name 都有空值,若全跑会有 2 个约束的错误
        parsed = {"users": pd.DataFrame({"id": [1, None], "name": ["a", None]})}

        errors, details = validate_constraints(parsed, schema, stop_on_first_error=True)

        # 应有错误(至少 id 的 NotNull)
        assert len(errors) >= 1
        # 关键:不应包含 name 列的 NotNull 错误(第 2 个约束被跳过)
        name_errors = [e for e in errors if e.get("column") == "name"]
        assert name_errors == [], f"stop 后不应执行第 2 个约束(name),实际: {name_errors}"
        # 应有中断标记
        interrupted = [e for e in errors if e.get("error_type") == "ValidationInterrupted"]
        assert len(interrupted) == 1, f"应有 1 条中断标记,实际 errors: {errors}"

    def test_default_continues_all_constraints(self):
        """默认(stop_on_first_error=False)应跑完所有约束,即使有错误。"""
        schema = _make_schema_with_multiple_constraints()
        parsed = {"users": pd.DataFrame({"id": [1, None], "name": ["a", None]})}

        errors, details = validate_constraints(parsed, schema)  # 默认不 stop

        # 两个约束的错误都应在(id + name)
        id_errors = [e for e in errors if e.get("column") == "id"]
        name_errors = [e for e in errors if e.get("column") == "name"]
        assert len(id_errors) >= 1
        assert len(name_errors) >= 1, f"默认应跑完所有约束,应有 name 错误,实际: {errors}"
        # 无中断标记
        interrupted = [e for e in errors if e.get("error_type") == "ValidationInterrupted"]
        assert interrupted == []

    def test_no_error_does_not_stop(self):
        """stop_on_first_error=True 但无错误时,应正常跑完(不产生中断标记)。"""
        schema = _make_schema_with_multiple_constraints()
        parsed = {"users": pd.DataFrame({"id": [1, 2], "name": ["a", "b"]})}

        errors, details = validate_constraints(parsed, schema, stop_on_first_error=True)

        assert errors == []
        interrupted = [e for e in errors if e.get("error_type") == "ValidationInterrupted"]
        assert interrupted == []


class TestValidateFullDatasetStopOnFirstError:
    def test_stops_at_format_error_stage(self):
        """stop_on_first_error=True 时,格式校验阶段发现错误即停,不进入约束校验阶段。

        构造:整数列混入非数字(格式错误),同时配 NotNull 约束。
        若 stop 生效,应在格式阶段停,约束阶段不执行(无约束错误)。
        """
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[ColumnSchema(name="id", data_type=IntegerType())],
                )
            },
            constraints=[NotNullConstraint(table="users", column="id")],
        )
        # id 列有 "abc"(格式错误)和 None(NotNull 会报,但若格式阶段已停则不执行约束)
        raw = {"users": pd.DataFrame({"id": [1, "abc"]})}

        parsed, errors, details = validate_full_dataset(raw, schema, stop_on_first_error=True)

        # 应有格式错误
        format_errors = [e for e in errors if e.get("stage") == "format"]
        assert len(format_errors) >= 1, f"应有格式错误,实际: {errors}"
        # 关键:不应有约束错误(约束阶段被跳过)
        constraint_errors = [e for e in errors if e.get("stage") == "constraint"]
        assert constraint_errors == [], f"格式阶段 stop 后不应执行约束,实际: {constraint_errors}"
        # 应有中断标记
        interrupted = [e for e in errors if e.get("error_type") == "ValidationInterrupted"]
        assert len(interrupted) >= 1

    def test_no_format_error_proceeds_to_constraints(self):
        """stop_on_first_error=True 但格式无误时,应进入约束阶段并在约束错误处停。"""
        schema = _make_schema_with_multiple_constraints()
        raw = {"users": pd.DataFrame({"id": [1, None], "name": ["a", None]})}

        parsed, errors, details = validate_full_dataset(raw, schema, stop_on_first_error=True)

        # 应有第 1 个约束(id)的错误,无第 2 个约束(name)的错误
        name_errors = [e for e in errors if e.get("column") == "name"]
        assert name_errors == [], f"约束阶段 stop 后不应执行第 2 个约束,实际: {name_errors}"
