# Precis LLM Challenges

基于 [Precis](../README.md) 项目真实代码库的 agentic 编程考题套件，用于横向评测不同 LLM/agent（Claude Code、Cursor、ZCode、Copilot 等）在真实代码库上的能力。C 系列每题自包含、客观验证、与主仓库代码完全隔离；R / X 系列在真实仓库的独立副本（git worktree）中完成，考察真实代码库内的导航与长链条工程能力。

## 能力维度

| 缩写 | 维度 |
|------|------|
| `nav` | 代码库导航与理解 |
| `inc` | 跨文件跨层增量开发 |
| `dbg` | 调试与 bug 修复 |
| `refactor` | 重构与代码质量 |
| `x` | 专家级真实仓库任务（长链条联动 / 症状驱动调试 / 回归门重构 / 反模式判断力），难度 ★★★+ |

题目目录命名：`C<NN>-<dim>-<slug>`（精简 seed 沙盒）、`R<NN>-real-<slug>`（真实仓库导航）、`X<NN>-<slug>`（专家级）。C/R 难度三星制：`★☆☆` / `★★☆` / `★★★`；X 系列为 `★★★+`。完整清单见 [INDEX.md](INDEX.md)。

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
6. （可选，用于出报告）把 `workspace/RESULT.md` 复制到 `challenges/results/<run-id>/<题ID>.md`，然后跑 `python challenges/report.py <run-id>` 生成报告（见下方"报告"小节）。

## 约束（务必遵守）

> 以下约束针对 C 系列（workspace 模型）；R / X 系列无 workspace/seed，在真实仓库副本中改代码，约束见各题 `task.md` 与 [EVAL.md](EVAL.md)。

- 只在 `workspace/` 里修改文件。
- 不要改 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不要触碰 `challenges/` 以外的任何文件（即不要改主仓库代码）。
- **每题 verify 只跑 1 次**。无论 PASS/FAIL，结果就是最终成绩——看了 verify 输出后改代码重跑属于作弊（用 verify 反馈磨答案）。第一次跑完立刻记结果，做下一题。

## RESULT.md 模板

每题跑完后，把结果填进 `workspace/RESULT.md`。**必须用 YAML frontmatter**（下方 `---` 之间），report.py 靠它聚合：

```markdown
---
challenge: C01-nav-add-maxlength   # 题目录名
agent: claude-sonnet-4.5           # 模型标识
runner: Claude Code                # 跑题的 agent 工具
verify_exit_code: 0                # 0=PASS, 非0=FAIL
started: 2026-07-19T00:00:00Z      # ISO8601
finished: 2026-07-19T00:05:00Z
---

## verify 输出
（粘贴 verify 脚本的完整 stdout/stderr）

## 改动摘要
- ...

## 遇到的困难 / 备注
（可选，自由文本）
```

frontmatter 的 6 个字段都被 report.py 解析；正文是自由文本，附加在报告里供人读。

## 报告

跑完题（且把 RESULT.md 复制到 `results/<run-id>/` 后），用 report.py 生成报告：

```bash
# 单次运行报告：汇总某次评测的所有题
python challenges/report.py <run-id>
# → 生成 challenges/results/<run-id>/REPORT.md（总览 + 维度/栈/难度聚合）

# 跨模型对比榜单：扫所有 run-id
python challenges/report.py
# → 生成 challenges/results/LEADERBOARD.md（行=题，列=模型，格=pass/fail）

# 初始化一个空 run-id 目录
python challenges/report.py --init <run-id>
```

`results/` 目录入库（报告是评测产出，要留档）。

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
