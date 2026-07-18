# Precis LLM Challenges

基于 [Precis](../README.md) 项目真实代码库的 agentic 编程考题套件，用于横向评测不同 LLM/agent（Claude Code、Cursor、ZCode、Copilot 等）在真实代码库上的能力。每题自包含、客观验证、与主仓库代码完全隔离。

## 能力维度

| 缩写 | 维度 |
|------|------|
| `nav` | 代码库导航与理解 |
| `inc` | 跨文件跨层增量开发 |
| `dbg` | 调试与 bug 修复 |
| `refactor` | 重构与代码质量 |

题目目录命名：`C<NN>-<dim>-<slug>`，如 `C01-nav-add-maxlength`。难度三星制：`★☆☆` / `★★☆` / `★★★`。完整清单见 [INDEX.md](INDEX.md)。

## 首次使用（仅一次）

`workspace/` 被 [.gitignore](.gitignore) 排除，clone 后不存在。先在 `challenges/` 根目录跑一次 reset 把所有 `workspace/` 从 `seed/` 复制出来：

```bash
# Git Bash / macOS / Linux
./reset.sh

# PowerShell
powershell -File reset.ps1
```

## 怎么开始（给 agent 的指引）

1. 浏览 [INDEX.md](INDEX.md) 或本目录下的 `C*/` 子目录，挑一题。
2. 进入该题目录，读 `task.md` —— 题目要求、约束、提示都在里面。
3. 在 `workspace/` 目录里干活。`workspace/` 是你专属的工作区，初始内容已从 `seed/` 复制好（若不存在或不确定是否干净，回 `challenges/` 根跑 reset）。**只改 `workspace/`，不要碰 `seed/`**。
4. 完成后在该题目录跑验证脚本（具体命令见该题 `task.md`）：
   - Python 题：`python verify.py`
   - TS 题：`node verify.mjs`（或按 `task.md` 指定）
5. 把结果填进 `workspace/RESULT.md`（模板见下）。

## 约束（务必遵守）

- 只在 `workspace/` 里修改文件。
- 不要改 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不要触碰 `challenges/` 以外的任何文件（即不要改主仓库代码）。
- 跑不通就调试，但最终结果以 verify 脚本的退出码为准。

## RESULT.md 模板

每题跑完后，把结果填进 `workspace/RESULT.md`：

```markdown
# RESULT — <题目录名>

- agent: <claude-sonnet-4.5 / gpt-5 / glm-4.6 / ...>
- runner: <Claude Code / Cursor / ZCode / 手动>
- started: <ISO8601 时间戳>
- finished: <ISO8601 时间戳>
- verify_exit_code: 0   ← 0=PASS, 非0=FAIL

## verify 输出
（粘贴 verify 脚本的完整 stdout/stderr）

## 改动摘要
- ...

## 遇到的困难 / 备注
（可选，自由文本）
```

`verify_exit_code` 字段机器可扫，便于未来出榜单。

## verify 脚本统一契约

所有题的 verify 脚本必须遵守：

| 项 | 约定 |
|----|------|
| 退出码 | `0` = PASS，非 0 = FAIL |
| stdout 第一行 | `PASS` 或 `FAIL`（大写，便于 grep） |
| stdout 后续行 | 详细检查列表，每行 `  [✓] / [✗] 描述` |
| stderr | 仅用于异常栈/调试信息 |
| 工作目录 | 必须能在题目录下运行（`cd C01-... && python verify.py`），不依赖外部路径 |
| 依赖 | 只用 workspace 内文件 + Python/Node 标准库（`task.md` 显式声明例外） |

## 出题者 checklist

新增一题的流程：

1. `INDEX.md` 加一行（状态 `💡 idea` → `🚧 stub` → `✅ ready`）。
2. 建目录 `Cxx-<dim>-<slug>/`，写 `task.md`。
3. 从主仓库复制需要的文件到 `seed/`（保留包路径）。
4. 写 `verify.py`（约 10-15 项检查）。
5. 写 `SOLUTION.md` 参考答案。
6. **把 SOLUTION 答案填进 `workspace/`，跑 `verify.py` 必须出 PASS**（硬验收）。
7. 跑 `./reset.sh`（或 `reset.ps1`）复位 `workspace/` 到 `seed/` 状态。
8. `INDEX` 状态改 `✅ ready`。
9. commit。
