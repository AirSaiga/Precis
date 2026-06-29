# JSON Schema 节点重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 JSON Schema 节点相对普通 Schema 节点的缺失功能(嵌套约束、创建入口、绑定恢复),并抽取公共连接处理层消除重复。

**Architecture:** 后端引入递归列遍历工具修复嵌套约束;前端用 Profile 配置驱动的 `useSchemaConnectionBase` 抽取 schema/jsonSchema 公共连接逻辑,补齐 jsonSchema 的 V2 恢复/同步/校验联动,并接线死代码。

**Tech Stack:** Python 3.12 + FastAPI(后端)、Vue 3 + TypeScript + Pinia + Vue Flow(前端)、pytest / vitest / Playwright(测试)

**关联 Spec:** `docs/superpowers/specs/2026-06-29-json-schema-node-redesign.md`

---

## 实施阶段总览

| 阶段 | 内容 | 风险 | 验证手段 |
|------|------|------|----------|
| Phase 1 | 后端递归 children 修复(P0) | 低,平面 schema 行为不变 | pytest |
| Phase 2 | 前端约束拖线接线(P1) | 低,纯接线 | E2E |
| Phase 3 | V2 配置恢复/同步/校验联动(P2) | 中,编排逻辑 | E2E |
| Phase 4 | 公共层抽取(Profile 架构) | 中,影响 table 回归 | 现有 E2E |
| Phase 5 | 轻微级清理 + 文档修正 | 低 | 单测 + E2E |

> **实施顺序说明**:本计划按"功能补齐优先,架构抽取随后"的稳妥顺序排列:Phase 1 → 2 → 3 → 4 → 5。Phase 3 先在 `useJsonSchemaConnectionHandler` 内直接实现 V2 恢复逻辑(功能立即生效),Phase 4 再将其随公共编排一起迁移到 base 处理器(纯重构,无行为变化)。这样每个 Phase 都产出可独立验证的成果,降低单次改动面。

---

# Phase 1: 后端嵌套约束修复(P0)

## Task 1.1: 新增递归列遍历工具

**Files:**
- Create: `backend/app/shared/core/project/schema/types_parts/column_utils.py`
- Test: `backend/tests/unit/test_column_utils.py`

- [ ] **Step 1: 写失败测试**

Create `backend/tests/unit/test_column_utils.py`:

```python
"""
@fileoverview 递归列遍历工具单元测试
验证 iter_all_columns / build_column_id_to_name_map 能递归处理嵌套 children。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.project.schema.types import ColumnSpec
from app.shared.core.project.schema.types_parts.column_utils import (
    build_column_id_to_name_map,
    iter_all_columns,
)


def _make_nested_columns():
    """构造含 2 层嵌套的列:顶层 user(对象) + 顶层 age,children 含 address.city/address.zip"""
    return [
        ColumnSpec(id="age", name="age", type="integer"),
        ColumnSpec(
            id="user",
            name="user",
            type="object",
            children=[
                ColumnSpec(id="user_name", name="name", type="string"),
                ColumnSpec(
                    id="address",
                    name="address",
                    type="object",
                    children=[
                        ColumnSpec(id="address_city", name="city", type="string"),
                        ColumnSpec(id="address_zip", name="zip", type="string"),
                    ],
                ),
            ],
        ),
    ]


class TestIterAllColumns:
    def test_flat_columns_no_children(self):
        cols = [ColumnSpec(id="a", name="a", type="string")]
        names = [c.name for c in iter_all_columns(cols)]
        assert names == ["a"]

    def test_nested_columns_recursive(self):
        names = [c.name for c in iter_all_columns(_make_nested_columns())]
        # 深度优先: age, user, name, address, city, zip
        assert names == ["age", "user", "name", "address", "city", "zip"]

    def test_empty_or_none(self):
        assert list(iter_all_columns([])) == []
        assert list(iter_all_columns(None)) == []  # type: ignore[arg-type]


class TestBuildColumnIdToNameMap:
    def test_flat_map(self):
        cols = [ColumnSpec(id="a", name="name_a", type="string")]
        assert build_column_id_to_name_map(cols) == {"a": "name_a"}

    def test_nested_map_includes_children(self):
        result = build_column_id_to_name_map(_make_nested_columns())
        assert result == {
            "age": "age",
            "user": "user",
            "user_name": "name",
            "address": "address",
            "address_city": "city",
            "address_zip": "zip",
        }

    def test_skips_none_id(self):
        # ColumnSpec 允许 id 为 None(validator 会用 name 补全,但绕过验证时可能为 None)
        col = ColumnSpec.model_construct(name="x", type="string")  # 无 id
        result = build_column_id_to_name_map([col])
        assert result == {}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/test_column_utils.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.shared.core.project.schema.types_parts.column_utils'`

- [ ] **Step 3: 实现工具函数**

Create `backend/app/shared/core/project/schema/types_parts/column_utils.py`:

```python
"""
@fileoverview 列递归遍历工具

提供递归处理 ColumnSpec(含嵌套 children)的工具函数。
平面 schema(无 children)行为等价于原顶层遍历,向后兼容。
"""

from __future__ import annotations

from collections.abc import Iterator

from app.shared.core.project.schema.types_parts.column import ColumnSpec


def iter_all_columns(columns: list[ColumnSpec] | None) -> Iterator[ColumnSpec]:
    """递归遍历列(含嵌套 children),深度优先优先遍历父节点本身。

    对无 children 的平面列,等价于直接遍历顶层(行为不变)。

    :param columns: 顶层列列表,可为 None
    :yield: 每个列(父 + 所有子孙),深度优先
    """
    for col in columns or []:
        yield col
        if col.children:
            yield from iter_all_columns(col.children)


def build_column_id_to_name_map(columns: list[ColumnSpec] | None) -> dict[str, str]:
    """递归构建 column_id -> column_name 映射。

    用于约束工厂解析 column_id 引用,确保嵌套子列上的约束也能命中。

    :param columns: 顶层列列表
    :return: {column_id: column_name},跳过 id 为 None 的列
    """
    return {c.id: c.name for c in iter_all_columns(columns) if c.id is not None}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/test_column_utils.py -v`
Expected: PASS(5 个测试全过)

- [ ] **Step 5: ruff 检查 + 提交**

```bash
cd backend && python -m ruff check --fix app/shared/core/project/schema/types_parts/column_utils.py tests/unit/test_column_utils.py
cd backend && python -m ruff format app/shared/core/project/schema/types_parts/column_utils.py tests/unit/test_column_utils.py
git add backend/app/shared/core/project/schema/types_parts/column_utils.py backend/tests/unit/test_column_utils.py
git commit -m "feat(backend): 新增递归列遍历工具 iter_all_columns / build_column_id_to_name_map"
```

---

## Task 1.2: 约束工厂改用递归列映射

**Files:**
- Modify: `backend/app/shared/core/project/constraint/factory.py:82-86`

- [ ] **Step 1: 写失败测试(嵌套列上的约束)**

Append to `backend/tests/unit/test_constraint_factory.py` 末尾新增测试类(在文件末尾追加,复用现有 `_make_schema_files` 模式):

```python
def _make_nested_schema_files():
    """构造含嵌套子列的 schema,用于测试约束引用深层字段。"""
    return {
        "users": TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(id="email", name="email", type="string"),
                ColumnSpec(
                    id="profile",
                    name="profile",
                    type="object",
                    children=[
                        ColumnSpec(id="profile_name", name="name", type="string"),
                        ColumnSpec(
                            id="address",
                            name="address",
                            type="object",
                            children=[ColumnSpec(id="address_city", name="city", type="string")],
                        ),
                    ],
                ),
            ],
        ),
    }


class TestCreateConstraintNestedColumns:
    """验证约束能作用于 JSON 嵌套子列(深层 children)。"""

    def test_not_null_on_nested_child(self):
        """NotNull 挂在 2 层嵌套子列 address.city 上应成功解析。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="NotNull",
            enabled=True,
            refs={"table_id": "users", "column_id": "address_city"},
        )
        result, error = create_constraint(cf, _make_nested_schema_files())
        assert error is None, f"嵌套子列约束应成功,但返回错误: {error}"
        assert result is not None
        assert result.table == "users"
        assert result.column == "city"

    def test_unique_on_nested_child(self):
        """Unique 挂在 1 层嵌套子列 profile.name 上应成功解析。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Unique",
            enabled=True,
            refs={"table_id": "users", "column_id": "profile_name"},
        )
        result, error = create_constraint(cf, _make_nested_schema_files())
        assert error is None
        assert result.columns == ["name"]

    def test_not_null_on_deeply_nested_grandchild(self):
        """NotNull 挂在 3 层深度的 address.city 上(column_id=address_city)。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="NotNull",
            enabled=True,
            refs={"table_id": "users", "column_id": "address_city"},
        )
        result, error = create_constraint(cf, _make_nested_schema_files())
        assert error is None
        assert result.column == "city"

    def test_flat_schema_still_works(self):
        """回归:平面 schema(无 children)的约束行为不变。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="NotNull",
            enabled=True,
            refs={"table_id": "users", "column_id": "email"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.column == "email"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/test_constraint_factory.py::TestCreateConstraintNestedColumns -v`
