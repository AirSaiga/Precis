# data_engine 嵌套列处理修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 JSON 嵌套对象字段经 json_normalize 展平后,与 schema 树形建模不一致导致的全量校验 format 阶段"缺少列"错误,使嵌套叶子字段的约束能真正生效。

**Architecture:** 利用 json_normalize 已产生点分列(`profile.name`)的洞察,统一命名约定:factory 列映射递归生成「父.子」全限定名,format 校验跳过 JsonObject 顶层列并递归校验叶子子列(以全限定名),约束用 `df['profile.name']` 直接取值。

**Tech Stack:** Python 3.12 + pandas(json_normalize)、pytest(TDD)、Playwright(E2E)

**关联 Spec:** `docs/superpowers/specs/2026-06-30-data-engine-nested-column-fix.md`

---

## 实施阶段总览

| 阶段 | 内容 | 验证 |
|------|------|------|
| Task 1 | column_utils 列映射生成全限定名 | pytest |
| Task 2 | factory 回归测试更新(全限定名断言) | pytest |
| Task 3 | data_engine format 校验递归处理 JsonObject 列 | pytest |
| Task 4 | E2E 重新启用嵌套对象约束测试 | Playwright |

---

# Task 1: column_utils 列映射生成全限定名

**Files:**
- Modify: `backend/app/shared/core/project/schema/types_parts/column_utils.py`
- Test: `backend/tests/unit/test_column_utils.py`

- [ ] **Step 1: 更新现有测试为全限定名断言(失败测试)**

修改 `backend/tests/unit/test_column_utils.py` 的 `TestBuildColumnIdToNameMap`。将现有嵌套断言改为全限定名:

```python
    def test_nested_map_includes_children(self):
        result = build_column_id_to_name_map(_make_nested_columns())
        assert result == {
            "age": "age",
            "user": "user",
            "user_name": "user.name",          # 改:原为 "name"
            "address": "user.address",          # 改:原为 "address"
            "address_city": "user.address.city",# 改:原为 "city"
            "address_zip": "user.address.zip",  # 改:原为 "zip"
        }
```

并新增深层嵌套测试(在 `TestBuildColumnIdToNameMap` 类内追加):

```python
    def test_flat_map_still_works(self):
        """平面列(无 children)映射为自身名,向后兼容。"""
        cols = [ColumnSpec(id="a", name="name_a", type="string")]
        assert build_column_id_to_name_map(cols) == {"a": "name_a"}

    def test_deeply_nested_qualified_name(self):
        """3 层嵌套叶子列应生成完整全限定名。"""
        cols = [
            ColumnSpec(
                id="root", name="root", type="object",
                children=[
                    ColumnSpec(
                        id="mid", name="mid", type="object",
                        children=[ColumnSpec(id="leaf", name="leaf", type="string")],
                    ),
                ],
            ),
        ]
        result = build_column_id_to_name_map(cols)
        assert result == {
            "root": "root",
            "mid": "root.mid",
            "leaf": "root.mid.leaf",
        }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/test_column_utils.py -v`
Expected: `test_nested_map_includes_children` 和 `test_deeply_nested_qualified_name` FAIL(当前映射为叶子名,非全限定名);`test_flat_map_still_works` PASS。

- [ ] **Step 3: 实现全限定名映射**

修改 `backend/app/shared/core/project/schema/types_parts/column_utils.py`,替换 `build_column_id_to_name_map` 实现,并新增 `_collect_qualified_names` 辅助函数:

