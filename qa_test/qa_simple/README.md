# QA Simple 测试工程

用于本地调试的最小 V2 工程示例。覆盖项目核心功能：多数据格式（CSV/JSON）、全部约束类型、正则/转换节点、表达式注册表与派生列。所有数据均为合法数据，**校验应通过**。

## 目录结构

```
qa_test/qa_simple/
├── project.precis.yaml                       # 项目清单（V2 入口）
├── schemas/
│   ├── users.schema.yaml                     # 用户表 + 内嵌约束 + Expr/Extracted 列类型
│   ├── orders.schema.yaml                    # 订单表 + 内嵌约束（Unique/NotNull/ForeignKey）
│   ├── products.schema.yaml                  # 产品表 + JSON 嵌套数据源 + Range
│   └── releases.schema.yaml                  # 版本表 + Expr 类型 + Extracted 派生列
├── constraints/                              # 独立约束文件
│   ├── orders_amount_range.constraint.yaml   # Range（refs+params 分离）
│   ├── users_birth_date_check.constraint.yaml       # DateLogic
│   ├── users_username_ascii.constraint.yaml         # Charset
│   ├── users_conditional_id_card.constraint.yaml    # Conditional
│   ├── users_phone_format.constraint.yaml           # Scripted
│   ├── users_email_composite.constraint.yaml        # Composite
│   ├── users_name_required__check_not_null.constraint.yaml       # 模板展开: NotNull
│   ├── users_age_range_tmpl__check_range.constraint.yaml         # 模板展开: Range
│   └── users_country_normalize__check_allowed.constraint.yaml    # 模板展开: AllowedValues
├── regex_nodes/
│   └── extract_email_domain.regex.yaml       # Regex extract 节点
├── transforms/
│   ├── normalize_status.transform.yaml       # UpperCase 转换节点
│   └── users_country_normalize__normalize.transform.yaml  # 模板展开: UpperCase
├── patterns/
│   └── semver.yaml                           # 表达式注册表模式
├── templates/
│   ├── required_field.template.yaml          # 单节点 NotNull 模板
│   ├── numeric_range.template.yaml           # 参数化 Range 模板
│   └── normalize_enum.template.yaml          # Transform + AllowedValues 链式模板
├── data/
│   ├── users.csv                             # 用户数据（5 行，合法）
│   ├── orders.csv                            # 订单数据（5 行，外键引用 users）
│   ├── products.json                         # 产品数据（3 行，嵌套 JSON）
│   └── releases.csv                          # 版本数据（3 行，语义化版本号）
└── README.md
```

## 覆盖的功能

### 数据格式与数据源

| 功能 | 文件 | 说明 |
|------|------|------|
| CSV 数据源 | `data/users.csv`, `data/orders.csv`, `data/releases.csv` | 基础表格式 |
| JSON 嵌套数据源 | `data/products.json` + `products.schema.yaml` | `format: object` + `json_path: $.data.items` |
| 相对文件模式 | 所有 schema.source | `mode: relative_file` |
| 数据源目录引用 | `project.precis.yaml` | `data_sources` 配置 |

### 数据类型

| 类型 | 使用位置 | 说明 |
|------|---------|------|
| integer | users.id, products.id, releases.id | 整数 |
| string | users.name/email/phone/country/id_card/username/country_upper, orders.order_date | 字符串 |
| decimal | orders.amount, products.price | 高精度小数 |
| date | users.birth_date | 日期 YYYY-MM-DD |
| boolean | products.active | 布尔值 |
| Expr | releases.version | 引用 `expression_registry` 验证语义化版本 |
| Extracted | releases.major_version | 从 version 正则提取 major 组 |

### 约束类型

| 约束 | 类型 | 定义位置 | 说明 |
|------|------|---------|------|
| `not_null_email` | NotNull | users schema（内嵌） | email 非空 |
| `unique_email` | Unique | users schema（内嵌） | email 唯一 |
| `status_allowed` | AllowedValues | users schema（内嵌） | status ∈ {active, inactive, pending} |
| `users_age_range` | Range | users schema（内嵌） | age ∈ [0, 120] |
| `unique_order_id` | Unique | orders schema（内嵌） | id 唯一 |
| `not_null_order_date` | NotNull | orders schema（内嵌） | order_date 非空 |
| `fk_order_user` | ForeignKey | orders schema（内嵌） | orders.user_id → users.id |
| `orders_amount_range` | Range | constraints/（独立文件） | amount ∈ [0, 100000] |
| `users_birth_date_check` | DateLogic | constraints/（独立文件） | birth_date > 1900-01-01 |
| `users_username_ascii` | Charset | constraints/（独立文件） | username 为 ASCII |
| `users_conditional_id_card` | Conditional | constraints/（独立文件） | country=CN 时 id_card 非空 |
| `users_phone_format` | Scripted | constraints/（独立文件） | phone 匹配 `^1[3-9]\d{9}$` |
| `users_email_composite` | Composite | constraints/（独立文件） | email 非空且唯一（logic=all） |
| `products_price_range` | Range | products schema（内嵌） | price ∈ [0, 100000] |
| `unique_release_id` | Unique | releases schema（内嵌） | id 唯一 |
| `users_name_required__check_not_null` | NotNull | constraints/（模板展开） | name 非空（`required_field` 模板展开） |
| `users_age_range_tmpl__check_range` | Range | constraints/（模板展开） | age ∈ [0, 120]（`numeric_range` 模板展开） |
| `users_country_normalize__check_allowed` | AllowedValues | constraints/（模板展开） | country_upper ∈ {CN, US, UK, JP}（`normalize_enum` 模板展开） |