Expected: 前三个嵌套测试 FAIL(返回"引用的列 'xxx' 不存在"),`test_flat_schema_still_works` PASS。

- [ ] **Step 3: 修改工厂改用递归映射**

Modify `backend/app/shared/core/project/constraint/factory.py`。在文件顶部导入区(第 33 行 `from .types import ConstraintFile` 之后)新增导入:

```python
from ..schema.types_parts.column_utils import build_column_id_to_name_map
```

将第 82-86 行:

```python
    # 构建 column_id -> column_name 映射表（按 table_id 分组）
    # 结构：{table_id: {column_id: column_name, ...}, ...}
    column_name_by_table_id: dict[str, dict[str, str]] = {
        sid: {c.id: c.name for c in s.columns if c.id is not None} for sid, s in schema_files.items()
    }
```

替换为:

```python
    # 构建 column_id -> column_name 映射表（按 table_id 分组,递归含嵌套 children）
    # 结构：{table_id: {column_id: column_name, ...}, ...}
    # 注:递归遍历确保 JSON 嵌套子列上的约束也能解析列引用
    column_name_by_table_id: dict[str, dict[str, str]] = {
        sid: build_column_id_to_name_map(s.columns) for sid, s in schema_files.items()
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/test_constraint_factory.py -v`
Expected: 全部 PASS(含新嵌套测试 + 原有测试回归)

- [ ] **Step 5: 提交**

```bash
git add backend/app/shared/core/project/constraint/factory.py backend/tests/unit/test_constraint_factory.py
git commit -m "fix(backend): 约束工厂列映射改用递归 children,修复 JSON 嵌套子列约束失效"
```

---

## Task 1.3: 内嵌约束收集器改用递归列遍历

**Files:**
- Modify: `backend/app/shared/core/project/loader/loader_parts/embedded_constraints.py:141-143, 149, 158, 170-171`

- [ ] **Step 1: 写失败测试**

Create `backend/tests/unit/test_embedded_constraints_nested.py`:

```python
"""
@fileoverview 内嵌约束嵌套列解析测试
验证 collect_constraints_from_schemas 能从嵌套子列名解析回 column_id。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.loader.loader_parts.embedded_constraints import (
    collect_constraints_from_schemas,
)
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile


def _make_schema_with_nested_embedded():
    """schema 含嵌套列 + 挂在子列上的内嵌 notNull 约束。"""
    from app.shared.core.project.schema.types_parts.constraint import ConstraintItem

    return {
        "users": TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(
                    id="profile",
                    name="profile",
                    type="object",
                    children=[
                        ColumnSpec(id="address", name="address", type="object",
                                   children=[ColumnSpec(id="address_city", name="city", type="string")]),
                    ],
                ),
            ],
            constraints=[
                ConstraintItem(id="nn_city", type="NotNull", column="city", enabled=True),
            ],
        ),
    }


class TestCollectConstraintsNested:
    def test_embedded_notnull_on_nested_child_resolves_id(self):
        """内嵌 NotNull 挂在嵌套子列 city 上,应解析为 address_city 而非保留 "city"。"""
        result = collect_constraints_from_schemas(_make_schema_with_nested_embedded())
        assert "users_nn_city" in result
        cf: ConstraintFile = result["users_nn_city"]
        assert cf.refs["column_id"] == "address_city", (
            f"嵌套子列名 city 应解析为 address_city,实际: {cf.refs.get('column_id')}"
        )

    def test_flat_embedded_still_resolves(self):
        """回归:平面列内嵌约束仍正确解析。"""
        from app.shared.core.project.schema.types_parts.constraint import ConstraintItem

        schemas = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="email", name="email", type="string")],
                constraints=[ConstraintItem(id="nn", type="NotNull", column="email", enabled=True)],
            ),
        }
        result = collect_constraints_from_schemas(schemas)
        assert result["users_nn"].refs["column_id"] == "email"
```

> **注意**:`ConstraintItem` 的导入路径需在实现时确认。Step 3 会先查找实际位置。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/test_embedded_constraints_nested.py -v`
Expected: `test_embedded_notnull_on_nested_child_resolves_id` FAIL(断言 `address_city` 但实际为 `"city"`,因只在顶层遍历找不到)。

- [ ] **Step 3: 确认 ConstraintItem 导入路径并修改收集器**

先确认 `ConstraintItem` 位置(测试中已用 `from app.shared.core.project.schema.types_parts.constraint import ConstraintItem`,若运行报 ImportError,改为 `from app.shared.core.project.schema.types import ConstraintItem` 或用 grep 定位)。

Modify `backend/app/shared/core/project/loader/loader_parts/embedded_constraints.py`:

(a) 顶部导入区(第 73 行 `from app.shared.core.project.schema.types import TableSchemaFile` 之后)新增:

```python
from app.shared.core.project.schema.types_parts.column_utils import iter_all_columns
```

(b) 第 139-143 行(单列 `column`):

```python
            if constraint_item.column:
                # 在 schema.columns 中搜索 name 匹配的列，返回其 id；若找不到则保留原名称
                column_id = next(
                    (c.id for c in schema.columns if c.name == constraint_item.column), constraint_item.column
                )
                refs["column_id"] = column_id
```

替换为:

```python
            if constraint_item.column:
                # 递归遍历列(含嵌套 children)搜索 name 匹配的列,返回其 id
                column_id = next(
                    (c.id for c in iter_all_columns(schema.columns) if c.name == constraint_item.column),
                    constraint_item.column,
                )
                refs["column_id"] = column_id
```

(c) 第 146-151 行(多列 `columns`):

```python
            elif constraint_item.columns:
                column_ids = []
                for col_name in constraint_item.columns:
                    col_id = next((c.id for c in schema.columns if c.name == col_name), col_name)
                    column_ids.append(col_id)
                refs["column_ids"] = column_ids
```

替换为:

```python
            elif constraint_item.columns:
                column_ids = []
                for col_name in constraint_item.columns:
                    col_id = next(
                        (c.id for c in iter_all_columns(schema.columns) if c.name == col_name), col_name
                    )
                    column_ids.append(col_id)
                refs["column_ids"] = column_ids
```

(d) 第 156-163 行(FK 源列 `from_column`):

```python
                from_col_id = (
                    next(
                        (c.id for c in schema.columns if c.name == constraint_item.from_column),
                        constraint_item.from_column,
                    )
                    if constraint_item.from_column
                    else None
                )
```

替换为:

```python
                from_col_id = (
                    next(
                        (c.id for c in iter_all_columns(schema.columns) if c.name == constraint_item.from_column),
                        constraint_item.from_column,
                    )
                    if constraint_item.from_column
                    else None
                )
```

(e) 第 170-173 行(FK 目标列 `to_column`):

```python
                        to_col_id = next(
                            (c.id for c in to_schema.columns if c.name == constraint_item.to_column),
                            constraint_item.to_column,
                        )
```

替换为:

```python
                        to_col_id = next(
                            (c.id for c in iter_all_columns(to_schema.columns) if c.name == constraint_item.to_column),
                            constraint_item.to_column,
                        )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/test_embedded_constraints_nested.py tests/unit/test_constraint_factory.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 全量后端测试回归**

Run: `cd backend && python -m pytest -q`
Expected: 全部 PASS(确保改动未破坏其他后端逻辑)

- [ ] **Step 6: ruff + 提交**

```bash
cd backend && python -m ruff check --fix app/shared/core/project/loader/loader_parts/embedded_constraints.py
cd backend && python -m ruff format app/shared/core/project/loader/loader_parts/embedded_constraints.py
git add backend/app/shared/core/project/loader/loader_parts/embedded_constraints.py backend/tests/unit/test_embedded_constraints_nested.py
git commit -m "fix(backend): 内嵌约束收集器列解析改用递归 children"
```

---

## Task 1.4: 前端校验上下文传递列级 jsonPath

**Files:**
- Modify: `frontend/src/services/constraints/validationContext.ts:51`

- [ ] **Step 1: 确认 column.jsonPath 类型存在**

验证 `JsonSchemaColumn` 类型含 `jsonPath` 字段(已在 spec 分析中确认 `types/graph.ts` 的 `JsonSchemaColumn` 有列级 `jsonPath`)。运行:

Run: `cd frontend && npx tsc --noEmit src/services/constraints/validationContext.ts 2>&1 | head -5`
(仅确认无语法错误,完整 type-check 在后续步骤)

- [ ] **Step 2: 修改 validationContext.ts**

Modify `frontend/src/services/constraints/validationContext.ts` 第 51 行。将:

```ts
    jsonPath: (schemaData.jsonPath as string) || undefined,
```

替换为:

