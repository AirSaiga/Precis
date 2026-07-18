"""
C01 verify 脚本 — 验证 MaxLength 约束实现。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL。
"""

from __future__ import annotations

import importlib
import inspect
import os
import sys

# 把 workspace/ 加入 sys.path，使 from app.shared.domain.constraints... 可用
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def main() -> int:
    try:
        import pandas as pd
    except ImportError:
        print("FAIL")
        print(
            '  [✗] 缺少 pandas：请在 Precis 后端环境运行（cd backend && pip install -e ".[dev]"）'
        )
        return 1

    checks: list[tuple[str, bool]] = []

    # 检查 1: maxlength_constraint.py 存在
    fpath = os.path.join(
        WORKSPACE, "app", "shared", "domain", "constraints", "maxlength_constraint.py"
    )
    checks.append(("maxlength_constraint.py 存在", os.path.exists(fpath)))

    # 后续检查依赖模块可导入；若不可导入，剩余全标 False
    MaxLengthConstraint = None
    Constraint = None
    try:
        # 先清理可能的旧缓存（agent 多次跑时）
        for mod_name in list(sys.modules):
            if mod_name.startswith("app.shared.domain.constraints"):
                del sys.modules[mod_name]
        constraints_pkg = importlib.import_module("app.shared.domain.constraints")
        MaxLengthConstraint = getattr(constraints_pkg, "MaxLengthConstraint", None)
        from app.shared.domain.constraints.base import Constraint
    except Exception:
        # 导入失败，剩余检查都 False
        pass

    # 检查 2: 可从包导出 MaxLengthConstraint
    checks.append(("MaxLengthConstraint 可导入", MaxLengthConstraint is not None))

    # 检查 3: 继承自 Constraint
    checks.append(
        (
            "MaxLengthConstraint 继承自 Constraint",
            MaxLengthConstraint is not None
            and Constraint is not None
            and issubclass(MaxLengthConstraint, Constraint),
        )
    )

    # 检查 4: __init__ 接受 (table, column, max_length)
    def _check_init_signature() -> bool:
        if MaxLengthConstraint is None:
            return False
        try:
            sig = inspect.signature(MaxLengthConstraint.__init__)
            params = list(sig.parameters.keys())
            # 期望 ['self', 'table', 'column', 'max_length']
            return params == ["self", "table", "column", "max_length"]
        except (ValueError, TypeError):
            return False

    checks.append(
        ("__init__ 签名为 (table, column, max_length)", _check_init_signature())
    )

    def _make(datasets: dict):
        """构造约束实例并跑 validate，失败返回 None。"""
        if MaxLengthConstraint is None:
            return None
        try:
            c = MaxLengthConstraint(table="users", column="name", max_length=5)
            return c.validate(datasets)
        except Exception:
            return None

    # 检查 5: 表不存在 → ConstraintConfigError
    def _check_table_missing() -> bool:
        r = _make({})
        if not r:
            return False
        errs = r.get("errors", [])
        return len(errs) == 1 and errs[0].get("error_type") == "ConstraintConfigError"

    checks.append(("表不存在 → ConstraintConfigError", _check_table_missing()))

    # 检查 6: 列不存在 → ConstraintConfigError
    def _check_col_missing() -> bool:
        r = _make({"users": pd.DataFrame({"id": [1, 2, 3]})})
        if not r:
            return False
        errs = r.get("errors", [])
        return len(errs) == 1 and errs[0].get("error_type") == "ConstraintConfigError"

    checks.append(("列不存在 → ConstraintConfigError", _check_col_missing()))

    # 检查 7: 全合规 → errors == []
    def _check_all_ok() -> bool:
        r = _make({"users": pd.DataFrame({"name": ["ab", "cde", "fghi"]})})
        if not r:
            return False
        return r.get("errors") == []

    checks.append(("全合规数据 → errors 为空", _check_all_ok()))

    # 检查 8: 超长值 → MaxLengthViolation 且 row_index 正确
    def _check_violation() -> bool:
        df = pd.DataFrame({"name": ["ab", "abcdefgh"]})  # 第 2 行超长（max=5）
        r = _make({"users": df})
        if not r:
            return False
        errs = r.get("errors", [])
        if len(errs) != 1:
            return False
        e = errs[0]
        return (
            e.get("error_type") == "MaxLengthViolation"
            and e.get("row_index") == 1
            and e.get("column") == "name"
            and e.get("value") == "abcdefgh"
        )

    checks.append(
        ("超长值 → MaxLengthViolation，row_index/value 正确", _check_violation())
    )

    # 检查 9（关键）: None/NaN 跳过
    def _check_none_skipped() -> bool:
        df = pd.DataFrame(
            {"name": ["ab", None, "abcdefgh"]}
        )  # 第 2 行 None，第 3 行超长
        r = _make({"users": df})
        if not r:
            return False
        errs = r.get("errors", [])
        # 只应报 1 条（第 3 行），None 不报
        if len(errs) != 1:
            return False
        return errs[0].get("row_index") == 2

    checks.append(("None/NaN 值被正确跳过（不报错）", _check_none_skipped()))

    # 检查 9b: NaN 也要跳过（用 numpy nan）
    def _check_nan_skipped() -> bool:
        import numpy as np

        df = pd.DataFrame(
            {"name": [np.nan, "ab", "abcdefgh"]}
        )  # 第 1 行 NaN，第 3 行超长
        r = _make({"users": df})
        if not r:
            return False
        errs = r.get("errors", [])
        if len(errs) != 1:
            return False
        return errs[0].get("row_index") == 2

    checks.append(("NaN 值被正确跳过", _check_nan_skipped()))

    # 检查 10: 多行超长 → 每行各一条
    def _check_multi() -> bool:
        df = pd.DataFrame({"name": ["abcdefgh", "xyz", "12345678"]})  # 第 1、3 行超长
        r = _make({"users": df})
        if not r:
            return False
        errs = r.get("errors", [])
        if len(errs) != 2:
            return False
        rows = sorted(e.get("row_index") for e in errs)
        return rows == [0, 2]

    checks.append(("多行超长 → 每行各一条 error", _check_multi()))

    # 检查 11: error 字典含 max_length 字段
    def _check_has_max_length_field() -> bool:
        df = pd.DataFrame({"name": ["abcdefgh"]})
        r = _make({"users": df})
        if not r:
            return False
        errs = r.get("errors", [])
        if len(errs) != 1:
            return False
        return errs[0].get("max_length") == 5

    checks.append(
        ("error 字典含 max_length 字段（值为配置值）", _check_has_max_length_field())
    )

    # 检查 12: info.constraint_type == "MaxLengthConstraint"
    def _check_info() -> bool:
        r = _make({"users": pd.DataFrame({"name": ["ab"]})})
        if not r:
            return False
        info = r.get("info") or {}
        return info.get("constraint_type") == "MaxLengthConstraint"

    checks.append(("info.constraint_type == MaxLengthConstraint", _check_info()))

    # 检查 13: __init__.py 的 __all__ 含 MaxLengthConstraint
    def _check_registered() -> bool:
        if MaxLengthConstraint is None:
            return False
        try:
            importlib.reload(constraints_pkg)
            return "MaxLengthConstraint" in getattr(constraints_pkg, "__all__", [])
        except Exception:
            return False

    checks.append(
        ("__init__.py 的 __all__ 含 MaxLengthConstraint", _check_registered())
    )

    # 输出
    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