```python
def build_column_id_to_name_map(columns: list[ColumnSpec] | None) -> dict[str, str]:
    """递归构建 column_id -> column_name 映射。

    嵌套子列用「父.子」全限定名(与 json_normalize 展平后的点分列一致),
    使约束能直接 df['profile.name'] 取值。
    平面列(无父)映射为自身名。

    :param columns: 顶层列列表
    :return: {column_id: 全限定列名},跳过 id 为 None 的列
    """
    result: dict[str, str] = {}
    _collect_qualified_names(columns or [], "", result)
    return result


def _collect_qualified_names(
    columns: list[ColumnSpec], parent_path: str, result: dict[str, str]
) -> None:
    """递归收集 column_id -> 全限定列名。

    :param columns: 当前层级的列列表
    :param parent_path: 父级全限定路径(空串表示顶层)
    :param result: 累积结果的字典
    """
    prefix = f"{parent_path}." if parent_path else ""
    for col in columns:
        qualified_name = f"{prefix}{col.name}"
        if col.id is not None:
            result[col.id] = qualified_name
        if col.children:
            _collect_qualified_names(col.children, qualified_name, result)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/unit/test_column_utils.py -v`
Expected: 全部 PASS(6 个测试)

- [ ] **Step 5: ruff + 提交**

```bash
cd backend && python -m ruff check --fix app/shared/core/project/schema/types_parts/column_utils.py tests/unit/test_column_utils.py
cd backend && python -m ruff format app/shared/core/project/schema/types_parts/column_utils.py tests/unit/test_column_utils.py
git add backend/app/shared/core/project/schema/types_parts/column_utils.py backend/tests/unit/test_column_utils.py
git commit -m "feat(backend): 列映射生成父.子全限定名,对齐 json_normalize 点分列"
```

---

# Task 2: factory 嵌套约束回归测试更新(全限定名)

**Files:**
- Test: `backend/tests/unit/test_constraint_factory.py`(上一轮新增的 `TestCreateConstraintNestedColumns`)

> Task 1 改了列映射,`create_constraint` 返回的 `result.column` 现在是全限定名。需更新断言。

- [ ] **Step 1: 更新嵌套约束测试断言为全限定名**

修改 `backend/tests/unit/test_constraint_factory.py` 的 `TestCreateConstraintNestedColumns` 类。注意其 schema 结构:
- `profile`(顶层 JsonObject)→ children: `name`(col id `profile_name`), `address`(col id `address`)→ children: `city`(col id `address_city`)

更新断言:

```python
    def test_not_null_on_nested_child(self):
        """NotNull 挂在嵌套子列 city 上应解析为全限定名。"""
        cf = ConstraintFile(
            version=2, id="c1", type="NotNull", enabled=True,
            refs={"table_id": "users", "column_id": "address_city"},
        )
        result, error = create_constraint(cf, _make_nested_schema_files())
        assert error is None, f"嵌套子列约束应成功,但返回错误: {error}"
        assert result is not None
        assert result.table == "users"
        assert result.column == "profile.address.city"   # 改:原为 "city"

    def test_unique_on_nested_child(self):
        """Unique 挂在嵌套子列 name 上应解析为全限定名。"""
        cf = ConstraintFile(
            version=2, id="c1", type="Unique", enabled=True,
            refs={"table_id": "users", "column_id": "profile_name"},
        )
        result, error = create_constraint(cf, _make_nested_schema_files())
        assert error is None
        assert result.columns == ["profile.name"]         # 改:原为 ["name"]

    def test_not_null_on_deeply_nested_grandchild(self):
        """NotNull 挂在深层 city 上应解析为 3 段全限定名。"""
        cf = ConstraintFile(
            version=2, id="c1", type="NotNull", enabled=True,
            refs={"table_id": "users", "column_id": "address_city"},
        )
        result, error = create_constraint(cf, _make_nested_schema_files())
        assert error is None
        assert result.column == "profile.address.city"   # 改:原为 "city"

    def test_flat_schema_still_works(self):
        """回归:平面 schema(无 children)的约束行为不变。"""
        cf = ConstraintFile(
            version=2, id="c1", type="NotNull", enabled=True,
            refs={"table_id": "users", "column_id": "email"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.column == "email"                   # 不变
```

