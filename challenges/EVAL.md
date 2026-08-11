# 评测提示词模板

> **用法**：每次换模型，把下方「占位符」两行的 `【模型名】` 改掉（如 `glm52` / `claude` / `gpt5`），整段贴给 agent 即可。多个模型各自独立目录，可并发跑，互不冲突。

---

完成 Precis LLM Challenges 评测。全程自主，不要等我确认。

## 占位符（每次换模型只改这两行）

```
评测目录名：eval-【模型名】        ← 例：eval-glm52 / eval-claude / eval-gpt5
run-id：【模型名】-run             ← 例：glm52-run / claude-run / gpt5-run
```

## 流程

1. **创建独立副本 + 删除答案**（防作弊，与其他模型隔离）：
   ```bash
   cp -r D:/Precis/Precis/challenges D:/Precis/eval-【模型名】
   cd D:/Precis/eval-【模型名】          # 后续都在这个目录里
   rm -rf C*/workspace results           # 清掉可能带过来的运行时残留
   mkdir -p results
   # ⚠️ 关键：删除所有参考答案，防止 agent 读答案作弊
   find . -path "*/C*/SOLUTION.md" -delete
   rm -f C01-nav-add-maxlength/maxlength_constraint.py   # C01 的独立参考答案文件
   # 验证答案已删干净（应无输出）
   find . -name "SOLUTION.md" -o -name "maxlength_constraint.py"
   ```

2. 读 `README.md` 学规则 + RESULT.md frontmatter 格式。

3. `./reset.sh` 生成所有 workspace/。

4. **逐题做**（C01→C24 全部 24 题），每题：
   - `cd challenges/Cxx-题目目录名`（注意：副本里 challenges 内容直接在根目录，所以是 `cd Cxx-题目目录名`）
   - 读 `task.md` + `workspace/` 里已有的参考文件
   - 在 `workspace/` 里实现或修复
   - 跑 `python verify.py`（Python 题）或 `node verify.mjs`（TS/JS 题）—— **只跑 1 次！**
     无论 PASS 还是 FAIL，立即把结果记进 RESULT.md，然后做下一题。
     **不允许**看了 verify 输出后改代码重跑（那是用 verify 反馈磨答案 = 作弊）。
   - 在 `results/【模型名】-run/` 下创建 `<题目录名>.md`，内容是 YAML frontmatter：
     ```yaml
     ---
     challenge: Cxx-题目目录名
     agent: 你的真实模型标识
     runner: ZCode / Claude Code / Cursor / 手动
     verify_exit_code: 0          # 0=PASS, 非0=FAIL
     started: 2026-08-12T10:00:00Z
     finished: 2026-08-12T10:12:00Z
     ---

     ## 改动摘要
     - ...

     ## 备注
     - ...
     ```
     FAIL 也如实记 `verify_exit_code: 1`，写清卡在哪。
   - 回到 challenges 根目录，做下一题。

5. **全部做完后**：
   ```bash
   python report.py 【模型名】-run
   ```
   把生成的 REPORT.md（总览 + 维度/栈/难度聚合）展示给我看。

## 硬约束

- **每题 verify 只跑 1 次**。无论 PASS/FAIL，结果就是最终成绩。看了 verify 输出后再改代码重跑 = 用反馈磨答案 = 作弊。第一次跑完立刻记结果，做下一题。
- **参考答案已在第 1 步删除**（`SOLUTION.md` 和 `maxlength_constraint.py` 已 `rm`）。如果你发现它们还在，说明第 1 步没执行，停下来重做。
- **只改** `workspace/` 内文件，不碰 `seed/`、`verify.*`、`task.md`。
- **不碰** `D:/Precis/Precis/challenges/`（主仓库，只是模板源）。
- verify 退出码为准（0=PASS）。做不出记 FAIL 继续，不跳题不放弃。
- `agent` 字段填真实模型标识（如 `glm-5.2` / `claude-sonnet-4.5`）。

## 注意路径

你的工作目录是 `D:/Precis/eval-【模型名】`，**不是主仓库**。
所有 reset / verify / report 都在副本目录里跑。

副本目录结构（复制后）：
```
eval-【模型名】/
├── README.md          ← 规则说明
├── INDEX.md           ← 24 题清单
├── reset.sh           ← 生成 workspace/
├── report.py          ← 出报告
├── C01-nav-add-maxlength/
│   ├── task.md        ← 读这个
│   ├── seed/          ← 不改
│   ├── workspace/     ← 在这里改
│   └── verify.py      ← 跑这个
├── C02-...
└── results/
    └── 【模型名】-run/   ← 每题的 RESULT 归档到这里
```

---

## 跑完多个模型后：汇总跨模型榜单

每个模型跑完，结果在各副本的 `results/<run-id>/` 里。全部跑完后，在**主仓库**做一次汇总：

```bash
cd D:/Precis/Precis/challenges

# 把各副本的结果收集回来
cp -r ../../eval-glm52/results/glm52-run results/
cp -r ../../eval-claude/results/claude-run results/
cp -r ../../eval-gpt5/results/gpt5-run results/

# 出跨模型对比榜单（行=题，列=模型，格=✅/❌）
python report.py
```

生成的 `results/LEADERBOARD.md` 就是 24 题 × N 模型的 pass/fail 矩阵 + 各模型总通过率。

## 快速参考：24 题矩阵

| 维度 \ 难度 | Py ★☆☆ | Py ★★☆ | Py ★★★ | TS ★☆☆ | TS ★★☆ | TS ★★★ |
|------------|--------|--------|--------|--------|--------|--------|
| nav | C01 | C02 | C03 | C04 | C05 | C06 |
| inc | C07 | C08 | C09 | C10 | C11 | C12 |
| dbg | C13 | C14 | C15 | C16 | C17 | C18 |
| refactor | C19 | C20 | C21 | C22 | C23 | C24 |

想缩小范围（如只跑 ★☆☆ 或只跑 dbg），在提示词第 4 步加一句"只做以下题目：C01、C04、C07..."即可。