```ts
    // 优先使用列级 jsonPath(精确到嵌套叶子字段,如 $.user.address.city),
    // 回退到节点级 jsonPath(用于整体 JSON 路径)
    jsonPath: (column.jsonPath as string) || (schemaData.jsonPath as string) || undefined,
```

- [ ] **Step 3: type-check + lint**

Run: `cd frontend && npm run type-check`
Expected: 无错误

Run: `cd frontend && npx eslint src/services/constraints/validationContext.ts`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add frontend/src/services/constraints/validationContext.ts
git commit -m "fix(frontend): 校验上下文优先传递列级 jsonPath,修复嵌套字段定位"
```

---

# Phase 2: 前端约束拖线接线(P1)

## Task 2.1: JsonSchemaNode 接线死代码

**Files:**
- Modify: `frontend/src/components/nodes/json/JsonSchemaNode.vue:325`(解构) + `onMounted` + `defineExpose`

- [ ] **Step 1: 阅读对照参考实现**

Read `frontend/src/components/nodes/core/SchemaNode.vue:498-508`(table 版解构,作为对照)。确认 `useJsonSchemaInteractions` 的 return 已包含 `handleColumnOutputConnect`、`createTableRelation`、`watchConnectionChanges`、`initKnownEdgeIds`(见 `useJsonSchemaInteractions.ts:556-572`)。

- [ ] **Step 2: 修改 JsonSchemaNode.vue 解构**

Modify `frontend/src/components/nodes/json/JsonSchemaNode.vue` 第 325 行。将:

```ts
  const { handleKeydown, watchSourceConnection, cleanup } = useJsonSchemaInteractions(props, emit)
```

替换为:

```ts
  const {
    handleKeydown,
    watchSourceConnection,
    cleanup,
    handleColumnOutputConnect,
    createTableRelation,
    watchConnectionChanges,
    initKnownEdgeIds,
  } = useJsonSchemaInteractions(props, emit)
```

- [ ] **Step 3: onMounted 中启动 watchConnectionChanges + initKnownEdgeIds**

定位 `onMounted`(约第 485-488 行)。将:

```ts
  onMounted(() => {
    eventBus.on('validate-json-schema', handleValidateJsonSchema)
    watchSourceConnection()
  })
```

替换为:

```ts
  onMounted(() => {
    eventBus.on('validate-json-schema', handleValidateJsonSchema)
    watchSourceConnection()
    initKnownEdgeIds()
    watchConnectionChanges()
  })
```

- [ ] **Step 4: defineExpose 补充新方法**

定位 `defineExpose`(约第 506-518 行)。将:

```ts
  defineExpose({
    runValidation,
    validateAllColumns,
    hasSourceConnection,
    schemaData,
    addColumn,
    updateColumn,
    deleteColumn: deleteColumnFromData,
    handleAddRootField,
    handleClose,
    expandAll,
    collapseAll,
  })
```

替换为(新增 3 项):

```ts
  defineExpose({
    runValidation,
    validateAllColumns,
    hasSourceConnection,
    schemaData,
    addColumn,
    updateColumn,
    deleteColumn: deleteColumnFromData,
    handleAddRootField,
    handleClose,
    handleColumnOutputConnect,
    createTableRelation,
    expandAll,
    collapseAll,
  })
```

- [ ] **Step 5: type-check + lint**

Run: `cd frontend && npm run type-check`
Expected: 无错误(若报 `initKnownEdgeIds` 未使用等,确认 return 中导出了该函数)

Run: `cd frontend && npx eslint src/components/nodes/json/JsonSchemaNode.vue`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/nodes/json/JsonSchemaNode.vue
git commit -m "fix(frontend): JsonSchemaNode 接线约束拖线/外键/连接动画死代码"
```

---

# Phase 3: 数据源绑定高级流程补全(P2)

> **说明**:本阶段在 Phase 4 公共层抽取前实施,直接在 `useJsonSchemaConnectionHandler` 中补齐三块逻辑。Phase 4 会将其迁移到 base 处理器。若先做 Phase 4,则本阶段直接在 base + jsonSchema profile 中实现。

## Task 3.1: 新增 JSON schema 匹配工具

**Files:**
- Create: `frontend/src/utils/nodes/json/findMatchingJsonSchema.ts`
- Test: `frontend/tests/utils/nodes/json/findMatchingJsonSchema.test.ts`

- [ ] **Step 1: 阅读对照 findMatchingSchema**

Read `frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts:46-92`(table 版 `findMatchingSchema`,按 path+sheet 匹配)。

- [ ] **Step 2: 写失败测试**

Create `frontend/tests/utils/nodes/json/findMatchingJsonSchema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { findMatchingJsonSchema } from '@/utils/nodes/json/findMatchingJsonSchema'
import type { TableSchemaFileV2 } from '@/types/projectV2'

function makeSchema(overrides: Partial<TableSchemaFileV2> = {}): TableSchemaFileV2 {
  return {
    version: 2,
    id: 'users',
    name: 'users',
    columns: [],
    source: { path: 'data/users.json', type: 'file' },
    ...overrides,
  } as unknown as TableSchemaFileV2
}

describe('findMatchingJsonSchema', () => {
  it('path 精确匹配返回 schema', () => {
    const schemas = { users: makeSchema() }
    const result = findMatchingJsonSchema(schemas, 'data/users.json', undefined, '/proj')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('users')
  })

  it('recordPath 匹配时区分不同 recordPath', () => {
    const schemas = {
      users: makeSchema({
        id: 'users',
        source: { path: 'data/users.json', type: 'file', options: { record_path: 'records' } },
      } as unknown as TableSchemaFileV2),
    }
    // recordPath 不匹配时应返回 null
    const result = findMatchingJsonSchema(schemas, 'data/users.json', 'items', '/proj')
    expect(result).toBeNull()
    // recordPath 匹配
    const matched = findMatchingJsonSchema(schemas, 'data/users.json', 'records', '/proj')
    expect(matched?.id).toBe('users')
  })

  it('无 recordPath 约束时只按 path 匹配', () => {
    const schemas = { users: makeSchema() }
    const result = findMatchingJsonSchema(schemas, 'data/users.json', 'anything', '/proj')
    expect(result?.id).toBe('users')
  })

  it('路径不匹配返回 null', () => {
    const schemas = { users: makeSchema() }
    const result = findMatchingJsonSchema(schemas, 'data/other.json', undefined, '/proj')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd frontend && npx vitest run tests/utils/nodes/json/findMatchingJsonSchema.test.ts`
Expected: FAIL — 无法导入模块

- [ ] **Step 4: 实现匹配函数**

Create `frontend/src/utils/nodes/json/findMatchingJsonSchema.ts`:

```typescript
/**
 * @file findMatchingJsonSchema.ts
 * @description 从 V2 schema 配置中查找匹配指定 JSON 数据源的 schema。
 *
 * 匹配键:path(规范化比较)+ recordPath(若 schema 配置了 record_path 则需一致)。
 * 与 table 版 findMatchingSchema(按 path + sheet)对应。
 */

import type { TableSchemaFileV2 } from '@/types/projectV2'
import { normalizePath, resolveRelativePath } from '@/core/utils/pathNormalization'

export function findMatchingJsonSchema(
  schemas: Record<string, TableSchemaFileV2>,
  localPath: string,
  recordPath: string | undefined | null,
  configDir: string
): { id: string; schema: TableSchemaFileV2 } | null {
  const normLocal = normalizePath(localPath)

  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    if (normalizePath(absPath) !== normLocal) continue

    // 路径匹配后,若 schema 配置了 record_path,则需 recordPath 一致
    const schemaRecordPath = schema.source?.options?.record_path
    if (schemaRecordPath) {
      if (!recordPath || schemaRecordPath !== recordPath) continue
    }

    return { id, schema }
  }

  return null
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd frontend && npx vitest run tests/utils/nodes/json/findMatchingJsonSchema.test.ts`
Expected: PASS(4 个测试)

- [ ] **Step 6: 提交**

```bash
git add frontend/src/utils/nodes/json/findMatchingJsonSchema.ts frontend/tests/utils/nodes/json/findMatchingJsonSchema.test.ts
git commit -m "feat(frontend): 新增 findMatchingJsonSchema 用于 V2 配置恢复匹配"
```

---

## Task 3.2: 实现 tryLoadJsonSchemaConfig

**Files:**
- Modify: `frontend/src/composables/nodes/json/useJsonSchemaConnectionHandler.ts`

> 此 Task 较长,直接在 handler 中实现,Phase 4 再迁移到 base。实现逻辑参照 `useSchemaConnectionHandler.ts:94-220`。

- [ ] **Step 1: 阅读对照参考**

Read `frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts:94-220`(`tryLoadExistingSchemaConfig`)与 `materializeV2EmbeddedConstraints` 签名(`frontend/src/stores/graphStore/modules/v2/shared/embeddedConstraints.ts`)。

- [ ] **Step 2: 在 useJsonSchemaConnectionHandler.ts 顶部补充导入**

Modify `frontend/src/composables/nodes/json/useJsonSchemaConnectionHandler.ts`。在现有导入区(第 18-29 行后)补充:

