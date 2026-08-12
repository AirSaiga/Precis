# C20-refactor-extract-module — 提取 formatters 模块

| 项 | 值 |
|----|-----|
| ID | C20 |
| 维度 | refactor（重构与代码质量） |
| 栈 | Python |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Python ≥3.12（标准库，无第三方依赖） |

## 背景

`workspace/service.py` 里除了一个 `UnifiedValidationService` 主服务类，还内聚着一组**错误格式化**
辅助函数（构造错误 dict 的私有 helper）。这复刻了真实文件
`backend/app/shared/services/validation/service.py` 的结构（一个服务类 + 一组格式化辅助）。
这组 formatter 与服务类的核心职责无关，本该住在自己的模块里。

## 任务

把 `service.py` 里**那一组错误格式化辅助函数**（以 `_format_` 为前缀的那批私有函数）提取到一个
**新模块 `workspace/formatters.py`**，成为该模块的公开 API；`service.py` 改为 import 并调用它们。

具体哪些函数属于这一组、提取后叫什么名字，**自己从 `_format_` 前缀模式判断**（搬到新模块后应去掉
前导下划线改为公开——它们现在是 `formatters.py` 的对外 API）。

### 规格

- **新建文件**：`workspace/formatters.py`（容纳提取出来的公开 formatter 函数）。
- **修改文件**：`workspace/service.py`（删掉被提取的私有函数定义、改为 import 使用）。
- **不可改的东西**：
  - `UnifiedValidationService` 类名、方法名、方法签名。
  - 各 formatter 的**函数体逻辑**（只允许：去前导下划线改名、搬位置；return 的 dict 字面量一字不改）。
- **行为必须完全不变**（verify 会跑行为测试）。

### 约束（务必遵守）

- 只新建 `workspace/formatters.py` 和改 `workspace/service.py`，**不要动其它文件**。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不重命名 `UnifiedValidationService` 类；不改方法签名。
- 不改函数体逻辑（参数顺序、dict 的键值、f-string 文案都保持原样）。
- 不引入任何第三方依赖。
- **禁止循环导入**：`formatters.py` **不得 import `service`**（不允许出现 `import service` /
  `from service import ...` 任何形式）。提取完成后依赖方向必须是单向的
  `service.py` → `formatters.py`；若 formatters 需要 service 里的某个符号，正确做法是把该符号
  就地重声明或一并移入 formatters，而不是反向 import——反向 import 会形成
  `service ⇄ formatters` 循环依赖（verify 会用 AST 检查 formatters.py 的所有 import 语句）。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 同时检查"提取后的结构"（formatters.py 存在且含公开函数、
service.py 不再定义私有版本、service.py import 自 formatters、formatters.py 不反向 import
service）和"行为不变"。详见 verify 输出。

> 提示：`verify.py` 把 `workspace/` 加进了 `sys.path`，所以 `from formatters import ...` 能直接
> 解析到 `workspace/formatters.py`，无需建包。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
