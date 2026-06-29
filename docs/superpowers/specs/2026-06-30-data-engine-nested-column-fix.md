# data_engine 嵌套列处理修复设计

- **日期**: 2026-06-30
- **状态**: 设计已确认,待实现
- **作者**: ZCode 协作设计
- **关联**: 衍生自「JSON Schema 节点重构」E2E 补充阶段发现的独立缺陷

---

## 1. 背景与动机

在「JSON Schema 约束列解析重构」补充 E2E 测试时,发现一个**独立于约束列解析的既有缺陷**:JSON 嵌套对象字段的数据加载与 schema 树形建模不一致,导致含嵌套对象的 JSON Schema 在全量校验时 format 阶段就报"缺少列",阻断该 schema 的所有约束校验。

### 1.1 根因(已用 TestClient + json_normalize 实验确认)

JSON 加载器(`json_loader.py:232`)用 `pd.json_normalize` 加载数据,它**递归展平嵌套对象为点分列**:
```
{'profile': {'name': 'Alice'}}  →  DataFrame 列 ['id', 'profile.name']
```
顶层 `profile` 列消失,只剩点分列 `profile.name`。

但 schema(`data_engine.py:277` 的 `process_dataframe`)把 `profile` 建模为 **JsonObject 顶层列** + `children: [name]`,列遍历时检查 `'profile' in df.columns` 失败,报 `MissingColumn: 缺少必需的列 'profile'`。

### 1.2 影响范围
- **format 阶段**:JsonObject 顶层列被判 MissingColumn,整列填 None
- **约束阶段**:即使绕过 format,约束 `df[self.column]`(column 是叶子名 `name`)也取不到值(列是 `profile.name`,不是 `name`)
- **连锁**:该 schema 的所有约束校验被阻断

### 1.3 缺陷性质
data_engine 对嵌套字段的命名约定**四处不一致**:
| 层 | 命名约定 |
|----|---------|
| json_normalize 加载 | 点分列 `profile.name` |
| schema 列遍历(format) | 顶层列名 `profile` |
| 约束取值 | 叶子列名 `name` |
| `_expand_structured_columns` 展开 | 下划线前缀 `profile_name` |

### 1.4 已确认的设计决策(头脑风暴结论)

| 决策点 | 选择 |
|--------|------|
| 约束取值模型 | 用「父.子」点号全限定名,`df['profile.name']` 直接取 json_normalize 产生的点分列 |
| 约束 column 命名 | 点号全限定名 `profile.name` |
| format 阶段策略 | 跳过 JsonObject 顶层列的 MissingColumn 检查,递归校验叶子子列 |
| 全限定名生成 | factory 列映射递归拼接父名 |

### 1.5 核心洞察(简化设计的关键)
**json_normalize 已经产生了约束需要的点分列(`profile.name`)**。约束用 `profile.name` 作为 column,就能直接 `df['profile.name']` 取值——天然匹配。唯一要做的是:
1. format 阶段不再对 `profile` 顶层列报 MissingColumn(它会被展平)
2. factory 列映射产出全限定名,让约束拿到 `profile.name`
3. format 阶段递归校验叶子子列(以点分列名)

---

## 2. 详细设计

### 2.1 改动1:column_utils 列映射生成全限定名

**目标**:factory/embedded 的列映射产出「父.子」全限定名。

**现状**:`build_column_id_to_name_map`(column_utils.py)用 `{c.id: c.name}` —— 叶子列映射为叶子名 `name`。

**改动**:递归时拼接父路径。

