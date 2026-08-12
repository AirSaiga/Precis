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

1. **创建完整仓库 worktree**（防作弊，与其他模型隔离）：
   ```bash
   # 用 git worktree 创建完整仓库副本（含 challenges/ + backend/ + frontend/）
   # 注意：必须加 --detach —— main 分支已被主仓库检出，
   # 不加会报 fatal: 'main' is already used by worktree
   cd D:/Precis/Precis
   git worktree add --detach D:/Precis/eval-【模型名】 main
   cd D:/Precis/eval-【模型名】/challenges

   # 清掉运行时残留
   rm -rf C*/workspace results
   mkdir -p results

   # R04 需要 frontend 依赖（worktree 不含 node_modules）——二选一：
   # (a) 零成本（Windows）：PowerShell 建 junction 共享主仓库依赖（前端测试只读 node_modules，安全）。
   #     注意：Git Bash 下 `cmd //c mklink /J` 会被 MSYS 改坏参数，必须用 PowerShell 形式。
   powershell -Command "New-Item -ItemType Junction -Path 'D:\Precis\eval-【模型名】\frontend\node_modules' -Target 'D:\Precis\Precis\frontend\node_modules'"
   # (b) 干净安装（需网络，数分钟）：cd ../frontend && npm ci

   # ✅ SOLUTION.md 已从 git 移除（.gitignore），worktree 天然不含任何答案。
   # 以下 find 只是确认（应无输出）。如果用 cp -r 而非 worktree，则 find -delete 仍是必须的。
   find . -name "SOLUTION.md" -o -name "maxlength_constraint.py"
   ```

   > **轻量替代**（只跑 C 系列 24 题，不跑 R/X 系列）：用 `cp -r D:/Precis/Precis/challenges D:/Precis/eval-【模型名】` 代替 worktree。但 cp -r 会复制本地 SOLUTION.md、results/（含历史答案摘要）和可能脏的 workspace/，所以 cp 方案**必须**先跑：
   > ```bash
   > cd D:/Precis/eval-【模型名】
   > rm -rf C*/workspace results && mkdir results          # 清历史结果与脏工作区
   > find . -name SOLUTION.md -delete                      # 删答案
   > rm -f C01-nav-add-maxlength/maxlength_constraint.py   # 删 C01 独立答案文件
   > ```
   > R / X 系列需要完整仓库，cp 只有 challenges/ 不够。

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
   - **判定边界**：R 系列 verify 除注入测试外还会**回归仓库既有相关测试**（回归门）——你的实现若破坏既有测试，verify 直接 FAIL。动手前先读相关既有测试了解约束。

5.5. **X 系列逐题做**（X01→X04，共 4 题，专家级真实仓库题），每题：
   - `cd Xxx-题目目录名`
   - 读 `task.md`（只给需求/现象，**不给文件路径**）
   - **X02 特例**：先跑 `python plant.py` 在 worktree 的真实仓库里注入故障（task.md 会说明），再开始定位修复。
   - 在真实仓库里导航并实现（X01 是全栈长链条、X03 是处方式重构、X04 要识别需求里的反模式）
   - 跑 `python verify.py` 或 `node verify.mjs` —— **只跑 1 次！**（同上，verify 会临时注入测试并回归既有测试）
   - 在 `results/【模型名】-run/` 下创建 `<题目录名>.md`（同 C 系列 frontmatter 格式）。

6. **全部做完后**：
   ```bash
   python report.py 【模型名】-run
   ```
   把生成的 REPORT.md（总览 + 维度/栈/难度聚合）展示给我看。

## 硬约束

- **每题 verify 只跑 1 次**（C / R / X 系列都一样）。无论 PASS/FAIL，结果就是最终成绩。看了 verify 输出后再改代码重跑 = 用反馈磨答案 = 作弊。第一次跑完立刻记结果，做下一题。
- **参考答案已在第 1 步删除**（`SOLUTION.md` 和 `maxlength_constraint.py` 已 `rm`）。如果你发现它们还在，说明第 1 步没执行，停下来重做。
- **C 系列**：只改 `workspace/` 内文件，不碰 `seed/`、`verify.*`、`task.md`。
- **R / X 系列**：在真实仓库 `backend/` 或 `frontend/` 里改，但**不碰** `tests/` 目录（verify 脚本会自己放测试文件）和 `challenges/` 目录。
- **R04 / X 系列前置**：worktree 里必须先备好 frontend 依赖（第 1 步的 junction 或 npm ci），否则 verify 会因环境缺失 FAIL 而非能力 FAIL。
- **X02 前置**：做 X02 前必须先跑 `python plant.py` 注入故障（该脚本只在你的 worktree 里改一个文件，放心跑）。
- **不碰** `D:/Precis/Precis/`（主仓库，只是模板源）。
- **不访问** `D:/Precis/eval-*` 下的任何其他目录（那是别的模型的评测副本）。你只能在自己的 worktree（`D:/Precis/eval-【模型名】`）内活动。读其他模型的实现 = 作弊。
- verify 退出码为准（0=PASS）。做不出记 FAIL 继续，不跳题不放弃。
- `agent` 字段填真实模型标识（如 `glm-5.2` / `claude-sonnet-4.5`）。

## 注意路径

你的工作目录是 `D:/Precis/eval-【模型名】`（git worktree，完整仓库），**不是主仓库**。
所有 reset / verify / report 都在 worktree 里跑。
- C 系列题：在 `challenges/Cxx-xxx/workspace/` 里改。
- R / X 系列题：在 `backend/` 或 `frontend/` 里改（真实代码库导航）。

副本目录结构（复制后）：
```
eval-【模型名】/
├── README.md          ← 规则说明
├── INDEX.md           ← 32 题清单
├── reset.sh           ← 生成 workspace/
├── report.py          ← 出报告
├── C01-nav-add-maxlength/
│   ├── task.md        ← 读这个
│   ├── seed/          ← 不改
│   ├── workspace/     ← 在这里改
│   └── verify.py      ← 跑这个
├── C02-...
├── X01-e2e-fullstack-constraint/   ← X 系列（真实仓库专家级）
└── results/
    └── 【模型名】-run/   ← 每题的 RESULT 归档到这里
