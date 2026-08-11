"""
C01 verify 脚本（hard 模式）— 黑盒行为测试。

不检查内部实现细节（函数签名、错误字段名、error_type 命名）。
只检查行为：给定输入，约束是否正确报错/不报错。

退出码：0 = PASS，非 0 = FAIL。
"""

from __future__ import annotations

import contextlib
import importlib
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import():
    """安全导入 agent 代码，防作弊。"""
    buf = io.StringIO()
    MaxLengthConstraint = None
    Constraint = None
    cheated = False
    try:
        for mod_name in list(sys.modules):
            if mod_name.startswith("app.shared.domain.constraints") or mod_name in (
                "app",
                "app.shared",
                "app.shared.domain",
            ):
                del sys.modules[mod_name]
        with contextlib.redirect_stdout(buf):
            constraints_pkg = importlib.import_module("app.shared.domain.constraints")
            MaxLengthConstraint = getattr(constraints_pkg, "MaxLengthConstraint", None)
            from app.shared.domain.constraints.base import Constraint
    except BaseException:
        pass
    captured = buf.getvalue()
    if any(k in captured for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return MaxLengthConstraint, Constraint, captured, cheated


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

    # 检查 1: 文件存在
    fpath = os.path.join(
        WORKSPACE, "app", "shared", "domain", "constraints", "maxlength_constraint.py"
    )
    checks.append(("maxlength_constraint.py 存在", os.path.exists(fpath)))

    MaxLengthConstraint, Constraint, _captured, cheated = _safe_import()

    # 检查 2: 可导入
    checks.append(("MaxLengthConstraint 可导入", MaxLengthConstraint is not None))

    # 检查 3: 继承 Constraint（系统契约）
    checks.append(
        (
            "MaxLengthConstraint 继承自 Constraint",
            MaxLengthConstraint is not None
            and Constraint is not None
            and issubclass(MaxLengthConstraint, Constraint),
        )
    )

    def _make(table, column, max_length):
        """构造约束实例。"""
        if MaxLengthConstraint is None:
            return None
        try:
            return MaxLengthConstraint(
                table=table, column=column, max_length=max_length
            )
        except Exception:
            return None

    def _validate(c, datasets):
        """跑 validate，失败返回 None。"""
        if c is None:
            return None
        try:
            return c.validate(datasets)
        except Exception:
            return None

    # 检查 4: 表不存在 → 报错（行为：errors 非空，不管叫什么 error_type）
    c = _make("users", "name", 5)
    r = _validate(c, {})
    checks.append(("表不存在时报错", r is not None and len(r.get("errors", [])) > 0))

    # 检查 5: 列不存在 → 报错
    r = _validate(c, {"users": pd.DataFrame({"id": [1, 2, 3]})})
    checks.append(("列不存在时报错", r is not None and len(r.get("errors", [])) > 0))

    # 检查 6: 全合规 → errors 空
    r = _validate(c, {"users": pd.DataFrame({"name": ["ab", "cde", "fghi"]})})
    checks.append(("全合规数据不报错", r is not None and r.get("errors") == []))

    # 检查 7: 超长值 → 产生含正确 row_index + value 的 error
    df = pd.DataFrame({"name": ["ab", "abcdefgh"]})  # 第 2 行超长
    r = _validate(c, {"users": df})
    found_violation = False
    if r is not None:
        errs = r.get("errors", [])
        for e in errs:
            if e.get("row_index") == 1 and e.get("value") == "abcdefgh":
                found_violation = True
                break
    checks.append(("超长值被正确报告（row_index + value 匹配）", found_violation))

    # 检查 8（关键区分度）: None 值 → 跳过（不报错）
    df = pd.DataFrame({"name": ["ab", None, "abcdefgh"]})  # 第 2 行 None，第 3 行超长
    r = _validate(c, {"users": df})
    none_ok = False
    if r is not None:
        errs = r.get("errors", [])
        # 只应报第 3 行（row_index=2），None 的行不报
        if len(errs) == 1 and errs[0].get("row_index") == 2:
            none_ok = True
    checks.append(("None 值被正确跳过（不报错）", none_ok))

    # 检查 9: NaN 值 → 跳过
    import numpy as np

    df = pd.DataFrame({"name": [np.nan, "ab", "abcdefgh"]})  # 第 1 行 NaN，第 3 行超长
    r = _validate(c, {"users": df})
    nan_ok = False
    if r is not None:
        errs = r.get("errors", [])
        if len(errs) == 1 and errs[0].get("row_index") == 2:
            nan_ok = True
    checks.append(("NaN 值被正确跳过", nan_ok))

    # 检查 10: 多行超长 → 每行各一条
    df = pd.DataFrame({"name": ["abcdefgh", "xyz", "12345678"]})  # 第 1、3 行超长
    r = _validate(c, {"users": df})
    multi_ok = False
    if r is not None:
        errs = r.get("errors", [])
        rows = sorted(
            e.get("row_index") for e in errs if e.get("row_index") is not None
        )
        multi_ok = rows == [0, 2]
    checks.append(("多行超长各报一条", multi_ok))

    # 检查 11: info 非空且含 constraint_type（基类契约）
    r = _validate(c, {"users": pd.DataFrame({"name": ["ab"]})})
    info_ok = False
    if r is not None:
        info = r.get("info") or {}
        ct = info.get("constraint_type")
        info_ok = isinstance(ct, str) and len(ct) > 0
    checks.append(("info 含非空 constraint_type", info_ok))

    # 检查 12: __all__ 含 MaxLengthConstraint（注册完整性）
    pkg = sys.modules.get("app.shared.domain.constraints")
    checks.append(
        (
            "__init__.py 的 __all__ 含 MaxLengthConstraint",
            pkg is not None and "MaxLengthConstraint" in getattr(pkg, "__all__", []),
        )
    )

    # 检查 13（关键区分度）: row_index 是 pandas 索引标签（非位置序号）
    df = pd.DataFrame({"name": ["ab", "abcdefgh", "xy"]}, index=[10, 20, 30])
    r = _validate(c, {"users": df})  # 第 2 行（label=20）超长
    label_ok = False
    if r is not None:
        errs = r.get("errors", [])
        if len(errs) == 1 and errs[0].get("row_index") == 20:
            label_ok = True
    checks.append(("row_index 为索引标签（非位置序号）", label_ok))

    # 防作弊
    if cheated:
        print("FAIL")
        print("  [✗] 检测到疑似作弊")
        return 1

    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
