# C21-refactor-pipeline — 校验循环重构成 pipeline

| 项 | 值 |
|----|-----|
| ID | C21 |
| 维度 | refactor（重构与代码质量） |
| 栈 | Python |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Python ≥3.12（标准库，无第三方依赖） |

## 背景

`workspace/validator.py` 里的 `process(values, min_val, max_val)` 是一个**命令式嵌套循环**：
三层 `for` + `if` + `append`，把过滤、转换、范围检查、结果收集 4 个不同职责糅在一个函数体里。
这复刻了真实 Precis 校验引擎的雏形（AGENTS.md「后端校验引擎采用两阶段流水线」），命令式写法把
关注点混在一起、难以单独测试与扩展（想换一种转换或加一道预处理，只能往大函数里塞）。

## 任务

把命令式的 `process()` 重构成一条 **pipeline**：拆成 4 个可组合的 stage 函数，每个 stage 是一个
**纯函数**（输入 → 输出，无副作用），`process()` 只负责依次调用它们、把上一步的输出喂给下一步，
不再含任何逐元素 `for`/`if` 处理逻辑。

**必须创建这 4 个 stage**（名字固定，verify 依赖）：

- `stage_filter_none`
- `stage_convert`
- `stage_range_check`
- `stage_collect`

`process()` 必须按顺序调用这 4 个 stage。各 stage 的签名（参数、返回类型）和内部行为，**自己从原始
`process()` 的逻辑段倒推**——读现有代码，把每段职责对应到 stage 名上。

### 规格

- **文件**：`workspace/validator.py`（在原文件内新增 4 个 stage + 重写 `process`，**不要新建其它文件**）。
- **4 个 stage 必须真实存在且可独立调用**（verify 会直接调它们测行为，不只看文本）。
- **`process` 必须调用**这 4 个 stage（不能把 stage 逻辑又内联回 `process`）。
- **行为必须完全一致**（verify 会用多组测试对照原始实现的黄金输出）。
- **不可变性契约**：每个 stage 必须是**纯函数**——返回**新对象**，不得原地修改入参
  （不允许 `sort()` / `append()` / `pop()` / `del` / 切片赋值等原地变更）。由此保证
  `process()` 执行完毕后，**调用方传入的 `values` 列表与其传入前逐元素相等**（verify 会
  对调用方输入做深拷贝快照、跑完 `process` 与每个 stage 后逐一比对）。

### 约束（务必遵守）

- 只改 `workspace/validator.py`，**不要新建其它文件**。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入任何第三方依赖。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 同时检查：4 个 stage 存在且各自行为正确、`process` 行为对照
黄金完全一致、`process` 函数体确实调用了 4 个 stage（AST 级检查——只认真实的函数调用，在注释或
字符串里写 stage 名不算）、`process` 函数体不含逐元素 `for` 循环、以及**不可变性**（`process` 与
每个 stage 执行后调用方传入的对象与深拷贝快照逐元素相等——原地 `sort()`/`append()`/切片赋值会
直接 FAIL）。详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
