"""
C07 verify — 验证 DateTimeType 正确注册并可校验/解析。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL。

防作弊（加载 agent 代码时）：
- 重定向 stdout，吞掉 agent 模块 import 期间的 print
- 捕获 BaseException，防止 sys.exit(0) 提前结束
- 扫描 import 期间输出，发现 PASS/FAIL/[✓]/[✗] 即判作弊
"""

from __future__ import annotations

import contextlib
import importlib
import io
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import():
    """
    安全导入 agent 的 registry 和 data_types 模块。

    返回 (registry_module, data_types_module, cheated)。
    - 重定向 stdout 防 agent 在 import 期间 print PASS/FAIL
    - 捕获 BaseException 防 sys.exit(0)
    - 扫描输出检测作弊关键字
    """
    buf = io.StringIO()
    reg = None
    dt_mod = None
    cheated = False
    try:
        # 清理可能已缓存的模块，确保拿到 workspace 内最新版本
        for m in list(sys.modules):
            if m in ("registry", "data_types"):
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            reg = importlib.import_module("registry")
            dt_mod = importlib.import_module("data_types")
    except BaseException:
        reg = None
        dt_mod = None
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return reg, dt_mod, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []

    reg, dt_mod, cheated = _safe_import()

    # 检查 1: data_types.py 含 DateTimeType 类
    DateTimeType = getattr(dt_mod, "DateTimeType", None) if dt_mod else None
    checks.append(("data_types.py 含 DateTimeType 类", DateTimeType is not None))

    # 检查 2: build_type_from_config("datetime") 返回 DateTimeType 实例（同时验证 import + 注册）
    def _check_registered() -> bool:
        if reg is None:
            return False
        try:
            t = reg.build_type_from_config("datetime")
            return t.__class__.__name__ == "DateTimeType"
        except Exception:
            return False

    checks.append(
        ('build_type_from_config("datetime") 返回 DateTimeType', _check_registered())
    )

    # 拿一个实例供后续行为测试用
    def _get_dt():
        if reg is None or DateTimeType is None:
            return None
        try:
            return reg.build_type_from_config("datetime")
        except Exception:
            return None

    dt = _get_dt()

    # 检查 3-6: validate 行为
    checks.append(
        (
            "validate 合法 datetime '2026-07-19 14:30:00' → True",
            dt is not None and dt.validate("2026-07-19 14:30:00") is True,
        )
    )
    checks.append(
        (
            "validate 拒绝纯日期 '2026-07-19'（缺时间部分）",
            dt is not None and dt.validate("2026-07-19") is False,
        )
    )
    checks.append(
        ("validate 拒绝非字符串 None", dt is not None and dt.validate(None) is False)
    )
    checks.append(
        (
            "validate 拒绝非法格式 '2026/07/19 14:30'",
            dt is not None and dt.validate("2026/07/19 14:30") is False,
        )
    )

    # 检查 7: parse 返回 datetime 对象（不是 date）
    def _check_parse() -> bool:
        if dt is None:
            return False
        try:
            r = dt.parse("2026-07-19 14:30:00")
            return isinstance(r, datetime) and r.year == 2026 and r.hour == 14
        except Exception:
            return False

    checks.append(("parse 返回 datetime 对象（非 date）", _check_parse()))

    # 检查 8: name 属性（实例继承类属性）
    checks.append(
        ('DateTimeType.name == "datetime"', dt is not None and dt.name == "datetime")
    )

    # 检查 9: 未注册类型仍抛 ValueError（注册表完整性未被破坏）
    def _check_unknown() -> bool:
        if reg is None:
            return False
        try:
            reg.build_type_from_config("nonexistent")
            return False
        except ValueError:
            return True
        except Exception:
            return False

    checks.append(("未知类型仍抛 ValueError（注册表完整性）", _check_unknown()))

    if cheated:
        print("FAIL")
        print("  [✗] 检测到疑似作弊：agent 代码在 import 期间输出了 PASS/FAIL/[✓]/[✗]")
        return 1

    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