- [ ] **Step 2: 运行测试确认通过(Task 1 已改实现,断言更新后应直接通过)**

Run: `cd backend && python -m pytest tests/unit/test_constraint_factory.py::TestCreateConstraintNestedColumns -v`
Expected: 全部 PASS(4 个测试)

- [ ] **Step 3: 全量后端测试回归**

Run: `cd backend && python -m pytest -q`
Expected: 全部 PASS(确认全限定名改动未破坏其他测试)

- [ ] **Step 4: ruff + 提交**

```bash
cd backend && python -m ruff check --fix tests/unit/test_constraint_factory.py
cd backend && python -m ruff format tests/unit/test_constraint_factory.py
git add backend/tests/unit/test_constraint_factory.py
git commit -m "test(backend): 嵌套约束断言更新为父.子全限定名"
```

---

# Task 3: data_engine format 校验递归处理 JsonObject 列

**Files:**
- Modify: `backend/app/shared/domain/data_engine.py:277-305`(列遍历循环)
- Test: `backend/tests/unit/test_data_engine.py`

- [ ] **Step 1: 写失败测试(嵌套对象列不报 MissingColumn)**

在 `backend/tests/unit/test_data_engine.py` 的 `TestProcessDataframe` 类内追加测试:

```python
    def test_json_object_column_not_missing(self):
        """JsonObject 顶层列(有 children)经 json_normalize 展平后不应报 MissingColumn。

        场景:profile 是 JsonObject 列,数据经 json_normalize 展平为 profile.name 点分列。
        改动前:报"缺少列 'profile'"(顶层列消失)。
        改动后:跳过 profile 顶层列检查,递归校验叶子子列 profile.name。
        """
        # 模拟 json_normalize 展平后的 DataFrame(点分列)
        df = pd.DataFrame({"id": [1, 2], "profile.name": ["Alice", "Bob"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(
                    name="profile", data_type=JsonObjectType(),
                    children=[ColumnSchema(name="name", data_type=StringType())],
                ),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        # 不应有针对 'profile' 的 MissingColumn 错误
        missing = [e for e in errors if e["error_type"] == "MissingColumn"]
        assert missing == [], f"不应有 MissingColumn 错误,实际: {missing}"
        # 叶子子列 profile.name 应被校验(存在于 parsed)
        assert "profile.name" in parsed.columns

    def test_nested_leaf_column_validated(self):
        """嵌套叶子子列(profile.name)应通过类型校验。"""
        df = pd.DataFrame({"id": [1], "profile.name": ["Alice"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(
                    name="profile", data_type=JsonObjectType(),
                    children=[ColumnSchema(name="name", data_type=StringType())],
                ),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        assert "profile.name" in parsed.columns
        assert len(errors) == 0

    def test_flat_column_missing_still_reported(self):
        """回归:平面列缺失仍报 MissingColumn(确保递归改动不破坏平面场景)。"""
        df = pd.DataFrame({"id": [1]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        missing = [e for e in errors if e["error_type"] == "MissingColumn"]
        assert len(missing) == 1
        assert missing[0]["column"] == "name"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/unit/test_data_engine.py::TestProcessDataframe::test_json_object_column_not_missing tests/unit/test_data_engine.py::TestProcessDataframe::test_nested_leaf_column_validated -v`
Expected: 两个新测试 FAIL(当前报"缺少列 'profile'");`test_flat_column_missing_still_reported` PASS。

- [ ] **Step 3: 确认 JsonObjectType 导入**

检查 `backend/app/shared/domain/data_engine.py` 顶部是否已导入 `JsonObjectType`。若未导入,在导入区添加:

```python
from app.shared.domain.data_types_parts.json_types import JsonObjectType
```

运行确认:`cd backend && grep -n "JsonObjectType" app/shared/domain/data_engine.py`
若已有则跳过此步。

- [ ] **Step 4: 新增递归列处理函数**

