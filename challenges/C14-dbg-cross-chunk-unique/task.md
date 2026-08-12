# C14 — 修复跨块唯一性检查漏检

| 项 | 值 |
|------|-----|
| ID | C14 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | Python |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Python ≥3.12 + pandas |

## 背景

`workspace/check_unique.py` 模拟 Precis 的分块加载（chunked loader）场景：大文件（>500MB 阈值）被切成多个 chunk 依次加载。`check_unique(chunks, column)` 校验某列在整个数据集中的唯一性，返回所有重复行的全局行号（跨 chunk 连续编号，0-based）。

## 症状

`check_unique` 漏报了部分重复行 —— 它本应找出**所有 chunk 合在一起后**该列的全部重复，但当前实现对某些重复情形返回值缺少该报的行号。程序不报错，只是悄悄少报。

修复 `check_unique`，使其能正确检出全部重复行（无论重复值分布在哪些 chunk）。

## 规格

- **函数名**：`check_unique`（保持不变）
- **文件**：`workspace/check_unique.py`
- **签名**：`check_unique(chunks: list[pd.DataFrame], column: str) -> list[int]`
- **行为**：
  - 全局行号映射：chunk0 占行 `0..len(chunk0)-1`，chunk1 从 `len(chunk0)` 起，依此类推（缺列的 chunk 也占行号空间）
  - `keep=False` 语义：重复值的所有副本都被标记（不只标第二个）
  - 无重复 → 返回 `[]`
  - 某些 chunk 缺该列 → 不能崩溃（跳过缺列 chunk 的该列，但仍计入它的行号偏移）
  - 所有 chunk 都缺该列 → 返回 `[]`

## 约束

- 只改 `workspace/check_unique.py`。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Python 标准库 + pandas）。

## 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。8 项检查（含单 chunk 回归、跨块重复、多跨块重复、无重复、三块跨块、缺列不崩溃、中间 chunk 缺列仍占行号偏移）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