```python
def build_column_id_to_name_map(columns: list[ColumnSpec] | None) -> dict[str, str]:
    """递归构建 column_id -> column_name 映射。

    嵌套子列用「父.子」全限定名(与 json_normalize 展平后的点分列一致),
    使约束能直接 df['profile.name'] 取值。
    平面列(无父)映射为自身名。
    """
    result: dict[str, str] = {}
    _collect_qualified_names(columns or [], "", result)
    return result


def _collect_qualified_names(
    columns: list[ColumnSpec], parent_path: str, result: dict[str, str]
) -> None:
    prefix = f"{parent_path}." if parent_path else ""
    for col in columns:
        qualified_name = f"{prefix}{col.name}"
        if col.id is not None:
            result[col.id] = qualified_name
        if col.children:
            _collect_qualified_names(col.children, qualified_name, result)
```

**行为示例**:
| schema 列结构 | column_id | 映射结果(改动后) | 改动前 |
|--------------|-----------|------------------|--------|
| `email`(顶层平面) | `email` | `email` | `email`(不变) |
| `profile`(JsonObject) | `profile` | `profile` | `profile`(不变) |
| `name`(profile.children) | `col-profile-name` | `profile.name` | `name` |
| `city`(profile.address.children) | `col-city` | `profile.address.city` | `city` |

平面列与顶层列完全不变(向后兼容),只有叶子子列带父前缀。

**embedded_constraints.py 无需再改**:它的列名→ID 解析(`name → col-profile-name`)用 `iter_all_columns` 递归找列名,上一轮已修复,与全限定名方向无关。

### 2.2 改动2:data_engine format 校验递归处理 JsonObject 列

**目标**:format 阶段不再对 JsonObject 顶层列报 MissingColumn,改为递归校验叶子子列。

**现状**(data_engine.py:277-296):只遍历 `schema.columns.items()`(顶层列),对 `profile` 检查 `'profile' in df.columns` 失败 → 误报 MissingColumn。

**改动**:将列遍历改为递归,带 `parent_path`:

