# X01 — 端到端新增 Precision（小数精度）约束（真实仓库全栈）

| 项 | 值 |
|------|-----|
| ID | X01 |
| 类型 | 真实仓库导航（全栈端到端） |
| 栈 | Python（FastAPI 后端）+ TypeScript / Vue 3（前端 vitest） |
| 难度 | ★★★+ |
| 预估 | 40-70 分钟 |

> 本题在**真实 Precis 仓库**上操作（不是 seed 最小工程）。新增一种约束类型需要贯穿
> **后端约束系统 + 前端约束节点系统 + 双侧 i18n** 的长链条（约 10 个文件），两侧各有
> 分散的注册机制，任何一个出口漏接都会断链。没有给出任何文件路径，全部需要自己导航发现。

## 任务

在 Precis 中端到端新增一种 **Precision**（小数精度）约束：

- **后端**：实现校验逻辑，接入约束系统全链路（类实现、包导出、兼容导出层、类型注册表、
  构建器、配置数据模型），做到"能从配置文件构建、能被校验流水线调用"。
- **前端**：把该约束接入约束节点系统（约束类型元数据、节点数据构建器、校验处理器、
  节点数据类型、双语 i18n 条目），做到"导入 V2 配置能生成节点、画布校验能派发到处理器、
  菜单/节点库能显示中英文名称"。

### 构造参数

```
PrecisionConstraint(table, column, precision)
```

- `table`：表名（由 refs 的 table_id 解析）
- `column`：列名（由 refs 的 column_id 解析）
- `precision`：**≥ 0 的整数**，允许的最大小数位数。非法值（负数或非整数）构造时抛 `ValueError`。

### 验证语义（后端）

对列中每个**非空**值：

- **None / NaN 跳过**，不计为违规（与其它约束的空值约定一致）。
- 值可解析为数值（整数、浮点、Decimal、或可转数值的字符串）→ 计算其**小数位数**；
  小数位数 **> precision** → 记一条违规。
- 值**不可解析为数值**（如 `"abc"`）→ 记一条违规（非数值也是违规，不是跳过）。
- 整数的小数位数为 0，恒通过（0 ≤ precision）。
- 表/列不存在于数据集 → 配置错误（与其它约束的 `ConstraintConfigError` 约定一致），不崩溃。

> 计算小数位数的可靠做法：把值转成 `Decimal(str(value))` 后 `normalize()` 再取
> `as_tuple().exponent`，exponent 为负时小数位数 = `-exponent`，否则为 0。用 `str()` 中转可
> 避开浮点二进制表示的坑（如 `str(0.1)` → `"0.1"` → 1 位小数）；`normalize()` 去除尾随零
> （如 float 列里的 `3.0` 应视为 0 位小数，否则"整数恒通过"会被 3.0 这种表示破坏）。

### 三层命名（前后端一致）

| 层 | 值 |
|------|-----|
| 前端 kind（注册表索引键） | `precision`（camelCase） |
| 前端节点类型 | `precisionConstraint`（camelCase + `Constraint` 后缀） |
| v2Type / 后端 constraint_type | `Precision`（PascalCase，落盘 YAML 用） |

### 前端校验处理器语义

校验处理器（handler）对**行内数据**（ctx 传入的行数组）**本地执行**小数位数校验，不调用后端
API：逐行取目标列的值，空值跳过，非数值记违规，小数位数超上限记违规；返回标准结果结构
（`status` / `validationErrors` / `lastValidation`）。无行内数据且无数据源时按数据源防护约定
返回 idle 结果。节点数据的参数字段名为 `precision`（数字）。

## 约束

- **不得修改 `challenges/` 目录**。
- **`tests/` 目录原则禁止修改**（verify 会自行放置测试文件）。**唯一例外**（且是任务的一部分）：
  前端注册表完整性测试中有**两处硬编码当前 10 种约束的"参考副本"**（一处是约束类型数量断言，
  一处是后端 V2 类型名的硬编码集合）——新增第 11 种约束后这两处**必须同步更新**，否则既有测试
  会红。同步时只许**增量添加**（数量断言 +1、集合补一个新名字），**不得删除既有项、不得弱化
  任何其它断言**。除此两处外，任何其它测试文件都不得修改。
- **你的改动不得破坏仓库既有测试**（verify 会回归运行相关既有测试子集：后端兼容导出完整性、
  约束注册表、约束工厂测试；前端注册表完整性、注册表核心、节点数据构建器、配置 round-trip、
  导出适配器测试）。
- 后端约束系统不止一个注册表/导出口：类的"实现"、"类型名→类"的注册表、"类型名→构建参数"的
  注册表、配置文件的 type 字面量、以及若干包导出口分散在不同文件——把链路摸清楚再动手，遗漏
  任何一个都会导致测试失败。

## 验证

在本目录运行：

```
python verify.py
```

`verify.py` 分两段：