```ts
import { useVueFlow } from '@vue-flow/core'
import { useProjectStore } from '@/stores/projectStore'
import { getV2FullConfig } from '@/api/projectV2Api'
import { findMatchingJsonSchema } from '@/utils/nodes/json/findMatchingJsonSchema'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { revalidateConstraintsReferencingSchema } from '@/services/constraints/validationRegistryCore'
import { normalizePath, resolveRelativePath } from '@/core/utils/pathNormalization'
import { toastWarning } from '@/core/toast'
import { i18n } from '@/i18n'
import type { TableSchemaFileV2 } from '@/types/projectV2'
```

- [ ] **Step 3: 实现 convertJsonColumnsFromConfig 与 tryLoadJsonSchemaConfig**

在 `useJsonSchemaConnectionHandler` 函数体内(在 `handleSourceConnection` 定义之前)新增两个函数:

```ts
  /** 从 V2 配置的 columns 递归还原 JsonSchemaColumn(含 children) */
  function convertJsonColumnsFromConfig(
    columns: TableSchemaFileV2['columns']
  ): JsonSchemaColumn[] {
    return (columns || []).map((col) => {
      const converted: JsonSchemaColumn = {
        id: col.id ?? col.name,
        columnName: col.name,
        jsonPath: col.json_path ?? `$.${col.name}`,
        dataType: (col.type as JsonSchemaColumn['dataType']) || 'string',
        nullable: true,
      }
      // 递归还原嵌套子列
      if (col.children && col.children.length > 0) {
        converted.children = convertJsonColumnsFromConfig(col.children)
      }
      return converted
    })
  }

  /** 从已保存的 V2 配置恢复 JSON Schema 的列定义 + 物化内嵌约束 */
  async function tryLoadJsonSchemaConfig(params: {
    schemaNodeId: string
    localPath: string | undefined
    recordPath: string | undefined | null
    configPath: string | undefined
    store: ReturnType<typeof useGraphStore>
    updateNodeInternals: (nodeIds?: string[]) => void
  }): Promise<boolean> {
    const { schemaNodeId, localPath, recordPath, configPath, store, updateNodeInternals } = params
    if (!localPath || !configPath) return false

    const resolvedLocalPath = resolveRelativePath(localPath, configPath) ?? localPath

    let fullConfig: Awaited<ReturnType<typeof getV2FullConfig>>
    try {
      fullConfig = await getV2FullConfig(configPath)
    } catch {
      logger.debug('🔌 [tryLoadJsonSchemaConfig] 无法加载 V2 配置')
      return false
    }

    const schemas = fullConfig.schemas || {}
    const match = findMatchingJsonSchema(schemas, resolvedLocalPath, recordPath, configPath)
    if (!match) {
      logger.debug(
        `🔌 [tryLoadJsonSchemaConfig] 未找到匹配的 schema (localPath=${localPath}, recordPath=${recordPath})`
      )
      return false
    }

    const { id: tableId, schema: schemaFile } = match
    const cols = convertJsonColumnsFromConfig(schemaFile.columns || [])

    store.updateNodeData(schemaNodeId, {
      columns: cols,
      saveState: 'saved',
    } as unknown as Record<string, unknown>)

    if (schemaNodeId !== tableId) {
      store.updateNodeData(schemaNodeId, {
        configName: tableId,
        saveState: 'modified',
      } as unknown as Record<string, unknown>)
      logger.warn(
        `[tryLoadJsonSchemaConfig] schema node ID ${schemaNodeId} differs from file ID ${tableId}`
      )
    }

    // 检测重复数据源(JSON 用 recordPath 作为额外键)
    const sourcePath = schemaFile.source?.path
    if (
      sourcePath &&
      store.schemaSourceIndex?.isDuplicateSource(sourcePath, recordPath ?? undefined, schemaNodeId)
    ) {
      const conflict = store.schemaSourceIndex.getConflictForSource(
        sourcePath,
        recordPath ?? undefined,
        schemaNodeId
      )
      const otherIds = conflict?.nodeIds.filter((id) => id !== schemaNodeId) || []
      toastWarning(
        i18n.global.t('canvas.nodeCanvas.duplicateSourceMessage', {
          source: sourcePath,
          nodes: otherIds.join(', '),
        }),
        i18n.global.t('canvas.nodeCanvas.duplicateSourceTitle')
      )
    }
    store.schemaSourceIndex?.rebuild()

    await nextTick()
    updateNodeInternals([schemaNodeId])

    // 物化内嵌约束(复用已支持 jsonSchema 的 materializeV2EmbeddedConstraints)
    const schemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)
    if (!schemaNode) return true

    const schemaData = schemaNode.data as unknown as JsonSchemaNodeData
    // 递归构建 columnName -> columnId 映射(含嵌套)
    const colNameToId = new Map<string, string>()
    const walkNames = (cols: JsonSchemaColumn[]) => {
      for (const c of cols) {
        colNameToId.set(c.columnName, c.id)
        if (c.children) walkNames(c.children)
      }
    }
    walkNames(schemaData.columns || [])

    const embedded = Array.isArray(schemaFile.constraints) ? schemaFile.constraints : []
    if (embedded.length > 0) {
      const bufferedEdges: Array<{
        tableId: string
        constraintId: string
        columnId: string
      }> = []

      materializeV2EmbeddedConstraints({
        schemaNode: schemaNode as unknown as import('@/types/graph').CustomNode,
        schemaTableName: schemaData.tableName,
        embeddedConstraints: embedded as Parameters<
          typeof materializeV2EmbeddedConstraints
        >[0]['embeddedConstraints'],
        colNameToId,
        hasNode: (id: string) => store.nodes.some((n) => n.id === id),
        addNode: (node: import('@/types/graph').CustomNode) => addNodes(node),
        addConstraintEdge: (tId: string, cId: string, colId: string) => {
          bufferedEdges.push({ tableId: tId, constraintId: cId, columnId: colId })
        },
      })

      await nextTick()
      updateNodeInternals([schemaNodeId])
      for (const edge of bufferedEdges) {
        store.createConnection(
          edge.tableId,
          edge.constraintId,
          `source-right-${edge.columnId}`,
          `target-input-${edge.constraintId}`
        )
      }
    }

    logger.debug(
      `🔌 [tryLoadJsonSchemaConfig] 已从 V2 恢复: ${cols.length} 列, ${embedded.length} 内嵌约束`
    )
    return true
  }
```

- [ ] **Step 4: 在 handleSourceConnection 中接入恢复 + 校验联动**

Modify `frontend/src/composables/nodes/json/useJsonSchemaConnectionHandler.ts` 的 `handleSourceConnection`。在函数开头获取 vueflow 与 project store,并替换结尾(第 306-336 行的 `logger.debug('连接处理完成...')` 到 `setTimeout` 段):

将结尾段:

```ts
    logger.debug('🔌 [handleSourceConnection] 连接处理完成，准备弹出确认对话框')

    await nextTick()
    const latestSourceNode = store.nodes.find((n: CustomNode) => n.id === sourcePreviewNodeId)
    const latestSchemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)

    if (latestSourceNode && latestSchemaNode) {
      try {
        const sourceDataSnapshot: JsonSourcePreviewNodeData = JSON.parse(
          JSON.stringify(latestSourceNode.data as unknown as JsonSourcePreviewNodeData)
        )
        await showSmartFillDialog(
          { id: sourcePreviewNodeId, data: sourceDataSnapshot },
          { id: schemaNodeId, data: latestSchemaNode.data as unknown as JsonSchemaNodeData }
        )
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error.message.includes('JSON 数据源为空') || error.message.includes('格式不正确'))
        ) {
          logger.warn('🎯 [handleSourceConnection] 智能填充业务跳过:', error.message)
        } else {
          throw error
        }
      }

      setTimeout(() => {
        logger.debug('🔄 [handleSourceConnection] 触发 JSON Schema 自动校验')
        eventBus.emit('validate-json-schema', { nodeId: schemaNodeId })
      }, 500)
    }
  }
```

替换为:

```ts
    logger.debug('🔌 [handleSourceConnection] 连接处理完成，准备恢复配置或弹出确认对话框')

    const { updateNodeInternals } = useVueFlow()
    const projectStore = useProjectStore()
    const configPath = projectStore.currentPaths?.configPath

    // 步骤4:尝试从 V2 配置恢复
    const loadedFromConfig = await tryLoadJsonSchemaConfig({
      schemaNodeId,
      localPath: sourceData.localPath,
      recordPath: sourceData.recordPath,
      configPath,
      store,
      updateNodeInternals,
    })

    if (!loadedFromConfig) {
      // 未恢复则回退智能填充对话框
      await nextTick()
      const latestSourceNode = store.nodes.find((n: CustomNode) => n.id === sourcePreviewNodeId)
      const latestSchemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)

      if (latestSourceNode && latestSchemaNode) {
        try {
          const sourceDataSnapshot: JsonSourcePreviewNodeData = JSON.parse(
            JSON.stringify(latestSourceNode.data as unknown as JsonSourcePreviewNodeData)
          )
          await showSmartFillDialog(
            { id: sourcePreviewNodeId, data: sourceDataSnapshot },
            { id: schemaNodeId, data: latestSchemaNode.data as unknown as JsonSchemaNodeData }
          )
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            (error.message.includes('JSON 数据源为空') || error.message.includes('格式不正确'))
          ) {
            logger.warn('🎯 [handleSourceConnection] 智能填充业务跳过:', error.message)
          } else {
            throw error
          }
        }
      }
    }

    // 步骤5:触发全局约束校验 + 重验引用该 schema 的约束
    const currentSchemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)
    const hasColumns = (currentSchemaNode?.data as unknown as JsonSchemaNodeData)?.columns?.length
    if (currentSchemaNode && hasColumns) {
      triggerValidationForNode(
        schemaNodeId,
        store.nodes,
        store.edges,
        (nodeId: string, data: Record<string, unknown>) => store.updateNodeData(nodeId, data)
      )
    }

    await revalidateConstraintsReferencingSchema({
      schemaNodeId,
      nodes: store.nodes,
      edges: store.edges,
      updateNodeData: (nodeId: string, data: Record<string, unknown>) =>
        store.updateNodeData(nodeId, data),
    })
  }
```

- [ ] **Step 5: type-check**

Run: `cd frontend && npm run type-check`
Expected: 无错误。若有 `JsonSchemaColumn` 等类型导入缺失,补 `import type { JsonSchemaColumn } from '@/types/nodes'`。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/composables/nodes/json/useJsonSchemaConnectionHandler.ts
git commit -m "feat(frontend): JsonSchema 连接处理器补齐 V2 配置恢复 + 全局校验联动"
```

---

## Task 3.3: 新增 JSON 资源同步服务

**Files:**
- Create: `frontend/src/services/jsonSchemaResourceSync.ts`
- Modify: `frontend/src/composables/nodes/json/useJsonSchemaSourceManager.ts`(注入 onSourceConnected)

> 资源同步是纯编排服务(composable 依赖 store/Vue),按 AGENTS.md 由 E2E 覆盖,不写单测。

- [ ] **Step 1: 阅读对照 schemaResourceSync**

Read `frontend/src/services/schemaResourceSync.ts`(完整阅读,理解 syncSchemaResources 的结构)。

- [ ] **Step 2: 实现 jsonSchemaResourceSync**

Create `frontend/src/services/jsonSchemaResourceSync.ts`:

```typescript
/**
 * @file jsonSchemaResourceSync.ts
 * @description JSON Schema 资源同步服务
 *
 * 数据源连接成功后,从 V2 配置拉取关联的独立约束节点、正则节点,
 * 并物化内嵌约束,创建到画布。
 *
 * 与 services/schemaResourceSync.ts(table 版)对称。
 * 资源同步是编排逻辑(依赖 store/Vue),由 E2E 覆盖,不写单测。
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { getV2FullConfig } from '@/api/projectV2Api'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { findMatchingJsonSchema } from '@/utils/nodes/json/findMatchingJsonSchema'
import type { JsonSchemaNodeData, JsonSchemaColumn, CustomNode } from '@/types/nodes'

/**
 * 同步 JSON Schema 关联资源到画布
 * @param schemaNodeId - JSON Schema 节点 ID
 */
export async function syncJsonSchemaResources(schemaNodeId: string): Promise<void> {
  const store = useGraphStore()
  const projectStore = useProjectStore()
  const configPath = projectStore.currentPaths?.configPath

  const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
  if (!schemaNode) return

  const schemaData = schemaNode.data as unknown as JsonSchemaNodeData
  if (!schemaData.localPath || !configPath) return

  let fullConfig
  try {
    fullConfig = await getV2FullConfig(configPath)
  } catch {
    logger.debug('🔄 [syncJsonSchemaResources] 无法加载 V2 配置,跳过同步')
    return
  }

  const match = findMatchingJsonSchema(
    fullConfig.schemas || {},
    schemaData.localPath,
    schemaData.recordPath,
    configPath
  )
  if (!match) {
    logger.debug('🔄 [syncJsonSchemaResources] 未找到匹配 schema,跳过同步')
    return
  }

  const { schema: schemaFile } = match
  const embedded = Array.isArray(schemaFile.constraints) ? schemaFile.constraints : []

  if (embedded.length === 0) {
    logger.debug('🔄 [syncJsonSchemaResources] 无内嵌约束,跳过')
    return
  }

  // 递归构建 columnName -> columnId 映射
  const colNameToId = new Map<string, string>()
  const walkNames = (cols: JsonSchemaColumn[]) => {
    for (const c of cols) {
      colNameToId.set(c.columnName, c.id)
      if (c.children) walkNames(c.children)
    }
  }
  walkNames(schemaData.columns || [])

  const bufferedEdges: Array<{ tableId: string; constraintId: string; columnId: string }> = []

  materializeV2EmbeddedConstraints({
    schemaNode: schemaNode as CustomNode,
    schemaTableName: schemaData.tableName,
    embeddedConstraints: embedded as Parameters<
      typeof materializeV2EmbeddedConstraints
    >[0]['embeddedConstraints'],
    colNameToId,
    hasNode: (id: string) => store.nodes.some((n) => n.id === id),
    addNode: (node: CustomNode) => addNodes(node),
    addConstraintEdge: (tId: string, cId: string, colId: string) => {
      bufferedEdges.push({ tableId: tId, constraintId: cId, columnId: colId })
    },
  })

  // 建边(内嵌约束物化后)
  for (const edge of bufferedEdges) {
    if (!store.edges.some((e) => e.source === edge.tableId && e.target === edge.constraintId)) {
      store.createConnection(
        edge.tableId,
        edge.constraintId,
        `source-right-${edge.columnId}`,
        `target-input-${edge.constraintId}`
      )
    }
  }

  logger.debug(
    `🔄 [syncJsonSchemaResources] 同步完成: ${embedded.length} 内嵌约束, ${bufferedEdges.length} 边`
  )
}
```

- [ ] **Step 3: 在 useJsonSchemaSourceManager 注入 onSourceConnected**

Read `frontend/src/composables/nodes/json/useJsonSchemaSourceManager.ts`,定位 `useNodeSourceManager` 的 options 调用(约第 210-277 行)。

在 options 对象中新增 `onSourceConnected` 回调。先在文件顶部补导入:

```ts
import { syncJsonSchemaResources } from '@/services/jsonSchemaResourceSync'
```

在 `useNodeSourceManager({...})` 的 options 对象内(参照 table 版 `useSchemaSourceManager.ts:267` 的 `onSourceConnected`)添加:

```ts
    onSourceConnected: (schemaNodeId: string) => {
      // 数据源连接成功后,从 V2 配置同步关联的约束/正则节点到画布
      syncJsonSchemaResources(schemaNodeId).catch((err) => {
        logger.warn('🔄 [useJsonSchemaSourceManager] 资源同步失败:', err)
      })
    },
```

> **注意**:需确认 `useNodeSourceManager` 的 options 类型是否接受 `onSourceConnected`。若该回调已在共享类型中定义(参照 `useSchemaSourceManager.ts` 用法),直接注入;若未定义,需在 `composables/nodes/shared/useNodeSourceManager.ts` 的 options 类型中补充可选字段 `onSourceConnected?: (schemaNodeId: string) => void` 并在连接成功处调用。Step 4 type-check 会暴露此问题。

- [ ] **Step 4: type-check + lint**

Run: `cd frontend && npm run type-check`
Expected: 无错误(若有 `onSourceConnected` 类型缺失,按 Step 3 注意项补 options 类型)

Run: `cd frontend && npx eslint src/services/jsonSchemaResourceSync.ts src/composables/nodes/json/useJsonSchemaSourceManager.ts`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/services/jsonSchemaResourceSync.ts frontend/src/composables/nodes/json/useJsonSchemaSourceManager.ts
git commit -m "feat(frontend): 新增 JSON 资源同步服务,连接数据源时恢复关联约束/正则"
```

---

# Phase 4: 公共层抽取(Profile 架构)

> **前置**:Phase 3 已在 `useJsonSchemaConnectionHandler` 实现 V2 恢复 + 校验联动。本阶段将 schema/jsonSchema 公共编排抽到 `useSchemaConnectionBase`,两 handler 瘦身为 profile + 调 base。

## Task 4.1: 定义 SchemaConnectionProfile 类型

**Files:**
- Create: `frontend/src/composables/nodes/shared/schemaConnectionProfile.ts`

- [ ] **Step 1: 实现 Profile 类型 + 两个工厂**

Create `frontend/src/composables/nodes/shared/schemaConnectionProfile.ts`:

```typescript
/**
 * @file schemaConnectionProfile.ts
 * @description Schema 连接处理 Profile 配置
 *
 * 将 schema(table)与 jsonSchema 两条数据源连接流水线的差异点收敛为声明式配置,
 * 供 useSchemaConnectionBase 统一编排。差异点共 5 个(详见接口定义)。
 */

import type { CustomNode } from '@/types/nodes'
import type { SchemaNodeData, SchemaColumn } from '@/types/graph'
import type { JsonSchemaNodeData, JsonSchemaColumn, JsonSourcePreviewNodeData } from '@/types/nodes'

/** 数据源连接编排所需的 store 简化接口 */
export interface SchemaConnectionStore {
  nodes: CustomNode[]
  edges: import('@vue-flow/core').Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  deleteConnection: (edgeId: string) => void
  createConnection: (source: string, target: string, sourceHandle: string, targetHandle: string) => void
}

/** Profile 配置:封装 schema/jsonSchema 的连接差异 */
export interface SchemaConnectionProfile<SourceData, SchemaData> {
  /** 源节点类型识别(sourcePreview / jsonSourcePreview) */
  sourceNodeType: 'sourcePreview' | 'jsonSourcePreview'
  /** 构建连接后的 schema 节点元数据增量(差异字段) */
  buildMetadata: (sourceNode: CustomNode, schemaNode: CustomNode) => Partial<SchemaData>
  /** 生成表名 */
  smartTableName: (sourceData: SourceData) => string
  /** 智能填充失败时的列生成 */
  generateColumns: (
    schemaNodeId: string,
    sourceData: SourceData,
    originalColumns: SchemaColumn[] | JsonSchemaColumn[]
  ) => void
  /** 从数据源提取列名(table 用 headerRow;json 用 rawData[0] 的 keys) */
  extractColumnNames: (sourceData: SourceData) => string[]
  /** 从 V2 配置恢复(失败回退智能填充) */
  tryLoadConfig: (params: {
    schemaNodeId: string
    sourceNode: CustomNode
    configPath: string | undefined
    store: ReturnType<typeof import('@/stores/graphStore').useGraphStore>
    updateNodeInternals: (nodeIds?: string[]) => void
  }) => Promise<boolean>
  /** 重复数据源检测的额外键(sheet / recordPath) */
  duplicateExtraKey: (sourceData: SourceData) => string | undefined
}

// 以下两个工厂函数在 Task 4.3 / 4.4 中填充实现,此处先导出占位类型供 base 引用
```

- [ ] **Step 2: type-check**

Run: `cd frontend && npm run type-check`
Expected: 无错误(纯类型定义)

- [ ] **Step 3: 提交**

```bash
git add frontend/src/composables/nodes/shared/schemaConnectionProfile.ts
git commit -m "feat(frontend): 定义 SchemaConnectionProfile 类型(公共连接层配置契约)"
```

---

## Task 4.2: 实现 useSchemaConnectionBase 公共编排

**Files:**
- Create: `frontend/src/composables/nodes/shared/useSchemaConnectionBase.ts`

> 此 Task 把 `useSchemaConnectionHandler.handleSourceToSchemaConnection` 与 `showSmartFillDialog` 的编排逻辑抽取为 profile 驱动的通用版本。

- [ ] **Step 1: 实现 base 处理器**

Create `frontend/src/composables/nodes/shared/useSchemaConnectionBase.ts`:

```typescript
/**
 * @file useSchemaConnectionBase.ts
 * @description Schema 数据源连接公共编排处理器
 *
 * 统一编排 sourcePreview→schema / jsonSourcePreview→jsonSchema 的连接流水线:
 * 1. 断开旧连接(一个 schema 只连一个数据源)
 * 2. 更新元数据(profile.buildMetadata)
 * 3. 成功 toast + 标记源端口
 * 4. tryLoadConfig(失败回退智能填充对话框)
 * 5. 触发全局校验 + revalidateConstraintsReferencingSchema
 *
 * 差异点全部通过 SchemaConnectionProfile 注入。
 */

import { logger } from '@/core/utils/logger'
import { nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useToast } from '@/composables/shared/useToast'
import { compareColumns } from '@/utils/nodes/schema/columnValidation'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { revalidateConstraintsReferencingSchema } from '@/services/constraints/validationRegistryCore'
import type { CustomNode } from '@/types/nodes'
import type { SchemaConnectionProfile } from './schemaConnectionProfile'

export function useSchemaConnectionBase<SourceData, SchemaData>(
  profile: SchemaConnectionProfile<SourceData, SchemaData>
) {
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const toast = useToast()
  const success = toast.success
  const info = toast.info
  const showError = toast.error

  const store = useGraphStore()
  const { updateNodeInternals } = useVueFlow()

  /** 处理数据源 → schema 连接 */
  const handleSourceConnection = async (connection: { source: string; target: string }) => {
    const { source: sourceNodeId, target: schemaNodeId } = connection
    const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!sourceNode || !schemaNode) return

    try {
      const sourceData = sourceNode.data as unknown as SourceData
      const sourceDataRecord = sourceData as unknown as Record<string, unknown>

      // 步骤1:断开旧连接
      const existingEdges = store.edges.filter(
        (edge) =>
          edge.target === schemaNodeId &&
          edge.source !== sourceNodeId &&
          store.nodes.find((n) => n.id === edge.source)?.type === profile.sourceNodeType
      )
      if (existingEdges.length > 0) {
        for (const edge of existingEdges) {
          store.deleteConnection(edge.id)
        }
        const displayFileName =
          (sourceDataRecord.sourceName as string) ||
          (sourceDataRecord.fileName as string) ||
          'Unknown'
        info(t('canvas.nodeCanvas.disconnectedOldSource', { sourceName: displayFileName }))
      }

      // 步骤2:更新元数据(profile 注入差异字段)
      const metadata = profile.buildMetadata(sourceNode, schemaNode)
      const smartTableName = profile.smartTableName(sourceData)
      const displayFileName =
        (sourceDataRecord.sourceName as string) ||
        (sourceDataRecord.fileName as string) ||
        'Unknown'
      const displaySourcePath =
        (sourceDataRecord.fileName as string) ||
        (sourceDataRecord.localPath as string) ||
        displayFileName

      store.updateNodeData(schemaNodeId, {
        ...(schemaNode.data as object),
        tableName: smartTableName,
        sourceFile: displayFileName,
        sourceFilePath: displaySourcePath,
        sourceNodeId,
        ...metadata,
      })

      // 步骤3:成功 toast + 标记端口
      success(
        t('canvas.nodeCanvas.connectionSuccess', { source: displayFileName, target: smartTableName })
      )
      store.updateNodeData(sourceNodeId, { ...sourceDataRecord, outputPortConnected: true })

      // 步骤4:尝试从 V2 配置恢复
      const projectStore = useProjectStore()
      const configPath = projectStore.currentPaths?.configPath
      const loadedFromConfig = await profile.tryLoadConfig({
        schemaNodeId,
        sourceNode,
        configPath,
        store,
        updateNodeInternals,
      })

      if (!loadedFromConfig) {
        await nextTick()
        const latestSource = store.nodes.find((n) => n.id === sourceNodeId)
        const latestSchema = store.nodes.find((n) => n.id === schemaNodeId)
        if (latestSource && latestSchema) {
          await showSmartFillDialog(latestSource, latestSchema)
        }
      }

      // 步骤5:触发全局校验 + 重验引用约束
      const currentSchema = store.nodes.find((n) => n.id === schemaNodeId)
      const hasColumns =
        (((currentSchema?.data as Record<string, unknown>)?.columns as unknown[])?.length || 0) > 0
      if (currentSchema && hasColumns) {
        triggerValidationForNode(
          schemaNodeId,
          store.nodes,
          store.edges,
          (nodeId, data) => store.updateNodeData(nodeId, data)
        )
      }
      await revalidateConstraintsReferencingSchema({
        schemaNodeId,
        nodes: store.nodes,
        edges: store.edges,
        updateNodeData: (nodeId, data) => store.updateNodeData(nodeId, data),
      })
    } catch (error) {
      logger.error('处理数据源到 Schema 连线失败:', error)
      showError(t('canvas.nodeCanvas.connectionFailed'))
    }
  }

  /** 智能填充询问对话框(列生成失败时回退) */
  const showSmartFillDialog = async (
    sourceNode: CustomNode,
    schemaNode: CustomNode
  ): Promise<boolean> => {
    // 完整实现:把 useSchemaConnectionHandler.ts:460-578(table 版)的三分支逻辑
    // (Case A 空列→生成 / Case B 不匹配→修正 / Case C 匹配→跳过)整体搬入此函数。
    // 改动点(仅 2 处):
    //   1. "列名提取":table 用 extractColumnNamesFromHeader(headerRow);
    //      由 profile 提供列名提取,但 json 与 table 的 sourceData 结构不同(rawData vs 二维表)。
    //      → 因此列名提取也作为 profile 的一个方法,扩展 SchemaConnectionProfile:
    //        extractColumnNames(sourceData): string[]
    //   2. "列生成":调用 profile.generateColumns(schemaNodeId, sourceData, originalColumns)。
    // dialog UI(showConfirm 三按钮)、compareColumns 比较、日志均原样搬运。
    // 因 composable 无单测,正确性由现有连接 E2E 回归保证(见 Task 4.4 Step 6)。
    return false
  }

  return {
    handleSourceConnection,
    showSmartFillDialog,
  }
}
```