```python
def _process_columns_recursive(
    df, schema_columns, parent_path, parsed_data, errors, num_rows
):
    """递归处理 schema 列:JsonObject 列跳过自身检查,递归处理叶子子列。
    叶子列以「父.子」全限定名参与校验(对应 json_normalize 点分列)。"""
    prefix = f"{parent_path}." if parent_path else ""
    for col_name, col_schema in schema_columns.items():
        qualified = f"{prefix}{col_name}"

        # JsonObject 列(有 children):递归处理子列,跳过自身列检查
        # children 是 list[ColumnSchema],转为 {name: col} dict 以复用递归
        if isinstance(col_schema.data_type, JsonObjectType) and col_schema.children:
            child_dict = {c.name: c for c in col_schema.children}
            _process_columns_recursive(
                df, child_dict, qualified, parsed_data, errors, num_rows
            )
            continue

        # 叶子列(含平面列和嵌套叶子):按全限定名检查
        if qualified not in df.columns:
            errors.append({
                "row_index": None, "column": qualified,
                "value": None, "error_type": "MissingColumn",
                "error_message": f"数据表中缺少必需的列 '{qualified}'",
            })
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

`process_dataframe` 用 `_process_columns_recursive(df, schema.columns, "", ...)` 替换原顶层遍历循环。

**关键变化**:
- JsonObject 顶层列 `profile` 不再报 MissingColumn(它有 children,递归处理子列)
- 叶子子列 `name` 以全限定名 `profile.name` 校验(对应 json_normalize 点分列)
- 平面列 `email`(无父,qualified=`email`)行为不变

### 2.3 改动3:`_map_json_path_columns` 调整

`_map_json_path_columns`(data_engine.py:76)当前把点分列 `profile.name` 重命名为叶子名 `name`(通过 json_path 映射)。这会**破坏**新的全限定名约定。

**调整**:该函数处理的是顶层列(`schema.columns.items()`)的 json_path 映射,本就不处理子列(子列不在 schema.columns)。新方案下,顶层 JsonObject 列由递归处理,`_map_json_path_columns` 对顶层叶子列的自定义命名映射(如 schema 列 `location` ↔ 数据点分列 `location.zone`)仍需保留。

**实现时确认**:先跑现有 `TestMapJsonPathColumns`(4 个测试)确认其作用域仅限顶层列,不触碰点分子列。若确认安全则保留;若发现它会误处理,限定其只处理非 JsonObject 顶层列。

### 2.4 测试策略(TDD)

**改动1 测试** — 更新 `test_column_utils.py`:
- `test_nested_map_includes_children`:断言值改为全限定名(`profile.name` 而非 `name`)
- 新增 `test_deeply_nested_qualified_name`:3 层嵌套 `profile.address.city`
- 保留 `test_flat_map`(平面列不变)

**改动1 回归** — 更新 `test_constraint_factory.py::TestCreateConstraintNestedColumns`:
- `test_not_null_on_nested_child`:`result.column` 从 `'city'` → `'profile.address.city'`
- `test_unique_on_nested_child`:`result.columns` 从 `['name']` → `['profile.name']`

**改动2 测试** — 补充 `test_data_engine.py`:
- 新增 `test_json_object_column_not_missing`:JsonObject 顶层列(profile)+ json_normalize 点分子列(profile.name),断言**无 MissingColumn 错误**
- 新增 `test_nested_leaf_column_validated`:叶子子列 `profile.name` 通过类型校验
- 保留 `test_missing_column_error`(平面列缺失仍报错)、`test_expand_*` / `test_json_object_with_children_expand`(expand=True 场景回归)

**端到端验证** — 更新 `e2e/flows/json-schema-nested-constraints.spec.ts`:
- 重新启用之前因数据加载缺陷"规避"的嵌套对象约束测试(用真实嵌套对象 `profile.name`)
- 断言 NotNull 约束真正检测到嵌套字段 null

---

## 3. 风险与缓解

### 风险1:`_map_json_path_columns` 调整影响自定义列名场景
该函数处理"schema 列名 ≠ json_normalize 点分列名"的场景(如 schema 列 `location` ↔ 数据 `location.zone`)。
**缓解**:实现时先跑 `TestMapJsonPathColumns` 4 个测试确认作用域。若安全则保留;否则限定为只处理非 JsonObject 顶层列。

### 风险2:全限定名与真实列名冲突
若用户真有一列字面量叫 `profile.name`,会与嵌套展开冲突。
**缓解**:点号在 pandas 列名中合法但罕见作为真实列名,且 json_path 语义本就用点号。文档记录此约定,可接受风险。

### 风险3:`_expand_structured_columns` 命名不一致
该函数展开 dict 列用 `profile_name`(下划线),与新点号约定不一致。
**缓解**:本方案 format 阶段递归处理 JsonObject 子列,**不再依赖 `_expand_structured_columns` 展开嵌套对象**(它主要用于 expand=True 显式展开)。两者职责分离。实现时确认无冲突。

---

## 4. 明确不做(YAGNI 边界)

- **dict 列保留场景**:JsonObject 列未被 json_normalize 展平(显式配置 flatten=False 等)时从 dict 提取子列——罕见,留作边界记录,不处理。
- **约束层 json_path 取值**:约束仍用 `df[column]` 全限定名取值,不引入 json_path 取值机制。
- **前端 UI 改动**:约束 column 全限定名由 factory 生成,前端展示(叶子名 vs 全限定名)是 UI 层独立问题,不在本次范围。

---

## 5. 验证矩阵

| 场景 | 改动前 | 改动后 | 验证 |
|------|--------|--------|------|
| 平面列约束(email) | ✅ | ✅ 不变 | 现有 E2E + 单测回归 |
| 嵌套叶子约束(profile.name) | ❌ MissingColumn 阻断 | ✅ 全限定名取值 | 新 E2E + 单测 |
| 多层嵌套(profile.address.city) | ❌ | ✅ | 单测 |
| expand=True 显式展开 | ✅ | ✅ 不变 | 现有单测回归 |
| 同名叶子(user.name + profile.name) | 冲突 | ✅ 全限定名区分 | 单测 |