在 `backend/app/shared/domain/data_engine.py` 中,在 `process_dataframe` 函数定义**之前**(文件中 `_expand_structured_columns` 函数之后),新增递归处理函数:

```python
def _process_columns_recursive(
    df: pd.DataFrame,
    schema_columns: dict[str, ColumnSchema],
    parent_path: str,
    parsed_data: dict[str, list],
    errors: list[dict],
    num_rows: int,
) -> None:
    """递归处理 schema 列。

    JsonObject 列(有 children)跳过自身列检查,递归处理叶子子列。
    叶子列以「父.子」全限定名参与校验(对应 json_normalize 点分列)。
    平面列(无父)全限定名即自身名,行为不变。

    :param df: 待处理的 DataFrame
    :param schema_columns: 当前层级的列字典 {name: ColumnSchema}
    :param parent_path: 父级全限定路径(空串表示顶层)
    :param parsed_data: 累积解析列数据的字典
    :param errors: 累积错误的列表
    :param num_rows: 原始行数(用于缺失列填充)
    """
    prefix = f"{parent_path}." if parent_path else ""
    for col_name, col_schema in schema_columns.items():
        # 跳过派生列(Extracted 类型),它们不存在于原始数据中
        if hasattr(col_schema.data_type, "name") and col_schema.data_type.name == "Extracted":
            continue

        qualified = f"{prefix}{col_name}"

        # JsonObject 列(有 children):递归处理子列,跳过自身列检查
        # children 是 list[ColumnSchema],转为 {name: col} dict 以复用递归
        if isinstance(col_schema.data_type, JsonObjectType) and col_schema.children:
            child_dict = {c.name: c for c in col_schema.children}
            _process_columns_recursive(df, child_dict, qualified, parsed_data, errors, num_rows)
            continue

        # 叶子列(含平面列和嵌套叶子):按全限定名检查存在性
        if qualified not in df.columns:
            errors.append(
                {
                    "row_index": None,
                    "column": qualified,
                    "value": None,
                    "error_type": "MissingColumn",
                    "error_message": f"数据表中缺少必需的列 '{qualified}'",
                }
            )
            parsed_data[qualified] = [None] * num_rows
            continue

        # 类型校验(用全限定名取列)
        nullable = getattr(col_schema, "nullable", True)
        parsed_series, col_errors = col_schema.data_type.process_column(
            df[qualified], qualified, nullable=nullable
        )
        parsed_data[qualified] = parsed_series
        errors.extend(col_errors)
```

> **注意**:需确认 `ColumnSchema` 在 data_engine.py 已导入。运行 `grep -n "ColumnSchema" app/shared/domain/data_engine.py` 确认;若未导入,顶部添加 `from app.shared.domain.dataset_schema import ColumnSchema`。

- [ ] **Step 5: 替换 process_dataframe 的列遍历循环**

修改 `backend/app/shared/domain/data_engine.py` 的 `process_dataframe` 函数。将第 276-305 行的列遍历循环:

```python
    # 按 schema 定义的顺序逐列处理
    for col_name, col_schema in schema.columns.items():
        # 跳过派生列（Extracted 类型），它们不存在于原始数据中，由后续提取逻辑生成
        if hasattr(col_schema.data_type, "name") and col_schema.data_type.name == "Extracted":
            continue

        # 情况 1：schema 中定义的列在原始数据中不存在
        if col_name not in df.columns:
            # 记录 MissingColumn 错误，row_index 为 None 表示整列缺失
            errors.append(
                {
                    "row_index": None,
                    "column": col_name,
                    "value": None,
                    "error_type": "MissingColumn",
                    "error_message": f"数据表中缺少必需的列 '{col_name}'",
                }
            )
            # 用 None 填充整列，保持解析后 DataFrame 的列数与 schema 一致
            parsed_data[col_name] = [None] * num_rows
            continue

        # 从列 schema 中读取 nullable 属性，默认为 True（向后兼容）
        nullable = getattr(col_schema, "nullable", True)

        # 使用 DataType 的 process_column 进行向量化验证和解析
        # 向量化处理比逐行循环性能更高，且统一收集该列的全部错误
        parsed_series, col_errors = col_schema.data_type.process_column(df[col_name], col_name, nullable=nullable)
        parsed_data[col_name] = parsed_series
        errors.extend(col_errors)
```