> **注意**:上面的 `showSmartFillDialog` 为骨架。完整实现需把 table 版 `useSchemaConnectionHandler.ts:460-578` 的三分支逻辑(空列生成/不匹配修正/匹配跳过)搬入,其中 `extractColumnNamesFromHeader` 与 `generateColumnsFromSource` 改为委托 profile。实现时参照 table 版逐行搬运,差异点仅"列名提取方式"(table 用 headerRow;json 用 rawData[0] 的 keys)与"列生成函数"。由于这部分逻辑较长且无新增测试(composable 由 E2E 覆盖),搬运后跑现有连接 E2E 回归即可。

- [ ] **Step 2: type-check(容忍 showSmartFillDialog 骨架)**

Run: `cd frontend && npm run type-check`
Expected: 无错误(profile 类型匹配,base 尚未被调用)

- [ ] **Step 3: 提交**

```bash
git add frontend/src/composables/nodes/shared/useSchemaConnectionBase.ts
git commit -m "feat(frontend): 实现 useSchemaConnectionBase 公共连接编排(Profile 驱动)"
```

---

## Task 4.3: 抽出 table 版 findMatchingSchema 工具

**Files:**
- Create: `frontend/src/utils/nodes/schema/findMatchingSchema.ts`

- [ ] **Step 1: 抽出函数**

Read `frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts:46-92`,将 `findMatchingSchema` 函数整体移到新文件。

Create `frontend/src/utils/nodes/schema/findMatchingSchema.ts`(内容为该函数原样,加导出 + 文件头注释):

```typescript
/**
 * @file findMatchingSchema.ts
 * @description 从 V2 schema 配置中查找匹配指定数据源(table)的 schema。
 * 匹配键:path + sheet(Excel 需 sheet 精确/模糊匹配)。
 */

import type { TableSchemaFileV2 } from '@/types/projectV2'
import { normalizePath, resolveRelativePath } from '@/core/utils/pathNormalization'

export function findMatchingSchema(
  schemas: Record<string, TableSchemaFileV2>,
  localPath: string,
  sheetName: string | undefined | null,
  configDir: string
): { id: string; schema: TableSchemaFileV2 } | null {
  // —— 内容与 useSchemaConnectionHandler.ts:46-92 原函数完全一致 ——
  const normLocal = normalizePath(localPath)
  const normSheet = (sheetName || '').trim().toLowerCase()

  // 第一轮:精确匹配(路径 + sheet)
  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    const normAbs = normalizePath(absPath)
    if (normAbs !== normLocal) continue

    const isExcel = /\.(xlsx|xls)$/i.test(srcPath)
    if (isExcel) {
      const schemaSheet = (schema.source?.sheet ?? schema.sheet ?? '').trim().toLowerCase()
      if (schemaSheet === normSheet) return { id, schema }
    } else {
      return { id, schema }
    }
  }

  // 第二轮:模糊匹配(仅路径,忽略 sheet)
  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue
    if (!/\.(xlsx|xls)$/i.test(srcPath)) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    const normAbs = normalizePath(absPath)
    if (normAbs !== normLocal) continue

    const schemaSheet = (schema.source?.sheet ?? schema.sheet ?? '').trim()
    if (!schemaSheet || !sheetName) return { id, schema }
  }

  return null
}
```

- [ ] **Step 2: 更新 useSchemaConnectionHandler 导入**

Modify `frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts`:
- 删除文件内的 `findMatchingSchema` 函数定义(第 46-92 行)。
- 在导入区新增:`import { findMatchingSchema } from '@/utils/nodes/schema/findMatchingSchema'`

- [ ] **Step 3: type-check + 跑现有连接相关单测**

Run: `cd frontend && npm run type-check`
Expected: 无错误

Run: `cd frontend && npx vitest run`(若有 schema connection 相关单测,确认通过)
Expected: 相关测试 PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/utils/nodes/schema/findMatchingSchema.ts frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts
git commit -m "refactor(frontend): 抽出 findMatchingSchema 为独立工具(table 版)"
```

---

## Task 4.4: 瘦身两个连接处理器为 profile + base

**Files:**
- Modify: `frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts`
- Modify: `frontend/src/composables/nodes/json/useJsonSchemaConnectionHandler.ts`
- Modify: `frontend/src/composables/nodes/shared/schemaConnectionProfile.ts`(补两个工厂)

> 此 Task 是架构落地的核心。两个 handler 各自构造 profile 调 base,删除重复编排逻辑。

- [ ] **Step 1: 在 schemaConnectionProfile.ts 补 createSchemaProfile**

Append to `frontend/src/composables/nodes/shared/schemaConnectionProfile.ts`:

```typescript
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { useSchemaConnectionHandler } from '@/composables/nodes/schema/useSchemaConnectionHandler'
import { findMatchingSchema } from '@/utils/nodes/schema/findMatchingSchema'

// 注:工厂函数引用的恢复逻辑仍在原 handler 内,此处封装为 profile
// 为避免循环依赖,createSchemaProfile 仅组合已有函数
```

> **重要**:由于 `tryLoadConfig` 涉及大量 handler 内部逻辑(物化约束、ID 对齐等),完整迁移到 profile 工厂会引入循环依赖。**简化策略**:profile 的 `tryLoadConfig` 直接委托原 handler 内已实现的 `tryLoadExistingSchemaConfig`(table)/ `tryLoadJsonSchemaConfig`(json,Phase 3 已实现)。即:base 提供"统一编排骨架",两个 handler 各自保留"恢复函数"并注入 profile。

基于此策略,`createSchemaProfile` / `createJsonSchemaProfile` 的实现为:

```typescript
import type { SchemaColumn, JsonSchemaColumn } from '@/types/graph'

/** table schema profile */
export function createSchemaProfile(
  tryLoadExistingSchemaConfigImpl: SchemaConnectionProfile<unknown, unknown>['tryLoadConfig']
): SchemaConnectionProfile<Record<string, unknown>, import('@/types/graph').SchemaNodeData> {
  return {
    sourceNodeType: 'sourcePreview',
    buildMetadata: (sourceNode, schemaNode) => {
      const sd = sourceNode.data as Record<string, unknown>
      return {
        sourceType: sd.sourceType,
        headerRow: (sd.headerRow as number) || 0,
        sheetName: (sd.currentSheet as string) || undefined,
        sourceMode: sd.sourceMode,
        localPath: sd.localPath,
      } as Partial<import('@/types/graph').SchemaNodeData>
    },
    smartTableName: (sourceData) => {
      const sd = sourceData as Record<string, unknown>
      return (
        (sd.currentSheet as string) ||
        ((sd.sourceName as string) || (sd.fileName as string) || 'Table').replace(/\.[^/.]+$/, '')
      )
    },
    generateColumns: (schemaNodeId, sourceData, originalColumns) => {
      // 委托 table 列生成
      generateColumnsFromSource(
        /* headerRow */ (sourceData as Record<string, unknown>).data as unknown[][],
        originalColumns as SchemaColumn[],
        undefined,
        { forceReinferTypes: true }
      )
    },
    tryLoadConfig: tryLoadExistingSchemaConfigImpl,
    duplicateExtraKey: (sourceData) => (sourceData as Record<string, unknown>).currentSheet as string,
  }
}
```

> **注意**:`generateColumns` 的精确签名需对照 `generateColumnsFromSource`(utils/nodes/schema/columnGeneration.ts)调整参数。此 profile 工厂实现细节较多,实施时以"行为对齐原 handler"为准则,逐项核对。**因 composable 无单测,改动正确性由现有连接 E2E 回归保证。**

- [ ] **Step 2: 瘦身 useSchemaConnectionHandler 调用 base**

Modify `frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts`:
- 保留 `tryLoadExistingSchemaConfig`、`generateColumnsFromDataSource`、`useVirtualAnchorEdges`。
- 删除 `handleSourceToSchemaConnection`、`showSmartFillDialog` 内的编排逻辑(已搬入 base)。
- 改为构造 profile 调 base:

```ts
import { useSchemaConnectionBase } from '@/composables/nodes/shared/useSchemaConnectionBase'
import { createSchemaProfile } from '@/composables/nodes/shared/schemaConnectionProfile'

