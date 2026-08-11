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

这是 **nav（代码导航）任务**：先**读懂**这三个文件如何协作，再回答三道理解题并做一处小修复。

## 任务

### 1. 回答三道理解题

新建 `workspace/answers.py`，**仅作为注释**回答三个问题（每问一行，格式严格如下，verify 用正则匹配）：

```python
# Q1: <决定工具调用顺序的模块名>
# Q2: <一句话：execute() 里 executed 计数器跟踪的是什么>
# Q3: <一句话：get_tool 返回 None 时 executor 怎么处理>
```

- **Q1**：哪个模块决定工具调用的**顺序**？答案填一个模块名（`planner` / `executor` / `tool_registry` 之一）。
- **Q2**：在 `execute()` 里，`executed` 计数器跟踪的是什么？
- **Q3**：当 `get_tool` 返回 `None`（工具未注册）时，executor 做什么？

### 2. 修复：在 `tool_registry.py` 注册缺失的 `export_csv`

当前有一个工具 `export_csv` 没有被注册——补上它的注册，使相关流程能跑通。具体怎么改、加在哪，
读完代码自行决定。verify 只测行为，不查内部实现。

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
