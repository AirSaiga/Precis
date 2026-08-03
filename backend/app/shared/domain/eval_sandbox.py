"""@fileoverview 表达式求值沙箱（共享）

功能概述:
- 提供 simpleeval 沙箱的统一配置（安全函数白名单），供 Scripted 约束与 MathExpr 转换共用。
- B-sec5: 消除 df.eval 的表达式注入面，统一改用 simpleeval 逐行求值。

设计原则:
- 只暴露确定安全的基础函数，禁止属性访问逃逸。
- names（变量绑定）由调用方按场景注入（约束注入 row/value，转换注入列值）。
"""

from __future__ import annotations

from simpleeval import SimpleEval

# 安全函数白名单：仅暴露纯函数，不含任何可访问属性/模块的对象。
# B-sec5: simpleeval 默认禁用属性访问与 dunder，配合此白名单可杜绝 __import__/open 等逃逸。
SAFE_FUNCTIONS: dict[str, object] = {
    "len": len,
    "sum": sum,
    "max": max,
    "min": min,
    "round": round,
    "abs": abs,
    "any": any,
    "all": all,
    "int": int,
    "str": str,
    "float": float,
    "bool": bool,
    "list": list,
    "dict": dict,
    "set": set,
}


def make_sandbox_evaluator(names: dict[str, object] | None = None) -> SimpleEval:
    """构造一个配置好安全白名单的 SimpleEval 求值器。

    参数:
        names: 变量名绑定（如约束场景的 row/value，转换场景的列名→列值）。

    返回:
        SimpleEval 实例，调用 .eval(expression) 求值。
    """
    evaluator = SimpleEval(names=names or {})
    evaluator.functions.update(SAFE_FUNCTIONS)
    return evaluator
