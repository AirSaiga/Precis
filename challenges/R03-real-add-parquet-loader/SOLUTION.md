# R03 参考答案 — 新增 Parquet 数据源加载器

## 核心难点（为什么这题是 ★★★）

数据源系统采用**双目录 + 双注册表 + 装饰器自注册**架构。新增一种数据源需要接通
**4 个文件**（2 新建 + 2 修改），分布在两个并行的目录里，遗漏任何一侧都会导致测试失败：

1. **加载器目录**（`loaders/`）—— 把文件读成 DataFrame 的类，用 `@register_loader`
   装饰器登记进 `LOADER_REGISTRY`（类型名 → 加载器类）。
2. **规格目录**（`specs/`）—— 描述"怎么读"的 Pydantic 模型，用 `@register_source_spec`
   装饰器登记进 `SOURCE_SPEC_REGISTRY`（类型名 → 规格类），支撑多态反序列化
   （`create_spec({"type": "parquet", ...})`）。
3. 两侧各自的 `__init__.py` 用**模块级 `__getattr__` 钩子**做延迟导入 + 重导出，
   新增类型必须在对应 `__getattr__` 加分支，否则 `from ... import ParquetXxx` 失败。
   `__all__` 也要同步加（控制 `import *` 行为）。

> **两个目录必须配对**：加载器引用规格、规格用 `get_loader_class()` 反向引用加载器
> （延迟导入避免循环依赖）。两边注册表独立，但类型名（`"parquet"`）必须一致。

> **陷阱：还有一个"第三处"注册表**。`data_source/loader.py`（注意是单数，不同于
> `loaders/` 包）里有一个**函数式** `LOADER_REGISTRY`（按**文件扩展名** → 加载函数），
> 被 `data_source/__init__.py` 门面 re-export、被 `load_grouped_sources()` 批量加载用。
> 本题的测试**不**走这条路径（测试直接实例化加载器类），所以参考答案未动 `loader.py`。
> 但若要让 Parquet 进**批量加载流水线**（`load_grouped_sources`），还需在 `loader.py`
> 的 `_LOADER_FNS` 加 `".parquet"` 条目 + 写一个 `_load_parquet_with_new_loader` 包装。
> 这是"完全集成"的额外一步，题目只要求类链路打通。

## 需要改动的 4 个文件

### 1. 新建 `backend/app/shared/core/data_source/specs/parquet_source.py`

规格类，继承 `FileSourceSpec`（已提供 `path`/`mode`/`encoding`/`nrows` 等通用字段），
只加 Parquet 特有的 `engine` 字段：

```python
from __future__ import annotations
import builtins
from typing import TYPE_CHECKING, Any, ClassVar, Literal

if TYPE_CHECKING:
    from ..loaders.base import DataSourceLoader

from pydantic import Field
from .base import register_source_spec
from .file_base import FileSourceSpec


@register_source_spec
class ParquetSourceSpec(FileSourceSpec):
    source_type: ClassVar[str] = "parquet"
    type: str = "parquet"

    engine: Literal["pyarrow", "fastparquet"] = Field(
        "pyarrow", description="Parquet 读取引擎:pyarrow(默认) 或 fastparquet"
    )

    def get_loader_class(self) -> builtins.type[DataSourceLoader]:
        from ..loaders.parquet_loader import ParquetLoader  # 延迟导入，避免循环依赖
        return ParquetLoader

    def to_display_dict(self) -> dict[str, Any]:
        return {**super().to_display_dict(), "engine": self.engine}
```

关键点：
- `source_type` 与 `type` 必须一致（基类 `validate_type_match` 校验器会拒绝不匹配）。
- `@register_source_spec` 把 `ParquetSourceSpec` 登记进 `SOURCE_SPEC_REGISTRY["parquet"]`，
  使 `create_spec({"type": "parquet", ...})` 能多态反序列化。

### 2. 新建 `backend/app/shared/core/data_source/loaders/parquet_loader.py`

加载器类，继承 `DataSourceLoader[ParquetSourceSpec]`，实现 `load()`：

