# C03-nav-agent-dispatch — 理解 AI agent 调度链并补全缺失的工具注册

| 项 | 值 |
|----|-----|
| ID | C03 |
| 维度 | nav（代码库导航与理解）+ 小修复 |
| 栈 | Python |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Python ≥3.12（仅标准库，无第三方包） |

## 背景

workspace 里有 3 个自包含的 Python 文件，建模了一个 AI agent 的任务执行系统
（`workspace/planner.py` / `workspace/executor.py` / `workspace/tool_registry.py`）。

这是 **nav（代码导航）任务**：先**读懂**这三个文件如何协作，再回答四道理解题并做一处小修复。

## 任务

### 1. 回答四道理解题

新建 `workspace/answers.py`，**仅作为注释**回答四个问题（每问一行，格式严格如下，verify 用正则匹配）：

```python
# Q1: <决定工具调用顺序的模块名>
# Q2: <一句话：execute() 里 executed 计数器跟踪的是什么>
# Q3: <一句话：get_tool 返回 None 时 executor 怎么处理>
# Q4: <一句话：描述错误累积路径——未注册工具如何被记入 errors、整个 plan 是否中断>
```

- **Q1**：哪个模块决定工具调用的**顺序**？答案填一个模块名（`planner` / `executor` / `tool_registry` 之一）。
- **Q2**：在 `execute()` 里，`executed` 计数器跟踪的是什么？
- **Q3**：当 `get_tool` 返回 `None`（工具未注册）时，executor 做什么？
- **Q4**：错误累积路径是怎样的？——未注册的工具具体如何被记入 `errors`（记了什么字段），
  以及此时整个 plan 是中断还是继续？（一句话，需同时覆盖"记入 errors"与"plan 继续/不中断"两点）

### 2. 修复：导出链路

当前**导出链路**跑不通：planner 产出的导出类计划里，有些步骤的工具没有注册，
executor 执行到它们时只是静默记错跳过——流程"看起来跑完了"，实际导出没发生。

读完代码，**自行定位所有缺失注册的工具**并补上，使所有导出相关流程都能完整跑通
（每步都真正执行、无 error）。具体缺了几个、怎么改、加在哪，读完代码自行决定。
verify 只测行为，不查内部实现。

## 约束

- **可改**：`workspace/answers.py`（新建）、`workspace/tool_registry.py`。
- **禁止改**：`workspace/planner.py`、`workspace/executor.py`、`verify.py`、`task.md`、`SOLUTION.md`、`seed/`。
- 不碰 `workspace/` 以外的任何文件。

## 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。检查项详见 verify 输出。
