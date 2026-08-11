# C21-refactor-pipeline — 校验循环重构成 pipeline（处方式重构）

| 项 | 值 |
|----|-----|
| ID | C21 |
| 维度 | refactor（重构与代码质量） |
| 栈 | Python |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Python ≥3.12（标准库，无第三方依赖） |

## 背景

`workspace/validator.py`（约 60 行）含一个 `process(values, min_val, max_val)`
函数，**整段是一个命令式嵌套循环**：三层 `for` + `if` + `append`，把 4 个不同职责
（过滤 None / int 转换 / 范围检查 / 结果收集）糅在一个函数体里。这复刻了真实 Precis
校验引擎的雏形（AGENTS.md「后端校验引擎采用两阶段流水线」），命令式写法把关注点混在一起、
难以单独测试与扩展（想换一种转换或加一道预处理，只能往大函数里塞）。

> 为什么是"处方式（prescriptive）"题：自由形式的"把循环重构成 pipeline"无法客观打分——
> 不同审稿人对"该拆几步、各步怎么签名、数据怎么传"有不同审美。本题把可量化目标钉死为
> "拆成恰好这 4 个具名 stage 函数 + `process` 依次调用它们"，使 verify 能机械判定对错。

**先读 `workspace/validator.py`**，确认当前 `process` 的 4 段逻辑：

1. `filtered = [v for v in values if v is not None]` —— 丢掉 None。
2. `converted` —— 对每个值 `int(v)`；`(ValueError, TypeError)` 时用 `0` 占位。
3. `valid` / `violations` —— 逐个 `min_val <= v <= max_val` 判断，越界的记下
   **它在 `converted` 列表里的下标**。
4. 收集成结果 dict（`valid` / `violations` / `total_input` / `total_filtered` /
   `total_valid`）。

## 任务（PRESCRIPTIVE —— 精确到函数名与签名）

1. **新建 4 个 stage 函数**，每个是纯函数（输入 → 输出，无副作用）：
   - `stage_filter_none(values: list[Any]) -> list[Any]` —— 丢掉 None，返回余下的值。
   - `stage_convert(values: list[Any]) -> list[int]` —— 逐个 `int(v)`；转换失败
     （`ValueError` / `TypeError`）用 `0` 占位。
   - `stage_range_check(values: list[int], min_val: int, max_val: int) -> tuple[list[int], list[int]]`
     —— 对每个值判断 `min_val <= v <= max_val`；返回 `(valid_values, violation_indices)`，
     其中 `violation_indices` 是**越界值在入参 `values`（即 converted 列表）里的下标**。
   - `stage_collect(valid: list[int], violations: list[int], total_input: int, total_filtered: int) -> dict[str, Any]`
     —— 组装结果 dict。

2. **重写 `process`**：删掉内联的 `for`/`if` 循环，改为**依次调用这 4 个 stage**
   （一条 pipeline）。`process` 自身只剩编排，不再含逐元素处理逻辑。

3. **行为必须完全一致**（verify 会跑 6 组测试对照原始实现的黄金输出）。

### 规格

- **4 个 stage 函数**：签名严格如上（函数名、参数名、参数顺序、返回类型都对齐）。
- **修改文件**：`workspace/validator.py`（在原文件内新增 4 个 stage + 重写 `process`，
  **不要新建其它文件**）。
- **`process` 新形态**（参考写法）：
  ```python
  def process(values: list[Any], min_val: int, max_val: int) -> dict[str, Any]:
      filtered = stage_filter_none(values)
      converted = stage_convert(filtered)
      valid, violations = stage_range_check(converted, min_val, max_val)
      return stage_collect(valid, violations, len(values), len(filtered))
  ```
- **结果 dict 字段**（顺序与键名保持原样）：
  ```python
  {
      "valid": [...],
      "violations": [...],
      "total_input": <len(values)>,
      "total_filtered": <len(filtered)>,
      "total_valid": <len(valid)>,
  }
  ```

### 约束（务必遵守）

- 只改 `workspace/validator.py`，**不要新建其它文件**。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 4 个 stage 函数必须**真实存在且可独立调用**（verify 会直接调它们测行为，不只看文本）。
- `process` 必须**调用**这 4 个 stage（verify 会检查 `process` 函数体里出现了 4 个 stage 名），
  不能把 stage 逻辑又内联回 `process`。
- 不引入任何第三方依赖。

### 提示

- 每个 stage 是纯函数：`stage_filter_none` 只过滤、`stage_convert` 只转换、
  `stage_range_check` 只判范围、`stage_collect` 只组装 dict。互不耦合。
- **关键决策点 1 —— `violations` 的下标基准**：越界值记的是它在 **`converted`
  列表**（过滤+转换之后、范围检查的入参）里的下标，**不是**原始 `values` 的下标，
  也**不是** `filtered` 的下标（恰巧两者同长，但语义上属 converted）。照搬原始实现的
  `for i, v in enumerate(converted)` 即可对齐。
- **关键决策点 2 —— `total_filtered` 的来源**：是 `stage_filter_none` 之后的长度
  （`len(filtered)`），不是 `converted` 之后、也不是 `valid` 之后。
- `int(v)` 的失败分支：原始实现捕获 `(ValueError, TypeError)` 后追加 `0`；
  注意 `bool` 是 `int` 子类（`int(True) == 1`）属正常转换、不要特判。
- `stage_convert` 的入参类型标注是 `list[Any]`（过滤后的值仍可能是 str/混合类型），
  返回 `list[int]`。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。共 11 项检查（validator 可导入 + 4 个 stage 存在 +
4 个 stage 各自行为正确 + process 行为对照黄金完全一致 + process 函数体调用了 4 个
stage）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
