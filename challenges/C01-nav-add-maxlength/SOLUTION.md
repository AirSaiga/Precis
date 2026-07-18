<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C01 SOLUTION — MaxLength 约束

参考实现见同目录 `maxlength_constraint.py`。

## 关键决策

1. **None/NaN 跳过**：`pd.isna(value)` 判断，空值不报错。理由：空值归 NotNull 约束管，MaxLength 只管"有值但太长"。这是本题的区分度关键——只会照抄 NotNull 的 agent 会把空值也当违规。

2. **error 字典带 `max_length` 字段**：让错误自解释——看到 error 就知道阈值是多少，不用回查约束配置。

3. **`len(str(value))`**：先 `str()` 转换，兼容 int/float 等非字符串列（虽然题目说"字符串列"，但健壮实现不依赖调用方保证）。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 照抄 NotNull 的空值检测，把 None 也报 MaxLengthViolation | 检查 9（None 跳过）失败 |
| 忘了在 `__init__.py` 注册 import + `__all__` | 检查 2、13 失败（无法从包导出） |
| error 字典漏 `max_length` 字段 | 检查 11 失败 |
| `row_index` 用错（如返回 1-based 或字符串） | 检查 8、9、10 失败 |
| info 漏 `constraint_type`（重写 `get_constraint_info` 而非用基类） | 检查 12 失败 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/）
2. 把参考答案复制进 workspace：
   ```bash
   cp challenges/C01-nav-add-maxlength/maxlength_constraint.py \
      challenges/C01-nav-add-maxlength/workspace/app/shared/domain/constraints/maxlength_constraint.py
   ```
3. 编辑 `workspace/app/shared/domain/constraints/__init__.py`，加 import 行和 `__all__` 条目。
4. `cd challenges/C01-nav-add-maxlength && python verify.py` → 必须 PASS（退出码 0）。
5. 若 FAIL，检查 verify 输出的 `[✗]` 行对照修正。
6. 验证后 `./reset.sh` 复位。
