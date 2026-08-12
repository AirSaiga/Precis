# X02 — 症状驱动调试：IME 输入下画布快捷键误触发（真实仓库故障注入）

| 项 | 值 |
|------|-----|
| ID | X02 |
| 类型 | 真实仓库症状驱动调试（故障注入） |
| 栈 | TypeScript / Vue 3（vitest） |
| 难度 | ★★★+ |
| 预估 | 25-45 分钟 |

> 本题在**真实 Precis 前端仓库的副本（git worktree）**上调试。bug 不在题面里，
> 由注入脚本埋进仓库副本的真实代码中——你只看到用户报告的现象，需要自己定位根因。
> 没有给出任何文件路径。

## 故障注入（必做的第一步）

在本目录运行：

```
python plant.py
```

它会在当前仓库副本里埋入一个真实 bug（只改 `frontend/src/` 下的一处文件，
锚点匹配失败会报错退出而不会乱改）。注入后 `node verify.mjs` 应当 **FAIL**——
先确认你能复现失败，再开始定位。

> ⚠️ 绝不要在主仓库 `D:/Precis/Precis` 运行 `plant.py`，只在评测副本 / worktree 里运行。

## 现象（用户报告）

多位使用中文 / 日文输入法的用户反馈，在画布上操作时出现诡异问题：

- **偶发画布节点被删除**——用户只是在输入框外的画布区域打字，
  选词阶段想删掉一个拼音字母，结果选中的节点没了；
- **偶发快捷键动作误触发**——选词过程中按下候选数字键、甚至确认候选时，
  画布像收到了真实快捷键一样响应，打断输入；
- 纯英文输入（无输入法）时**从未**复现；
- 焦点在画布上（而非任何输入框内）时复现率最高；问题飘忽、难以稳定复现，
  与「按键处于输入法选词阶段」强相关。

## 任务

定位根因并修复，使得：

- 输入法选词阶段派发的按键**不再触发任何画布快捷键**（交给输入法正常处理）；
- 非输入法状态下所有快捷键行为**完全不变**。

## 约束

- 只改 `frontend/src/` 下的代码；**不得**修改 `challenges/` 目录、**不得**修改
  `frontend/tests/` 目录（verify 脚本会自行放置测试文件）。
- 修复必须作用于事件分发链路的**上游**——一处修复、所有快捷键受益；
  不要逐个快捷键 handler 打补丁。
- 修复前先想清楚：为什么「焦点不在输入框」时问题最严重？已有的输入框守卫
  覆盖了什么、没覆盖什么？
- 注意浏览器/版本差异：表达「按键处于输入法合成态」的信号不止一个，
  只认其中一种会在部分环境失效。

## 验证

在本目录运行：

```
node verify.mjs
```

`verify.mjs` 会把一个行为级测试文件临时注入 `frontend/tests/features/keyboard/`，
与该目录**既有 4 个测试文件一起**以 vitest 运行（注入测试 + 全量回归），
结束后无论成败都会清理临时文件，不污染仓库。

退出码 `0` = PASS，非 `0` = FAIL。stdout 首行为 `PASS` 或 `FAIL`。

> 预期状态机：注入故障后 → FAIL；修复后 → PASS。
> 前端用 **vitest**（不是 jest）。首次启动 vitest 较慢，verify 超时设为 150s。

## 环境提示（worktree 缺依赖时）

worktree 不含 `frontend/node_modules`，verify 会因环境缺失 FAIL。二选一：

```bash
# (a) 零成本（Windows）：junction 共享主仓库依赖
# 推荐 PowerShell 形式——Git Bash 下 cmd //c mklink 会被 MSYS 改坏参数
# （实测 D:\ 反斜杠路径被吃掉 / 报「参数格式不正确」）：
powershell -Command "New-Item -ItemType Junction -Path '<worktree>\frontend\node_modules' -Target '<主仓库>\frontend\node_modules'"
# 若在原生 cmd.exe 里（非 Git Bash）也可直接 mklink：
#   mklink /J "<worktree>\frontend\node_modules" "<主仓库>\frontend\node_modules"
# (b) 干净安装（需网络）
cd <worktree>/frontend && npm ci
```

> ⚠️ 清理顺序（运维/评分方注意）：删除 worktree 前**先删 junction**
> （`cmd //c rmdir "<worktree>\frontend\node_modules"`，rmdir 不穿透 junction），
> 再 `git worktree remove --force`。直接 worktree remove 会穿透 junction，
> 把主仓库 frontend/node_modules 一并清空。

完成后按 [challenges/README.md](../README.md) 把结果记入 `results/<run-id>/X02-dbg-planted-ime.md`。