```python
from __future__ import annotations
from pathlib import Path
import pandas as pd

from ..specs.parquet_source import ParquetSourceSpec
from .base import DataLoadError, DataSourceLoader
from .registry import register_loader


@register_loader("parquet")
class ParquetLoader(DataSourceLoader[ParquetSourceSpec]):
    spec_class = ParquetSourceSpec

    def load(self) -> pd.DataFrame:
        try:
            read_kwargs = {"engine": self.spec.engine}
            if self.spec.nrows is not None:
                # pyarrow 引擎不支持顶层 nrows 参数，统一读后 head 截断，兼容两引擎
                df = pd.read_parquet(self.spec.path, **read_kwargs)
                return df.head(self.spec.nrows)
            return pd.read_parquet(self.spec.path, **read_kwargs)
        except FileNotFoundError as e:
            raise DataLoadError(f"文件不存在: {self.spec.path}", self.spec, e)
        except Exception as e:
            raise DataLoadError(f"Parquet 加载失败: {e}", self.spec, e)
```

关键点：
- `@register_loader("parquet")` 把 `ParquetLoader` 登记进 `LOADER_REGISTRY["parquet"]`，
  使 `get_loader_for_source_type("parquet")` / `can_load_type("parquet")` 可用。
- 失败统一包成 `DataLoadError`（与 CSVLoader / JSONLoader 一致）。
- `nrows` 复用 `FileSourceSpec` 字段；pyarrow 引擎不支持顶层 `nrows`，故用读后 `head()`。

### 3. 修改 `backend/app/shared/core/data_source/specs/__init__.py`

在模块级 `__getattr__` 加分支（延迟导入），并加入 `__all__`：

```python
    elif name == "ParquetSourceSpec":
        from .parquet_source import ParquetSourceSpec
        return ParquetSourceSpec
```

`__all__` 追加 `"ParquetSourceSpec"`。

### 4. 修改 `backend/app/shared/core/data_source/loaders/__init__.py`

同理，在 `__getattr__` 加分支：

```python
    elif name == "ParquetLoader":
        from .parquet_loader import ParquetLoader
        return ParquetLoader
```

`__all__` 追加 `"ParquetLoader"`。

## 为什么是 4 个文件而不是更多

- `register_loader` / `register_source_spec` 是**装饰器自注册**——不需要手动写
  `LOADER_REGISTRY["parquet"] = ...`，装饰器在类定义时自动登记。所以**没有**一个
  集中的"类型清单"文件要改（不像约束系统的 `CONSTRAINT_REGISTRY` 字典）。
- 测试直接 `from ...loaders.parquet_loader import ParquetLoader`，import 即触发装饰器，
  无需依赖门面 `data_source/__init__.py` 的 eager import。

## （可选）完全集成到批量加载流水线

若要让 `load_grouped_sources()`（`loader.py`）也能加载 `.parquet`：

```python
# loader.py
from app.shared.core.data_source.loaders.parquet_loader import ParquetLoader
from app.shared.core.data_source.specs.parquet_source import ParquetSourceSpec

def _load_parquet_with_new_loader(filepath, schemas, **kwargs):
    if len(schemas) != 1:
        logger.warning(f"Parquet 文件 '{filepath}' 被多个 Schema 引用，跳过。")
        return {}
    info = schemas[0]
    spec = ParquetSourceSpec.model_construct(path=filepath, nrows=info.source_config.get("nrows"))
    loader = ParquetLoader(spec)
    return {info.schema_id: loader.load()}

_LOADER_FNS = {
    ...,
    ".parquet": _load_parquet_with_new_loader,
}
```

本题测试不走这条路径，故参考答案未改 `loader.py`。

## 验证记录

- **环境**：`pyarrow 25.0.1` 已安装（`pip install pyarrow`），parquet 实际读写用例全量执行。
- 参考方案就位：`python verify.py` → **PASS**（exit 0），**25/25** 测试通过。
- 回退方案（clean repo）：`python verify.py` → **FAIL**（exit 1），
  `ModuleNotFoundError: No module named 'app.shared.core.data_source.loaders.parquet_loader'`。

## 测试覆盖（25 项，分 5 组）

| 组 | 数量 | 覆盖 |
|------|------|------|
| 加载器类实现 | 3 | 继承 DataSourceLoader、spec_class 属性、load 非抽象 |
| 加载器注册表 | 4 | LOADER_REGISTRY、get_loader_for_source_type、can_load_type |
| 规格类实现 | 9 | 继承 FileSourceSpec、source_type、engine 字段、nrows、路径校验 |
| 规格注册表 | 5 | SOURCE_SPEC_REGISTRY、get_spec_class、create_spec 多态反序列化 |
| 端到端加载 | 4 | 读真实 parquet、dtype 保留、缺失抛 DataLoadError、nrows 截断 |

> 若运行机器无 pyarrow/fastparquet，端到端加载组（4 项）会 `pytest.importorskip` 自动跳过，
> 其余 21 项注册/规格用例仍必须通过。
