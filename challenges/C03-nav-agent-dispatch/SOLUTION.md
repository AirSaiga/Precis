<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C03 SOLUTION — AI agent 调度链理解 + export_csv 注册修复

两部分：导航理解三问（`answers.py`）+ 一行工具注册（`tool_registry.py`）。

## 关键决策

1. **三模块的职责划分是理解本题的前提**。调度链是单向三段式：
   - **`planner`** 唯一决定**调用顺序**——它把 `goal` 字符串硬编码成有序的步骤列表，executor 只是按这个列表的顺序逐个跑，自身不做任何排序或决策（Q1 答案 = `planner`）。
   - **`tool_registry`** 是名字 → 函数的查表，`register_tool` 写、`get_tool` 读，模块导入时注册内置工具。
   - **`executor`** 是纯编排：遍历 steps → `get_tool` 取函数 → 调用 → 收集 results / errors / executed。

   planner 与 registry 之间**没有直接耦合**——planner 在步骤里写"工具名"，executor 才在运行时去 registry 查这个名字。正因如此，planner 写了一个 registry 没有的名字（`export_csv`）时，二者不会在编译/导入期暴露矛盾，矛盾只在执行期以"静默 error"的形式浮现。

2. **`executed` 跟踪"成功执行的工具数"，不是"处理的步骤数"**（Q2）。看 `executor.execute()` 的循环：`executed += 1` **只**在 `try` 块成功走完（`fn(tool_input)` 未抛异常）后才执行；`fn is None`（未注册）走 `continue`、抛异常走 `except`，两条路都不增 `executed`。所以 `executed` 永远 ≤ `len(steps)`，二者之差就是（未注册 + 抛异常的）失败步数。

3. **executor 对未注册工具"优雅跳过"，不崩溃**（Q3）。`get_tool` 返回 `None` 时，executor 只是 `errors.append({"step": ..., "tool": ..., "reason": "未注册"})` 然后 `continue`——既不抛异常，也不 `break`，后续步骤照常执行。这个设计是**故意**的：agent 在长流程里个别工具缺失不应让整个任务崩掉，而应把失败记录下来、继续跑完能跑的部分。

   **这也是漏注册 `export_csv` 成为"静默失败"的根因**：因为 executor 不崩，`execute(plan("export"))` 照常返回，只是 `executed == 1`（少一步）、`errors` 多一条 `export_csv 未注册`。如果调用方只看"是否抛异常"或"有没有返回"，根本发现不了问题——必须检查 `executed` 和 `errors` 才能察觉。

## 参考实现

`workspace/answers.py`（纯注释，三行）：

```python
# Q1: planner
# Q2: 成功执行的工具数（实际调用成功的步骤数）
# Q3: 记录错误并跳过该步，不中断、继续执行后续步骤
```

`workspace/tool_registry.py` 内置工具注册区，在 `report` 那行后追加一行：

```python
# 注意：'export_csv' 没注册！executor 执行到它会失败。
# ↓↓↓ 修复：补注册 export_csv（planner.plan("export") 会用到它）↓↓↓
register_tool("export_csv", lambda path: {"exported": path})
```

（即把原文件末尾"注意：'export_csv' 没注册！"那句注释的语义落实成一行真正的 `register_tool` 调用。）

## 常见错误模式

| 错误 | 后果 |
|------|------|
| Q1 误填 `executor` 或 `tool_registry` | 检查 Q1 失败（executor 只按列表跑，不决定顺序；registry 只查表，更不决定顺序） |
| Q2 描述成"步骤总数 / 处理的步数" | 检查 Q2 失败（未注册和抛异常的步不计入 `executed`） |
| Q3 描述成"抛异常 / 崩溃 / 中断" | 检查 Q3 失败（executor 是 `continue`，不中断） |
| 把注册加到 `executor.py` 或 `planner.py` 里 | 违反约束；且 executor 不持有 `_TOOLS`，加在它处无效 |
| 改 planner 的 `plan("export")` 步骤（如把 `export_csv` 换成已注册工具） | 违反约束（planner 只读）；且治标不治本，registry 仍缺 `export_csv` |
| 给 `get_tool` 加默认返回、或把 executor 的 `continue` 改成别的 | 违反约束（executor 只读） |
| 在 `answers.py` / `tool_registry.py` 顶部 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（verify 重定向导入期间的 stdout 并扫描 `PASS`/`FAIL`/`[✓]`/`[✗]`），整体 FAIL |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 `workspace/`，此时 `tool_registry.py` 无 `export_csv`，应 FAIL）
2. 创建 `workspace/answers.py`，写入上文三行注释。
3. 编辑 `workspace/tool_registry.py`，在内置工具注册区追加 `register_tool("export_csv", lambda path: {"exported": path})`。
4. `cd challenges/C03-nav-agent-dispatch && python verify.py` → 必须 PASS（退出码 0），8 项全 `[✓]`。
5. 若 FAIL，对照 verify 输出的 `[✗]` 行修正：
   - `Q1/Q2/Q3` 行失败 → 检查 `answers.py` 措辞是否含 verify 要求的关键词。
   - `'export_csv' 已注册` 失败 → 注册行没加 / 加错文件 / 写错名字。
   - `execute(plan('export')) 无错且执行 2 步` 失败 → 同上，或误改了 planner/executor。
6. 验证后 `./reset.sh` 复位（确认 clean seed 下 verify FAIL，证明修复确实是必需的）。
