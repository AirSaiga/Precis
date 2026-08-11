"""R03 — Parquet 数据源全链路测试（真实仓库）。

覆盖：加载器类实现、加载器注册表、规格类实现、规格注册表、
      从配置字典构建规格、端到端读取真实 Parquet 文件。

本文件由 verify.py 复制到 backend/tests/unit/test_r03_parquet_loader.py 运行。
"""

from __future__ import annotations

import pandas as pd
import pytest

# 导入具体类即触发 @register_loader / @register_source_spec 装饰器
from app.shared.core.data_source.loaders.parquet_loader import ParquetLoader
from app.shared.core.data_source.loaders.base import DataSourceLoader
from app.shared.core.data_source.loaders.registry import LOADER_REGISTRY
from app.shared.core.data_source.specs.parquet_source import ParquetSourceSpec
from app.shared.core.data_source.specs.base import (
    SOURCE_SPEC_REGISTRY,
    create_spec,
    get_spec_class,
)
from app.shared.core.data_source.specs.file_base import FileSourceSpec


# ============================================================================
# 1. 加载器类实现
# ============================================================================


class TestParquetLoaderClass:
    def test_inherits_data_source_loader(self):
        assert issubclass(ParquetLoader, DataSourceLoader)

    def test_has_spec_class_attribute(self):
        # 子类必须覆盖类属性 spec_class，指向对应的规格类
        assert ParquetLoader.spec_class is ParquetSourceSpec

    def test_load_method_defined(self):
        # load() 是抽象方法，子类必须实现（不再是抽象）
        assert "load" in ParquetLoader.__dict__
        assert getattr(ParquetLoader.load, "__isabstractmethod__", False) is False


# ============================================================================
# 2. 加载器注册表（类型名 → 加载器类）
# ============================================================================


class TestParquetLoaderRegistry:
    def test_registered_under_parquet(self):
        assert "parquet" in LOADER_REGISTRY

    def test_registry_points_to_parquet_loader(self):
        assert LOADER_REGISTRY["parquet"] is ParquetLoader

    def test_get_loader_for_source_type(self):
        from app.shared.core.data_source.loaders import get_loader_for_source_type

        assert get_loader_for_source_type("parquet") is ParquetLoader

    def test_can_load_type(self):
        from app.shared.core.data_source.loaders import can_load_type

        assert can_load_type("parquet") is True


# ============================================================================
# 3. 规格类实现
# ============================================================================


class TestParquetSourceSpecClass:
    def test_inherits_file_source_spec(self):
        assert issubclass(ParquetSourceSpec, FileSourceSpec)

    def test_source_type_is_parquet(self):
        assert ParquetSourceSpec.source_type == "parquet"

    def test_type_field_default_is_parquet(self):
        spec = ParquetSourceSpec(path="data.parquet")
        assert spec.type == "parquet"

    def test_get_discriminator_value(self):
        spec = ParquetSourceSpec(path="data.parquet")
        assert spec.get_discriminator_value() == "parquet"

    def test_engine_field_default(self):
        spec = ParquetSourceSpec(path="data.parquet")
        # 默认 engine 应为 pyarrow（pandas 默认且最常见）
        assert spec.engine == "pyarrow"

    def test_engine_field_custom(self):
        spec = ParquetSourceSpec(path="data.parquet", engine="fastparquet")
        assert spec.engine == "fastparquet"

    def test_get_loader_class_returns_parquet_loader(self):
        spec = ParquetSourceSpec(path="data.parquet")
        assert spec.get_loader_class() is ParquetLoader

    def test_inherits_nrows_from_file_base(self):
        spec = ParquetSourceSpec(path="data.parquet", nrows=5)
        assert spec.nrows == 5

    def test_path_validation_inherited(self):
        # FileSourceSpec 的空路径校验应被继承
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ParquetSourceSpec(path="")


# ============================================================================
# 4. 规格注册表（多态反序列化）
# ============================================================================


class TestParquetSpecRegistry:
    def test_in_source_spec_registry(self):
        assert "parquet" in SOURCE_SPEC_REGISTRY

    def test_get_spec_class_returns_parquet(self):
        assert get_spec_class("parquet") is ParquetSourceSpec

    def test_create_spec_from_dict(self):
        spec = create_spec({"type": "parquet", "path": "data.parquet"})
        assert isinstance(spec, ParquetSourceSpec)
        assert spec.path == "data.parquet"

    def test_create_spec_with_engine(self):
        spec = create_spec(
            {"type": "parquet", "path": "data.parquet", "engine": "fastparquet"}
        )
        assert isinstance(spec, ParquetSourceSpec)
        assert spec.engine == "fastparquet"

    def test_create_spec_unknown_type_still_raises(self):
        with pytest.raises(ValueError, match="未知的数据源类型"):
            create_spec({"type": "totally_unknown_type"})


# ============================================================================
# 5. 端到端加载真实 Parquet 文件
# ============================================================================

# 需要 pyarrow 或 fastparquet 才能真正读写 parquet
_parquet_engine = pytest.importorskip(
    "pyarrow", reason="pyarrow 未安装，跳过 Parquet 实际加载用例"
)


class TestParquetLoadEndToEnd:
    def test_load_returns_dataframe(self, tmp_path):
        df_in = pd.DataFrame({"id": [1, 2, 3], "name": ["a", "b", "c"]})
        pqt = tmp_path / "data.parquet"
        df_in.to_parquet(pqt)

        spec = ParquetSourceSpec(path=str(pqt), mode="absolute")
        loader = ParquetLoader(spec)
        df_out = loader.load()

        assert list(df_out.columns) == ["id", "name"]
        assert df_out.shape == (3, 2)
        assert list(df_out["id"]) == [1, 2, 3]
        assert list(df_out["name"]) == ["a", "b", "c"]

    def test_load_preserves_dtypes(self, tmp_path):
        df_in = pd.DataFrame({"value": [1.5, 2.5, 3.5]})
        pqt = tmp_path / "nums.parquet"
        df_in.to_parquet(pqt)

        spec = ParquetSourceSpec(path=str(pqt), mode="absolute")
        df_out = ParquetLoader(spec).load()
        assert str(df_out["value"].dtype).startswith("float")

    def test_load_missing_file_raises_data_load_error(self, tmp_path):
        from app.shared.core.data_source.loaders.base import DataLoadError

        spec = ParquetSourceSpec(path=str(tmp_path / "nope.parquet"), mode="absolute")
        loader = ParquetLoader(spec)
        with pytest.raises(DataLoadError):
            loader.load()

    def test_nrows_limits_rows(self, tmp_path):
        df_in = pd.DataFrame({"id": list(range(100))})
        pqt = tmp_path / "big.parquet"
        df_in.to_parquet(pqt)

        spec = ParquetSourceSpec(path=str(pqt), mode="absolute", nrows=10)
        df_out = ParquetLoader(spec).load()
        assert len(df_out) == 10