替换为递归调用:

```python
    # 递归处理列:JsonObject 列跳过自身检查、递归叶子子列(全限定名校验)
    _process_columns_recursive(df, schema.columns, "", parsed_data, errors, num_rows)
```

- [ ] **Step 6: 运行新测试确认通过**

Run: `cd backend && python -m pytest tests/unit/test_data_engine.py::TestProcessDataframe -v`
Expected: 全部 PASS(含 3 个新测试 + 原有 test_basic_processing/test_missing_column_error/test_extracted_type_skipped/test_empty_dataframe)

- [ ] **Step 7: 全量 data_engine 测试回归**

Run: `cd backend && python -m pytest tests/unit/test_data_engine.py -v`
Expected: 全部 PASS(确认 `_reconstruct_expand_columns`/`_expand_structured_columns`/`_map_json_path_columns` 等不受影响)

- [ ] **Step 8: ruff + 提交**

```bash
cd backend && python -m ruff check --fix app/shared/domain/data_engine.py tests/unit/test_data_engine.py
cd backend && python -m ruff format app/shared/domain/data_engine.py tests/unit/test_data_engine.py
git add backend/app/shared/domain/data_engine.py backend/tests/unit/test_data_engine.py
git commit -m "fix(backend): format 校验递归处理 JsonObject 列,跳过顶层列检查并递归叶子子列"
```

---

# Task 4: E2E 重新启用嵌套对象约束测试

**Files:**
- Modify: `e2e/flows/json-schema-nested-constraints.spec.ts`

> Task 1-3 修复了数据加载缺陷,现在可重新启用之前"规避"的嵌套对象约束测试。

- [ ] **Step 1: 阅读当前 E2E 文件头注释与测试范围说明**

Read `e2e/flows/json-schema-nested-constraints.spec.ts` 第 1-30 行(文件头注释),理解之前为何用扁平字段规避嵌套对象。

- [ ] **Step 2: 新增嵌套对象约束 E2E 测试**

在 `e2e/flows/json-schema-nested-constraints.spec.ts` 的 `test.describe` 块内,在"平面 schema 无约束时全量校验无 NotNull 违规"测试**之前**,新增一个嵌套对象约束测试:

```typescript
  test('JSON schema 嵌套对象字段(profile.name)约束被全量校验执行', async () => {
    const schemaId = 'json_nested_object'
    const constraintId = 'nn_nested_name'
    // 嵌套对象:profile.name 第 2 条为 null
    const jsonDataPath = path.join(tmpDir, 'data', 'nested.json')
    fs.writeFileSync(
      jsonDataPath,
      JSON.stringify([
        { id: 1, profile: { name: 'Alice' } },
        { id: 2, profile: { name: null } },
      ]),
      'utf-8'
    )

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'test-json-constraint', name: 'Test Nested Object' },
        settings: standardSettings(),
        schemas: [{ id: schemaId, path: `schemas/${schemaId}.schema.yaml` }],
        constraints: [{ id: constraintId, path: `constraints/${constraintId}.constraint.yaml` }],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Nested JSON',
          source: {
            mode: 'absolute_file' as const,
            path: jsonDataPath,
            header_row: 0,
            options: { format: 'array' },
          },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int', json_path: '$.id' },
            {
              id: 'col-profile',
              name: 'profile',
              type: 'JsonObject',
              json_path: '$.profile',
              children: [
                { id: 'col-profile-name', name: 'name', type: 'Str', json_path: '$.profile.name' },
              ],
            },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {
        [constraintId]: {
          version: 2,
          id: constraintId,
          type: 'NotNull',
          enabled: true,
          // 独立约束用 column_id 引用嵌套子列(factory 解析为全限定名 profile.name)
          refs: { table_id: schemaId, column_id: 'col-profile-name' },
          params: {},
        },
      },
    }

    await putFullConfig(tmpDir, fullConfig)

    const result = await validateFull(tmpDir)
    // 嵌套对象字段 profile.name 的约束应被执行,检测到第 2 条 null
    // (修复前:format 阶段报"缺少列 profile"阻断;修复后:跳过 profile、递归校验 profile.name)
    const violations = notNullViolations(result.errors)
    expect(violations.length).toBe(1)
    expect(violations[0].column).toBe('profile.name')
  })
```