1. **后端段**：把 `test_x01_precision.py` 复制进后端测试目录并以 pytest 运行；随后以相同环境
   回归运行后端既有的相关测试子集（兼容导出完整性、约束注册表、约束工厂）。
2. **前端段**：把 `test_x01_precision.test.ts` 复制进前端测试目录并以 vitest 运行；随后回归运行
   前端既有的约束测试子集；另有三组**静态检查**：参考副本是否按要求同步、前端类型联合/接口是否
   接通、导出适配层是否含 `case 'Precision'`。

两段的注入测试与回归子集**都通过**、静态检查**都通过**才算 PASS。退出码 `0` = PASS，非 `0` = FAIL。
stdout 首行为 `PASS` 或 `FAIL`，随后按 `  [✓]/[✗]` 列出各检查明细。运行后无论成败都会清理临时
测试文件，不污染真实仓库。

> 前端用 **vitest**（不是 jest）。若当前 frontend/ 没有 node_modules（如 worktree/副本），
> verify 会给出明确指引。Windows 下推荐 PowerShell 建 junction（Git Bash 下 `cmd //c mklink` 会被 MSYS 改坏参数）：
> ```powershell
> powershell -Command "New-Item -ItemType Junction -Path '<副本>\frontend\node_modules' -Target '<主仓库>\frontend\node_modules'"
> ```
> ⚠️ 验证完删除副本时：先 `Remove-Item '<副本>\frontend\node_modules'` 并**确认已消失**，再 `git worktree remove --force`——直接 remove 会穿透 junction 清空主仓库 node_modules。

## 提示

- **后端链路**：约束的"类实现"（domain 层，逐行校验的类）、domain 包导出口、**兼容层 re-export
  模块**、核心注册表（类型名→类路径的字符串映射 + 别名表 + 支持类型列表）、构建器注册表
  （`@register_builder` 装饰器，单列约束都注册在同一个共享模块里）、配置数据模型的 type 字面量。
  注意：主注册表里的导入路径**指向兼容层 re-export 模块**，而不是 domain 包本身——漏掉该模块的
  import，`resolve_constraint_class("Precision")` 会 `getattr` 失败。
- **`__all__` 陷阱（后端）**：某个兼容层 re-export 模块的 `__all__` 被既有测试硬编码锁定
  （固定项数集合）。接通新约束**只需把名字 import 进该模块的命名空间**，**不要**把它加进该
  `__all__`（功能只依赖名字绑定，不依赖 `__all__`）；也不要修改那个既有测试文件。想清楚
  "名字绑定"与"列入 `__all__`"的区别再动手。
- **别名表**：约束类型名规范化入口维护一张别名表（snake_case → PascalCase，如 `'range'` →
  `'Range'`），新类型应照此注册 `'precision'` → `'Precision'`，并在支持类型列表里加说明。
- **工厂两段式**：约束实例化走"先按类型名查类、再按类型名查构建参数"两段式；构建器没注册会
  返回"不支持的约束类型"。配置文件的 type 枚举不加新类型，连配置对象都构造不出来。
- **前端三层命名**：kind / 节点类型 / v2Type 三层命名的单一事实源是约束元数据表（新增一行）。
  围绕它有两套**自注册**注册表：节点数据构建器（`registerBuilder(kind, ...)`，单列约束共享
  一个构建模块，注意其中按 kind 提取类型特有参数的分支和 kind 清单都要加）、校验处理器
  （`register({ kind, validate, resetOnDisconnect })`，新 handler 文件必须经 barrel 的
  side-effect import 触发自注册，漏掉 barrel import 处理器永远不会注册）。
- **前端类型**：约束节点数据类型接口与 `CustomNodeData` 判别联合是**两处**——只加接口、忘加
  联合成员，运行时识别不了该节点。kind 与节点类型的 TypeScript 联合类型（约束服务层的类型
  模块里）也要补成员，否则 tsc 不过。
- **导出适配层穷尽检查**：把画布约束节点数据导出为后端 V2 refs/params 的适配模块
  （`frontend/src/services/constraints/constraintExportAdapter.ts`）按 v2Type 做穷尽 switch
  （`default` 分支 `const _exhaustive: never = v2Type`）。`ConstraintTypeV2` 加 `'Precision'`
  之后，必须同步给这个 switch 加 `case 'Precision'`（并入 NotNull/Range/Charset/DateLogic
  的单列 case 组，并导出 `precision` param），否则 `npm run type-check` 红——这是新增约束
  类型必须同步的又一处，且运行时测试不一定会踩中。
- **i18n 双侧**：约束类型名/描述的中英文条目要 **zh-CN 与 en-US 双侧都有**（key 与 kind 对齐），
  只加一侧会导致另一侧界面空白、i18n 审计失败。
- **参考副本**：前端注册表完整性测试里硬编码了"10 种约束"的两处参考副本——这是**需要你更新**的
  例外（见上方约束），不是"不得修改"的对象。更新后 verify 的回归门会跑这些测试文件验证更新正确。
