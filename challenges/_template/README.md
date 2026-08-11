# _template/ — 出题模板

复制本目录到 `Cxx-<dim>-<slug>/` 即可开始出一道新题。

## 用法

```bash
cd challenges
cp -r _template Cxx-<dim>-<slug>      # 例如 C02-nav-trace-pipeline
cd Cxx-<dim>-<slug>
# 1. 改 task.md（题目内容）
# 2. 把 seed 文件放进 seed/（从主仓库复制或合成）
# 3. 改 verify.py（检查项）
# 4. 改 SOLUTION.md（参考答案）
# 5. 跑 ./../reset.sh 生成 workspace/
# 6. 把 SOLUTION 答案填进 workspace/，跑 verify 必须 PASS（硬验收）
# 7. 跑 ./../reset.sh 复位
# 8. 更新 ../INDEX.md 加一行
# 9. commit
```

## 文件说明

| 文件 | 作用 |
|------|------|
| `task.md.template` | 题目骨架：元信息表 + 背景 + 任务 + 约束 + 验证 |
| `verify.py.template` | verify 骨架：含防作弊 `_safe_import` + 检查列表 + PASS/FAIL 输出 |
| `SOLUTION.md.template` | 参考答案骨架："别偷看"头 + 实现要点 + 常见错误表 + 自验步骤 |

复制后把 `.template` 后缀去掉，改内容。

## 维度缩写（用于目录名 `<dim>`）

`nav`（导航）/ `inc`（增量开发）/ `dbg`（调试）/ `refactor`（重构）

## verify 必须遵守的契约（见 ../README.md "verify 脚本统一契约"）

- 退出码 0=PASS / 非0=FAIL
- stdout 首行 `PASS` 或 `FAIL`
- 后续行 `  [✓] / [✗] 描述`
- TS 题用 `node verify.mjs`（静态检查，不跑 tsc）
- Python 题用 `python verify.py`