export function useSchemaConnectionHandler() {
  // tryLoadExistingSchemaConfig / generateColumnsFromDataSource 保留为模块内函数...

  const profile = createSchemaProfile(async (params) => {
    // 委托原有 tryLoadExistingSchemaConfig 逻辑
    return tryLoadExistingSchemaConfig({ ...params, sheetName: ... })
  })
  const base = useSchemaConnectionBase(profile)

  const { syncVirtualAnchorEdges, watchVirtualAnchorState } = useVirtualAnchorEdges()

  return {
    handleSourceToSchemaConnection: base.handleSourceConnection,
    showSmartFillDialog: base.showSmartFillDialog,
    generateColumnsFromDataSource,
    syncVirtualAnchorEdges,
    watchVirtualAnchorState,
  }
}
```

- [ ] **Step 3: 同样瘦身 useJsonSchemaConnectionHandler**

Modify `frontend/src/composables/nodes/json/useJsonSchemaConnectionHandler.ts`:
- 保留 `tryLoadJsonSchemaConfig`(Phase 3 已实现)、`generateColumnsFromSource`。
- 构造 json profile 调 base。
- 返回 `{ handleSourceConnection: base.handleSourceConnection, ... }`。

- [ ] **Step 4: 全量前端 type-check + lint**

Run: `cd frontend && npm run type-check`
Expected: 无错误

Run: `cd frontend && npm run lint`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/composables/nodes/shared/schemaConnectionProfile.ts frontend/src/composables/nodes/schema/useSchemaConnectionHandler.ts frontend/src/composables/nodes/json/useJsonSchemaConnectionHandler.ts
git commit -m "refactor(frontend): 两个连接处理器瘦身为 profile + base 调用,消除 ~60% 重复"
```

- [ ] **Step 6: 回归验证 — 全量前端单测**

Run: `cd frontend && npm run test`
Expected: 全部 PASS

> E2E 回归(连接、智能填充、校验联动)建议在此 Task 后手动或 CI 触发,确认 table 与 jsonSchema 连接行为均无回归。

---

# Phase 5: 轻微级清理 + 文档修正

## Task 5.1: 列生成迁移(deprecated 清理)

**Files:**
- Modify: `frontend/src/utils/nodes/json/columnGeneration.ts`
- Modify: `frontend/src/utils/nodes/columnGeneration/JsonColumnGenerator.ts`

- [ ] **Step 1: 阅读两个文件**

Read `frontend/src/utils/nodes/json/columnGeneration.ts`(找 `@deprecated` 标记与 `generateJsonColumnsFromSource` 定义,约第 392-420 行)与 `frontend/src/utils/nodes/columnGeneration/JsonColumnGenerator.ts`(策略类)。

- [ ] **Step 2: 委托实现 + 去除 deprecated**

Modify `frontend/src/utils/nodes/json/columnGeneration.ts` 的 `generateJsonColumnsFromSource` 函数:
- 内部核心列生成逻辑(从 rawData 递归推断列定义)改为调用 `JsonColumnGenerator`。
- 去掉文件顶部 `@deprecated` 注释,改为说明它是"编排层(合并旧列、保留约束/ID)",委托 `JsonColumnGenerator` 策略类。

具体:在函数内将"递归推断列定义 + 类型推断"部分替换为:

```typescript
import { JsonColumnGenerator } from '@/utils/nodes/columnGeneration/JsonColumnGenerator'

// ...在 generateJsonColumnsFromSource 内:
const generator = new JsonColumnGenerator()
const freshColumns = generator.generate(rawData)  // 策略类负责纯列生成 + 类型推断
// 保留原"合并 originalColumns 约束/ID"的编排逻辑(freshColumns 与 originalColumns merge)
```

> **注意**:精确的合并逻辑(旧列 ID/约束保留)保持不变,只把"从 rawData 生成新列"的部分委托给策略类。若 `JsonColumnGenerator.generate` 的输出格式与原内联逻辑不一致,需调整适配。实施时对照两者输出。

- [ ] **Step 3: 更新现有单测**

Run: `cd frontend && npx vitest run tests/utils/nodes/json`(若有列生成单测)
Expected: 若失败,更新测试工厂或调用以适配委托后的行为,但断言"从 rawData 生成 + 保留旧列约束"的**行为结果**不变。

- [ ] **Step 4: type-check + lint**

Run: `cd frontend && npm run type-check && npx eslint src/utils/nodes/json/columnGeneration.ts`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/utils/nodes/json/columnGeneration.ts
git commit -m "refactor(frontend): JSON 列生成委托 JsonColumnGenerator 策略类,去除 deprecated 标记"
```

---

## Task 5.2: useJsonSchemaSaving YAML 字段统一

**Files:**
- Modify: `frontend/src/composables/nodes/json/useJsonSchemaSaving.ts:146-308`

- [ ] **Step 1: 阅读现有 convertToYaml/importFromYaml**

Read `frontend/src/composables/nodes/json/useJsonSchemaSaving.ts:146-308`(`convertToYaml` 与 `importFromYaml`),定位非标准字段名:`jsonPath:`、`format:`、`recordPath:`。

- [ ] **Step 2: 统一为后端 V2 格式**

Modify `convertToYaml`:将 JSON 选项字段改为放在 `source.options` 下且使用 snake_case:
- `jsonPath` → `source.options.json_path`
- `format` → `source.options.format`
- `recordPath` → `source.options.record_path`

最简方式:复用 `services/builders/schemaBuilder.ts` 的 `buildJSONOptions()`。在 `convertToYaml` 内:

```typescript
import { buildJSONOptions } from '@/services/builders/schemaBuilder'

// 替换手动拼 jsonPath/format/recordPath 字段:
const options = buildJSONOptions(schemaData)
// 将 options 放入 source.options,而非顶层 jsonPath/format
```

Modify `importFromYaml`:对称地从 `source.options.json_path` 等读取,而非顶层 `jsonPath`。

- [ ] **Step 3: type-check + lint**

Run: `cd frontend && npm run type-check && npx eslint src/composables/nodes/json/useJsonSchemaSaving.ts`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add frontend/src/composables/nodes/json/useJsonSchemaSaving.ts
git commit -m "fix(frontend): useJsonSchemaSaving YAML 字段统一为后端 V2 格式(json_path 等)"
```

---

## Task 5.3: AGENTS.md 文档修正

**Files:**
- Modify: `AGENTS.md`(第 730-761 行「数据源绑定策略模式」章节)

- [ ] **Step 1: 阅读现有失真章节**

Read `AGENTS.md` 第 730-761 行(「数据源绑定策略模式」三小节)。

- [ ] **Step 2: 替换为真实架构描述**

将「数据源绑定策略模式」整节(从 `### 数据源绑定策略模式` 到该节结束,约第 730-761 行)替换为:

```markdown
### 数据源绑定公共层(Profile 配置驱动)

schema(table)与 jsonSchema 两条数据源连接流水线共享公共编排,差异通过声明式 `SchemaConnectionProfile` 注入。

**核心文件**:
- `composables/nodes/shared/useSchemaConnectionBase.ts` — 公共连接编排(断开旧连接/更新元数据/V2 恢复/校验联动)
- `composables/nodes/shared/schemaConnectionProfile.ts` — Profile 类型 + `createSchemaProfile` / `createJsonSchemaProfile` 工厂
- `composables/nodes/shared/useNodeSourceManager.ts` — 源管理公共层(连接/断开/智能填充)

**Profile 差异点**(5 个):源节点类型、元数据构建(sheetName vs jsonPath/recordPath/format)、表名生成、列生成函数、V2 配置恢复(匹配键 path+sheet vs path+recordPath)。

**列生成策略类**(`utils/nodes/columnGeneration/`):
- `TabularColumnGenerator.ts` — Excel/CSV 列生成策略
- `JsonColumnGenerator.ts` — JSON 对象树列生成策略
- `columnGeneration/types.ts` — 策略接口

**资源同步服务**:
- `services/schemaResourceSync.ts` — table 版,连接后从 V2 拉取约束/正则节点
- `services/jsonSchemaResourceSync.ts` — json 版,对称实现
```

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs: 修正 AGENTS.md 数据源绑定架构描述为真实 Profile 公共层"
```

---

# 最终验证

## Task 6.1: 全量测试回归

- [ ] **Step 1: 后端全量测试**

Run: `cd backend && python -m pytest -q`
Expected: 全部 PASS

- [ ] **Step 2: 前端全量单测 + type-check + lint**

Run: `cd frontend && npm run test && npm run type-check && npm run lint`
Expected: 全部 PASS

- [ ] **Step 3: ruff 全量**

Run: `cd backend && python -m ruff check . && python -m ruff format --check .`
Expected: 无错误

- [ ] **Step 4(可选,需后端运行): E2E 关键场景**

Run: `cd e2e && npx playwright test`
Expected: 现有 E2E 无回归(新增 JSON 嵌套约束 E2E 视项目 E2E 策略补充)

---

## 实施完成检查清单

- [ ] Phase 1:后端嵌套约束修复(4 Tasks)— pytest 全绿
- [ ] Phase 2:JsonSchemaNode 死代码接线(1 Task)— type-check 通过
- [ ] Phase 3:V2 恢复/同步/校验联动(3 Tasks)— type-check 通过
- [ ] Phase 4:公共层抽取(4 Tasks)— 现有连接 E2E 无回归
- [ ] Phase 5:清理 + 文档(3 Tasks)— 全量测试通过
- [ ] Task 6.1:最终全量回归全绿