```

---

## 跑完多个模型后：汇总跨模型榜单

**每个模型的评测结果直接留存在其 worktree 里（`D:/Precis/eval-【模型名】/results/【模型名】-run/`）——不拷回主仓库，汇总时也绝不删除 worktree**（worktree 就是该模型结果的存档；删除会连带丢失全部结果，且若 junction 未先摘除，`worktree remove --force` 会穿透 junction 清空主仓库 `frontend/node_modules`）。

出跨模型榜单时，在**主仓库**用 report.py 直接读取各 worktree 的结果目录（只读，不复制）：

```bash
cd D:/Precis/Precis/challenges

# 直接把各 worktree 的 run 目录路径传给 report.py
python report.py D:/Precis/eval-glm52/results/glm52-run \
                 D:/Precis/eval-claude/results/claude-run \
                 D:/Precis/eval-gpt5/results/gpt5-run
```

生成的 `results/LEADERBOARD.md` 就是 32 题 × N 模型的 pass/fail 矩阵 + 各模型总通过率（主仓库只落这一份派生产物，逐题结果不入主仓库）。

**worktree 回收（可选，且只在你确认不再需要该模型的结果之后）**——默认保留。若确定回收，严格按此顺序：

```bash
# 1. 若建过 junction：先删 junction 并确认消失
#    （直接 worktree remove 会穿透 junction 清空主仓库 frontend/node_modules）
powershell -Command "Remove-Item -Force 'D:\Precis\eval-【模型名】\frontend\node_modules'"
ls D:/Precis/eval-【模型名】/frontend/node_modules 2>/dev/null && echo "junction 仍在，勿删 worktree！"

# 2. 确认该 worktree 的 results/ 已不需要（会随之消失）
cd D:/Precis/Precis && git worktree remove --force D:/Precis/eval-【模型名】
```

## 快速参考：完整矩阵

### C 系列（24 题，精简 seed）

| 维度 \ 难度 | Py ★☆☆ | Py ★★☆ | Py ★★★ | TS ★☆☆ | TS ★★☆ | TS ★★★ |
|------------|--------|--------|--------|--------|--------|--------|
| nav | C01 | — | C02 / C03 | C04 | — | C05 / C06 |
| inc | C07 | C08 | C09 | C10 | — | C11 / C12 |
| dbg | C13 | — | C14 / C15 | C16 | C17 | C18 |
| refactor | C19 | C20 | C21 | C22 | C23 | C24 |

> 经加难后 ★★☆ 与 ★★★ 分布有调整（C02/C05/C11/C14 → ★★★），星级以 `INDEX.md` 为准。

### R 系列（真实仓库导航）

| ID | 栈 | 难度 | 考点 |
|----|----|------|------|
| R01 | Python | ★★★ | Pattern 约束（6 处联动） |
| R02 | Python | ★★☆ | CLI 命令 |
| R03 | Python | ★★★ | parquet 加载器 |
| R04 | TS | ★★☆ | 键盘快捷键 |

### X 系列（真实仓库专家级，★★★+）

| ID | 栈 | 难度 | 考点 |
|----|----|------|------|
| X01 | Python+TS | ★★★+ | 端到端全栈约束（后端 6 处 + 前端 5 处 + i18n 双侧） |
| X02 | TS | ★★★+ | 症状驱动调试（plant.py 预埋 IME 守卫缺失） |
| X03 | TS | ★★★+ | 处方式重构 + 既有测试回归门 |
| X04 | TS | ★★★+ | 反模式判断力（需求与仓库铁律冲突） |

想缩小范围（如只跑 ★☆☆ 或只跑 dbg），在提示词第 4 步加一句"只做以下题目：C01、C04、C07..."即可。
