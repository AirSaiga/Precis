"""
@fileoverview CompositeConstraint 单元测试

测试覆盖:
- logic="all" 聚合策略
- logic="any" 聚合策略
- logic="none" 聚合策略
- 空子约束列表
- 工厂递归创建 Composite
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.shared.core.project.constraint.factory import create_constraint
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.core.project.schema.types_parts.column import ColumnSpec
from app.shared.domain.constraints import CompositeConstraint, NotNullConstraint, UniqueConstraint


@pytest.fixture
def sample_datasets():
    return {
        "users": pd.DataFrame(
            {
                "id": [1, 2, 3],
                "email": ["a@test.com", "b@test.com", "a@test.com"],  # 第三个重复
                "name": ["Alice", None, "Charlie"],  # 第二个为空
            }
        )
    }


@pytest.fixture
def schema_files():
    return {
        "users": TableSchemaFile(
            id="users",
            name="users",
            columns=[
                ColumnSpec(id="id", name="id", type="integer"),
                ColumnSpec(id="email", name="email", type="string"),
                ColumnSpec(id="name", name="name", type="string"),
            ],
        )
    }


class TestCompositeConstraintLogic:
    def test_all_strategy_with_errors(self, sample_datasets):
        """logic=all 时，返回所有子约束错误的并集"""
        sub_constraints = [
            UniqueConstraint(table="users", column=["email"]),
            NotNullConstraint(table="users", column="name"),
        ]
        composite = CompositeConstraint(sub_constraints=sub_constraints, logic="all")
        result = composite.validate(sample_datasets)

        errors = result["errors"]
        # Unique 约束应发现 email 重复（2 个错误：第1行和第3行）
        # NotNull 约束应发现 name 为空（1 个错误：第2行）
        assert len(errors) >= 2

    def test_all_strategy_all_pass(self, sample_datasets):
        """logic=all 时，若全部通过则返回空错误"""
        # 使用一个不会触发错误的列
        datasets = {"users": pd.DataFrame({"id": [1, 2, 3], "email": ["a", "b", "c"]})}
        sub_constraints = [
            UniqueConstraint(table="users", column=["email"]),
        ]
        composite = CompositeConstraint(sub_constraints=sub_constraints, logic="all")
        result = composite.validate(datasets)
        assert result["errors"] == []

    def test_any_strategy_some_pass(self, sample_datasets):
        """logic=any 时，至少一个子约束通过则整体通过"""
        sub_constraints = [
            UniqueConstraint(table="users", column=["id"]),  # 会通过
            NotNullConstraint(table="users", column="name"),  # 会失败
        ]
        composite = CompositeConstraint(sub_constraints=sub_constraints, logic="any")
        result = composite.validate(sample_datasets)
        assert result["errors"] == []

    def test_any_strategy_all_fail(self, sample_datasets):
        """logic=any 时，全部子约束失败则返回复合错误"""
        sub_constraints = [
            UniqueConstraint(table="users", column=["email"]),  # 会失败
            NotNullConstraint(table="users", column="name"),  # 会失败
        ]
        composite = CompositeConstraint(sub_constraints=sub_constraints, logic="any")
        result = composite.validate(sample_datasets)
        assert len(result["errors"]) == 1
        assert "logic=any" in result["errors"][0]["message"]

    def test_none_strategy_all_fail(self, sample_datasets):
        """logic=none 时，全部子约束失败则整体通过"""
        sub_constraints = [
            UniqueConstraint(table="users", column=["email"]),  # 会失败
            NotNullConstraint(table="users", column="name"),  # 会失败
        ]
        composite = CompositeConstraint(sub_constraints=sub_constraints, logic="none")
        result = composite.validate(sample_datasets)
        assert result["errors"] == []

    def test_none_strategy_some_pass(self, sample_datasets):
        """logic=none 时，有子约束通过则返回复合错误"""
        sub_constraints = [
            UniqueConstraint(table="users", column=["id"]),  # 会通过
            NotNullConstraint(table="users", column="name"),  # 会失败
        ]
        composite = CompositeConstraint(sub_constraints=sub_constraints, logic="none")
        result = composite.validate(sample_datasets)
        assert len(result["errors"]) == 1
        assert "logic=none" in result["errors"][0]["message"]

    def test_empty_sub_constraints(self, sample_datasets):
        """空子约束列表直接视为通过"""
        composite = CompositeConstraint(sub_constraints=[], logic="all")
        result = composite.validate(sample_datasets)
        assert result["errors"] == []
        assert result["info"] == {}

    def test_all_disabled_sub_constraints(self, sample_datasets):
        """全部子约束 disabled 时视为通过"""
        sub = NotNullConstraint(table="users", column="name")
        sub.enabled = False
        composite = CompositeConstraint(sub_constraints=[sub], logic="all")
        result = composite.validate(sample_datasets)
        assert result["errors"] == []


class TestCompositeConstraintFactory:
    def test_factory_creates_composite(self, schema_files):
        """工厂能递归创建 CompositeConstraint 及其子约束"""
        const = ConstraintFile(
            id="user_group",
            type="Composite",
            enabled=True,
            refs={"table_id": "users"},
            params={
                "logic": "all",
                "sub_constraints": [
                    {
                        "id": "unique_email",
                        "type": "Unique",
                        "enabled": True,
                        "refs": {"table_id": "users", "column_ids": ["email"]},
                    },
                    {
                        "id": "not_null_name",
                        "type": "NotNull",
                        "enabled": True,
                        "refs": {"table_id": "users", "column_id": "name"},
                    },
                ],
            },
        )
        constraint, error = create_constraint(const, schema_files)
        assert error is None
        assert constraint is not None
        assert isinstance(constraint, CompositeConstraint)
        assert constraint.logic == "all"
        assert len(constraint.sub_constraints) == 2
        assert isinstance(constraint.sub_constraints[0], UniqueConstraint)
        assert isinstance(constraint.sub_constraints[1], NotNullConstraint)

    def test_factory_skips_nested_composite(self, schema_files):
        """工厂跳过嵌套的 Composite 子约束"""
        const = ConstraintFile(
            id="outer",
            type="Composite",
            enabled=True,
            refs={"table_id": "users"},
            params={
                "logic": "all",
                "sub_constraints": [
                    {
                        "id": "inner_composite",
                        "type": "Composite",
                        "enabled": True,
                        "refs": {"table_id": "users"},
                        "params": {"logic": "all", "sub_constraints": []},
                    },
                    {
                        "id": "not_null_name",
                        "type": "NotNull",
                        "enabled": True,
                        "refs": {"table_id": "users", "column_id": "name"},
                    },
                ],
            },
        )
        constraint, error = create_constraint(const, schema_files)
        assert error is None
        assert constraint is not None
        assert len(constraint.sub_constraints) == 1  # 嵌套 Composite 被跳过
        assert isinstance(constraint.sub_constraints[0], NotNullConstraint)