- [ ] **Step 3: 更新文件头注释(移除"规避嵌套对象"说明)**

修改 `e2e/flows/json-schema-nested-constraints.spec.ts` 文件头注释。将原"重要范围说明"段落:

```typescript
 * 重要范围说明:
 * JSON「嵌套对象」字段(如 $.profile.name)的「数据加载/列展平」存在独立的既有缺陷
 * (data_engine format 阶段报"缺少列"),非本次约束列解析修复的范围。
 * 因此本测试用「扁平 JSON 字段」+「平面 CSV schema」验证约束列解析链路,
 * 这些场景的数据加载正常,能聚焦验证约束列 ID 解析的正确性。
 * 「嵌套子列的 column_id 解析」本身由后端 pytest 覆盖
 * (test_constraint_factory.py::TestCreateConstraintNestedColumns、
 *  test_embedded_constraints_nested.py)。
```

替换为:

```typescript
 * 覆盖场景:
 * - JSON schema 嵌套对象字段(profile.name)约束:data_engine 递归校验 + factory 全限定名
 * - JSON schema 扁平字段独立约束(column_id):factory 列映射
 * - CSV schema 内嵌约束(列名):embedded_constraints 列名→ID 解析
 * - 无约束回归基线
```

- [ ] **Step 4: 运行 E2E 测试(需后端运行)**

Run: `cd e2e && npx playwright test flows/json-schema-nested-constraints.spec.ts --reporter=line`
Expected: 4 个测试全过(新增的嵌套对象测试 + 原 3 个)

> **注意**:此步需要后端运行(端口 18000)且加载了 Task 1-3 的修复代码。若后端是旧代码(未重启),嵌套对象测试会失败。确认后端已重启加载新代码后再运行。

- [ ] **Step 5: 提交**

```bash
git add e2e/flows/json-schema-nested-constraints.spec.ts
git commit -m "test(e2e): 重新启用 JSON 嵌套对象字段约束 E2E 测试"
```

---

# 最终验证

## Task 5: 全量回归

- [ ] **Step 1: 后端全量测试**

Run: `cd backend && python -m pytest -q`
Expected: 全部 PASS

- [ ] **Step 2: ruff 全量**

Run: `cd backend && python -m ruff check . && python -m ruff format --check .`
Expected: 无错误

- [ ] **Step 3(可选,需后端运行): E2E 回归**

Run: `cd e2e && npx playwright test flows/json-schema-lifecycle.spec.ts flows/json-schema-nested-constraints.spec.ts --reporter=line`
Expected: 全部 PASS

---

## 实施完成检查清单

- [ ] Task 1:column_utils 列映射生成全限定名 — pytest 全绿
- [ ] Task 2:factory 嵌套约束断言更新 — 后端全量回归全绿
- [ ] Task 3:data_engine format 递归校验 — data_engine 测试 + 全量回归全绿
- [ ] Task 4:E2E 重新启用嵌套对象约束 — Playwright 全绿(需后端加载新代码)
- [ ] Task 5:最终全量回归全绿
