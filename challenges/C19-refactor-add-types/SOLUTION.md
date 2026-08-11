<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C19 SOLUTION — 给未注解的辅助函数补完整类型注解

参考实现即 `seed/formatters.py` 加上注解后的版本（见下方代码块）。

## 关键决策

1. **顶部加 `from __future__ import annotations` + `from typing import Any`**：符合 Precis 后端规范
   （AGENTS.md "Python 后端"），并让 `str | None` / `dict[str, Any]` 这类 PEP 604/585 语法可用，
   无需从 `typing` 导入 `Union` / `Dict`。

2. **`df` 参数标 `Any`**：函数只用了 `df.columns`（成员访问）和 `df[column].tolist()`（下标 + 方法），
   纯鸭子类型。为它专门定义 `Protocol` 是过度设计；为了避免引入 `import pandas`（题目禁止第三方依赖），
   标 `Any` 是最合适的选择。

3. **`kwargs` / `err` 标 `dict[str, Any]`**：这两个入参被 `.get(key)` / `.get(key, default)` 访问，
   值类型动态（布尔、字符串、list、None），用 `dict[str, Any]` 既准确又不啰嗦。

4. **返回类型逐一推导**：
   - `_conditional_pre_check` 有 `return None` 和 `return f"..."` 两条路径 → `str | None`
   - 其余三个 `return` 全是 dict 字面量，值类型多样 → `dict[str, Any]`

## 参考实现

```python
"""C19 seed — 4 个未注解的格式化/校验辅助函数。任务：补完整类型注解，不改行为。"""

from __future__ import annotations

from typing import Any


def _conditional_pre_check(df: Any, column: str, kwargs: dict[str, Any]) -> str | None:
    """条件预检：如果 kwargs 含 'enabled' 且为 False，返回跳过原因字符串；否则 None。"""
    if kwargs.get("enabled") is False:
        return f"列 '{column}' 的条件检查被禁用"
    if column not in df.columns:
        return f"列 '{column}' 不存在"
    return None


def _conditional_error_formatter(err: dict[str, Any]) -> dict[str, Any]:
    """把条件错误 dict 格式化为带前缀的新 dict。"""
    return {
        "type": "conditional",
        "original": err,
        "message": f"条件失败: {err.get('reason', '未知')}",
    }


def _fk_datasets_builder(df: Any, column: str, kwargs: dict[str, Any]) -> dict[str, Any]:
    """构建外键校验用的数据集 dict。"""
    related = kwargs.get("related_table")
    if related is None:
        return {}
    return {
        "main": df,
        "foreign": {column: df[column].tolist()},
        "related_name": related,
    }


def _scripted_error_formatter(err: dict[str, Any]) -> dict[str, Any]:
    """把脚本错误 dict 格式化为标准错误格式。"""
    severity = err.get("severity", "error")
    return {
        "error_type": "ScriptedViolation",
        "severity": severity,
        "message": err.get("message", ""),
        "row_index": err.get("row", -1),
    }
```

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 漏掉某个函数的返回值注解（`-> ...`） | 对应函数的"有返回值注解"检查失败 |
| 漏掉某个参数注解（只标了部分参数） | 对应函数的"所有参数有注解"检查失败 |
| 忘了加 `from __future__ import annotations` | 检查 10 失败（且在旧写法下可能误用 `Union`/`Dict`） |
| 给 `df` 定义了 `Protocol` 或 `import pandas` | 违反"不引入第三方依赖"约束；过度设计（非失败项，但偏离题意） |
| 改了函数体逻辑（如把 `is False` 改成 `not`） | 行为测试失败（`enabled: None` 等边缘语义被破坏） |
| 把 `_conditional_pre_check` 返回类型标成 `str`（漏 `None`） | 行为测试在严格类型检查下会报错；本题 verify 只看"有注解"，但语义不正确 |
| 在模块顶部 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊，整体 FAIL（verify 重定向 import 期间的 stdout 并扫描作弊关键字） |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，从 seed/ 复制）
2. 把上面的参考实现整段覆盖到 `workspace/formatters.py`
3. `cd C19-refactor-add-types && python verify.py` → 必须 PASS（退出码 0），11 项全 `[✓]`
4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照修正
5. 验证后 `./reset.sh` 复位（确认干净 seed 会 FAIL，验证题目有区分度）
