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

本 `workspace/` 里有 3 个自包含的 Python 文件，建模了 Precis 后端 AI agent 的「规划器 → 执行器 → 工具注册表」调度链（见主仓库 `AGENTS.md`：`backend/app/shared/services/ai/agent/` 下的 `planner.py` / `executor.py` / `tool_registry.py`）。

整体数据流是单向的三段式：

```
planner.plan(goal)  →  steps: [{"tool": ..., "input": ...}, ...]
                              │
                              ▼
                     executor.execute(steps)
                              │   对每一步：get_tool(name) → fn / None
                              ▼
                  tool_registry（名字 → 可调用对象的字典）
```

三个文件各管一段：

- **`workspace/planner.py`**（**只读，不改**）：把 `goal` 字符串拆成有序的步骤列表。它**决定工具调用的顺序**。注意 `plan("export")` 会产出含 `"export_csv"` 的步骤。
- **`workspace/tool_registry.py`**（**本题要改**）：维护一个名字 → 函数的字典 `_TOOLS`。`register_tool(name, fn)` 注册，`get_tool(name)` 按名查（未注册返回 `None`）。模块末尾在导入时注册了 3 个内置工具（`load_data` / `validate` / `report`）。**当前 bug：`export_csv` 没注册。**
- **`workspace/executor.py`**（**只读，不改**）：遍历 `steps`，每步用 `get_tool` 取函数并调用，把成功结果收进 `results`、未注册/抛异常的收进 `errors`，并维护 `executed` 计数。

**先读 `workspace/planner.py` 和 `workspace/executor.py`**，理解：

- 谁决定调用顺序（Q1）
- `executor.execute()` 里 `executed` 这个计数器到底在数什么（Q2）
- `get_tool` 返回 `None` 时 executor 怎么处理（Q3）

## 任务（导航理解 + 小修复）

### 1. 导航理解：创建 `workspace/answers.py`

新建文件 `workspace/answers.py`，**用注释**回答三个问题（每问一行，格式严格如下，冒号后直接写答案）：

```python
# Q1: <决定工具调用顺序的模块名>
# Q2: <一句话：executed 跟踪的是什么>
# Q3: <一句话：get_tool 返回 None 时 executor 怎么做>
```

- **Q1**：哪个模块决定工具调用的**顺序**？答案填一个模块名（`planner` / `executor` / `tool_registry` 之一）。
- **Q2**：在 `execute()` 里，`executed` 计数器跟踪的是什么？（如"成功执行的工具数 / 实际调用成功的步骤数"）
- **Q3**：当 `get_tool` 返回 `None`（工具未注册）时，executor 做什么？（如"记录错误并跳过，不中断继续后续步骤"）

### 2. 修复：在 `tool_registry.py` 注册缺失的 `export_csv`

`planner.plan("export")` 会产出 `export_csv` 这一步，但 `tool_registry.py` 没注册它，导致 executor 执行到时记一条 error、`executed` 比 2 少 1（**静默失败**——不会崩，只是结果短一截）。

补一行注册：

```python
register_tool("export_csv", lambda path: {"exported": path})
```

加到 `tool_registry.py` 内置工具注册区（与其它 `register_tool(...)` 并列）。

### 规格

- **answers.py 三行注释**（严格匹配 `# Q1: <word>` / `# Q2: <phrase>` / `# Q3: <phrase>`，冒号用半角 `:`）：
  - Q1 → `planner`
  - Q2 → 含"成功/执行成功/实际执行"等含义的短语
  - Q3 → 含"跳过/记录错误/不中断/继续"等含义的短语
- **tool_registry.py**：增加 `register_tool("export_csv", lambda path: {"exported": path})` 一行。
- **修复后契约**：`execute(plan("export"))` 返回 `executed == 2`、`errors == []`、`len(results) == 2`。
- **回归不破**：`execute(plan("validate_and_report"))` 仍返回 `executed == 3`、`errors == []`。

### 约束（务必遵守）

- **可改**：`workspace/answers.py`（新建）、`workspace/tool_registry.py`（加一行注册）。
- **禁止改**：`workspace/planner.py`、`workspace/executor.py`、`verify.py`、`task.md`、`SOLUTION.md`、`seed/`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

### 提示

- 顺着数据流走一遍：`planner.plan("export")` → 看产出的 steps → `executor.execute(steps)` → 每步 `get_tool(name)`。这是理解三模块职责的最快路径。
- 看 `executor.execute()` 的 `for` 循环：`fn = get_tool(tool_name)` 后的 `if fn is None:` 分支决定 Q3 的答案；`executed += 1` 只在 `try` 成功分支里执行，决定 Q2 的答案。
- **关键决策点**：executor 对未注册工具是**优雅跳过**（记一条 error、`continue`，不抛异常不中断）。正因如此，漏注册的 `export_csv` 才是一个**静默失败**——程序不崩，只是 `executed` 少了 1、`errors` 多了 1。如果不理解这点，容易误以为"加个 try/except"或"改 planner"才是修复方向。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。检查项含：answers.py 存在 + 三问答案匹配 / `export_csv` 已注册 / `execute(plan('export'))` 无错且执行 2 步 / `validate_and_report` 流程仍正常（3 步全过）/ 防作弊扫描。8 项检查详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