### Regex / Transform / Patterns

| 功能 | 文件 | 说明 |
|------|------|------|
| Regex extract 节点 | `regex_nodes/extract_email_domain.regex.yaml` | 从 email 提取 local/domain |
| UpperCase 转换 | `transforms/normalize_status.transform.yaml` | 生成 status_upper |
| 表达式注册表 | `patterns/semver.yaml` | 验证 `vX.Y.Z` 并提供 major/minor/patch 捕获组 |

### 模板（Template / Template Instance）

模板是可复用的 DAG 蓝图（manualData → transform* → constraint+），展开后节点作为独立文件持久化。

| 模板 | 文件 | DAG 结构 | 说明 |
|------|------|---------|------|
| `required_field` | `templates/required_field.template.yaml` | manualData → NotNull | 必填字段检查蓝图 |
| `numeric_range` | `templates/numeric_range.template.yaml` | manualData → Range | 数值范围检查蓝图 |
| `normalize_enum` | `templates/normalize_enum.template.yaml` | manualData → UpperCase → AllowedValues | 标准化后枚举检查蓝图 |

模板实例（manifest `template_instances`）仅记录 `id`/`template_id`/`enabled`，展开后的节点作为独立约束/转换文件持久化：

| 实例 | 模板 | 展开后独立文件 |
|------|------|--------------|
| `users_name_required` | `required_field` | `constraints/users_name_required__check_not_null.constraint.yaml` |
| `users_age_range_tmpl` | `numeric_range` | `constraints/users_age_range_tmpl__check_range.constraint.yaml` |
| `users_country_normalize` | `normalize_enum` | `transforms/users_country_normalize__normalize.transform.yaml` + `constraints/users_country_normalize__check_allowed.constraint.yaml` |

## 运行校验

```bash
# 通过 npm 脚本（CI / 烟雾测试，退出码 0 表示通过）
npm run cli:validate

# 或直接调用 CLI（standalone 模式）
cd backend
python -B -m app.cli validate \
  --manifest ../qa_test/qa_simple/project.precis.yaml \
  --data-directory ../qa_test/qa_simple/data

# 或交互式 Shell
cd backend
python -B -m app.cli
precis> open ../qa_test/qa_simple
precis> validate
```

## 调试

在 VS Code 中使用调试配置（见 `.vscode/launch.json`）：

- **CLI: Validate qa_simple** — 直接调试 standalone 校验流程，可断点 `backend/app/shared/services/validation/executor.py`。
- **Backend (FastAPI)** — 启动后端 API，配合前端 / Electron 调试。
- **Electron (Dev + Vite)** — 桌面版调试，自动通过 `PRECIS_PROJECT_ROOT` 加载本工程。

## 故意引入违规（可选）

如需测试错误路径，可修改数据文件后重新校验：

| 想触发的违规 | 修改方式 |
|-------------|---------|
| NotNull 违规 | 将 `data/users.csv` 某行 `email` 留空 |
| Unique 违规 | 复制一行 `email` 使其重复 |
| Range 违规 | 将某行 `age` 改为 `200` 或 `products.price` 改为负数 |
| AllowedValues 违规 | 将某行 `status` 改为 `unknown` |
| ForeignKey 违规 | 将 `data/orders.csv` 某行 `user_id` 改为 `999` |
| DateLogic 违规 | 将某行 `birth_date` 改为 `1800-01-01` |
| Charset 违规 | 将某行 `username` 改为中文字符 |
| Conditional 违规 | 将某中国用户（country=CN）的 `id_card` 留空 |
| Scripted 违规 | 将某行 `phone` 改为非 11 位数字 |
| Composite 违规 | 将某行 `email` 留空或重复 |
| JSON 加载错误 | 破坏 `data/products.json` 的结构 |
| Expr 类型错误 | 将 `data/releases.csv` 某行 `version` 改为非法格式 |
| 模板 NotNull 违规 | 将 `data/users.csv` 某行 `name` 留空 |
| 模板 Range 违规 | 将 `data/users.csv` 某行 `age` 改为 `200` |
| 模板 AllowedValues 违规 | 将 `data/users.csv` 某行 `country_upper` 改为 `FR` |
