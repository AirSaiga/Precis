"""
@fileoverview 约束适配器单元测试（T48 覆盖补充）

覆盖目标:
- validators/adapter.py: ConstraintAdapter 全路径
"""

import pandas as pd

from app.shared.services.validation.validators.adapter import ConstraintAdapter


class TestConstraintAdapter:
    """ConstraintAdapter 核心功能测试。"""

    def test_basic_validate_not_null(self):
        """基本 NotNull 约束校验。"""
        from app.shared.domain.validation_constraints import NotNullConstraint

        adapter = ConstraintAdapter(
            constraint_cls=NotNullConstraint,
            column_param="column",
        )
        df = pd.DataFrame({"email": ["alice@test.com", None, "bob@test.com"]})
        result = adapter.validate(df, column="email")
        assert result is not None
        assert hasattr(result, "is_valid") or isinstance(result, dict)

    def test_basic_validate_unique(self):
        """基本 Unique 约束校验。"""
        from app.shared.domain.validation_constraints import UniqueConstraint

        adapter = ConstraintAdapter(
            constraint_cls=UniqueConstraint,
            column_param="column",
        )
        df = pd.DataFrame({"email": ["a@test.com", "b@test.com", "a@test.com"]})
        result = adapter.validate(df, column="email")
        assert result is not None

    def test_kwargs_mapping(self):
        """带参数映射的约束校验。"""
        # 使用 AllowedValuesConstraint 测试 kwargs_mapping
        from app.shared.domain.validation_constraints import AllowedValuesConstraint

        adapter = ConstraintAdapter(
            constraint_cls=AllowedValuesConstraint,
            column_param="column",
            kwargs_mapping={"allowed_values": "allowed_values"},
        )
        df = pd.DataFrame({"status": ["active", "inactive", "unknown"]})
        result = adapter.validate(df, column="status", allowed_values=["active", "inactive"])
        assert result is not None

    def test_extra_params(self):
        """带固定额外参数的约束校验。"""
        from app.shared.domain.validation_constraints import NotNullConstraint

        adapter = ConstraintAdapter(
            constraint_cls=NotNullConstraint,
            column_param="column",
            extra_params={},
        )
        df = pd.DataFrame({"col": [1, 2, 3]})
        result = adapter.validate(df, column="col")
        assert result is not None

    def test_error_formatter(self):
        """自定义错误格式化器。"""
        from app.shared.domain.validation_constraints import NotNullConstraint

        def custom_formatter(err):
            return {"custom_field": err.get("message", "error")}

        adapter = ConstraintAdapter(
            constraint_cls=NotNullConstraint,
            column_param="column",
            error_formatter=custom_formatter,
        )
        df = pd.DataFrame({"col": [None, 1, None]})
        result = adapter.validate(df, column="col")
        assert result is not None

    def test_missing_kwargs_mapping_key(self):
        """kwargs_mapping 中的 key 不在 kwargs 中时应正常处理。"""
        from app.shared.domain.validation_constraints import NotNullConstraint

        adapter = ConstraintAdapter(
            constraint_cls=NotNullConstraint,
            column_param="column",
            kwargs_mapping={"nonexistent_param": "some_param"},
        )
        df = pd.DataFrame({"col": [1, 2, 3]})
        result = adapter.validate(df, column="col")
        assert result is not None

    def test_default_init_params(self):
        """默认初始化参数应正确设置。"""
        from app.shared.domain.validation_constraints import NotNullConstraint

        adapter = ConstraintAdapter(constraint_cls=NotNullConstraint)
        assert adapter.column_param == "column"
        assert adapter.extra_params == {}
        assert adapter.kwargs_mapping == {}
        assert adapter.error_formatter is None
