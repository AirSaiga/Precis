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

1. **创建完整仓库 worktree + 删除答案**（防作弊，与其他模型隔离）：
   ```bash
   # 用 git worktree 创建完整仓库副本（含 challenges/ + backend/ + frontend/）
   cd D:/Precis/Precis
   git worktree add D:/Precis/eval-【模型名】 main
   cd D:/Precis/eval-【模型名】/challenges

   # 清掉运行时残留
   rm -rf C*/workspace results
   mkdir -p results

   # ⚠️ 关键：删除所有参考答案（C 系列 + R 系列），防止 agent 读答案作弊
   find . -path "*/C*/SOLUTION.md" -delete
   find . -path "*/R*/SOLUTION.md" -delete
   rm -f C01-nav-add-maxlength/maxlength_constraint.py
   # 验证答案已删干净（应无输出）
   find . -name "SOLUTION.md" -o -name "maxlength_constraint.py"
   ```

   > **轻量替代**（只跑 C 系列 24 题，不跑 R 系列）：用 `cp -r D:/Precis/Precis/challenges D:/Precis/eval-【模型名】` 代替 worktree。但 R 系列需要完整仓库，cp 只有 challenges/ 不够。

2. 读 `README.md` 学规则 + RESULT.md frontmatter 格式。

3. `./reset.sh` 生成所有 C 系列 workspace/。

4. **C 系列逐题做**（C01→C24，共 24 题），每题：
   - `cd Cxx-题目目录名`
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

5. **R 系列逐题做**（R01→R04，共 4 题，真实仓库导航），每题：
   - `cd Rxx-题目目录名`
   - 读 `task.md`（只给需求，**不给文件路径**）
   - 在真实仓库里导航（`backend/` 或 `frontend/`），找到相关文件并实现功能 + 注册
   - 跑 `python verify.py`（Python 题）或 `node verify.mjs`（TS 题）—— **只跑 1 次！**
     verify 会把测试文件临时放进 `backend/tests/` 或 `frontend/tests/`，跑真实 pytest/vitest，然后清理。
   - 在 `results/【模型名】-run/` 下创建 `<题目录名>.md`（同 C 系列 frontmatter 格式）。

6. **全部做完后**：
   ```bash
   python report.py 【模型名】-run
   ```
   把生成的 REPORT.md（总览 + 维度/栈/难度聚合）展示给我看。

## 硬约束

- **每题 verify 只跑 1 次**（C 系列和 R 系列都一样）。无论 PASS/FAIL，结果就是最终成绩。看了 verify 输出后再改代码重跑 = 用反馈磨答案 = 作弊。第一次跑完立刻记结果，做下一题。
- **参考答案已在第 1 步删除**（`SOLUTION.md` 和 `maxlength_constraint.py` 已 `rm`）。如果你发现它们还在，说明第 1 步没执行，停下来重做。
- **C 系列**：只改 `workspace/` 内文件，不碰 `seed/`、`verify.*`、`task.md`。
- **R 系列**：在真实仓库 `backend/` 或 `frontend/` 里改，但**不碰** `tests/` 目录（verify 脚本会自己放测试文件）和 `challenges/` 目录。
- **不碰** `D:/Precis/Precis/`（主仓库，只是模板源）。
- verify 退出码为准（0=PASS）。做不出记 FAIL 继续，不跳题不放弃。
- `agent` 字段填真实模型标识（如 `glm-5.2` / `claude-sonnet-4.5`）。

## 注意路径

你的工作目录是 `D:/Precis/eval-【模型名】`（git worktree，完整仓库），**不是主仓库**。
所有 reset / verify / report 都在 worktree 里跑。
- C 系列题：在 `challenges/Cxx-xxx/workspace/` 里改。
- R 系列题：在 `backend/` 或 `frontend/` 里改（真实代码库导航）。

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

生成的 `results/LEADERBOARD.md` 就是 28 题 × N 模型的 pass/fail 矩阵 + 各模型总通过率。

## 快速参考：完整矩阵

### C 系列（24 题，精简 seed）

| 维度 \ 难度 | Py ★☆☆ | Py ★★☆ | Py ★★★ | TS ★☆☆ | TS ★★☆ | TS ★★★ |
|------------|--------|--------|--------|--------|--------|--------|
| nav | C01 | C02 | C03 | C04 | C05 | C06 |
| inc | C07 | C08 | C09 | C10 | C11 | C12 |
| dbg | C13 | C14 | C15 | C16 | C17 | C18 |
| refactor | C19 | C20 | C21 | C22 | C23 | C24 |

### R 系列（真实仓库导航）

| ID | 栈 | 难度 | 考点 |
|----|----|------|------|
| R01 | Python | ★★★ | Pattern 约束（6 处联动） |
| R02 | Python | ★★☆ | CLI 命令 |
| R03 | Python | ★★★ | parquet 加载器 |
| R04 | TS | ★★☆ | 键盘快捷键 |

想缩小范围（如只跑 ★☆☆ 或只跑 dbg），在提示词第 4 步加一句"只做以下题目：C01、C04、C07..."即可。
