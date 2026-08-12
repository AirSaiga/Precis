"""C09 verify — 验证 LengthConstraint 贯穿三层可用。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL。

防作弊：import domain / service / api 时重定向 stdout，若检测到模块在导入期
打印 PASS / FAIL / [✓] / [✗] 等标记，直接判 FAIL。
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


def _safe_import(mod_name: str) -> tuple[object, bool]:
    """安全导入模块，返回 (模块 or None, 是否作弊)。

    导入前清掉已缓存的 domain/service/api 模块，避免上次残留；
    导入时重定向 stdout，捕获模块级 print。
    """
    buf = io.StringIO()
    mod: object = None
    cheated = False
    try:
        for m in list(sys.modules):
            if m in ("domain", "service", "api"):
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            mod = importlib.import_module(mod_name)
    except BaseException:
        pass
    if any(k in buf.getvalue() for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return mod, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []

    domain, c1 = _safe_import("domain")
    service, c2 = _safe_import("service")
    api, c3 = _safe_import("api")
    cheated = c1 or c2 or c3
    checks.append(("domain.py 可导入", domain is not None))
    checks.append(("service.py 可导入", service is not None))

    # domain 层：LengthConstraint 类
    LengthConstraint = getattr(domain, "LengthConstraint", None) if domain else None
    checks.append(("domain.LengthConstraint 类存在", LengthConstraint is not None))

    # domain 层：注册表含 "length"
    def _check_registered() -> bool:
        if domain is None:
            return False
        return "length" in getattr(domain, "CONSTRAINT_FACTORIES", {})

    checks.append(('CONSTRAINT_FACTORIES 含 "length"', _check_registered()))

    # domain 层：build_constraint 能造出实例
    def _make_constraint() -> object | None:
        if domain is None:
            return None
        try:
            return domain.build_constraint("length", {"min_len": 2, "max_len": 5})
        except Exception:
            return None

    lc = _make_constraint()
    checks.append(('build_constraint("length", ...) 成功', lc is not None))

    # domain 层：validate 闭区间 + 拒非字符串
    def _check_validate() -> bool:
        if lc is None:
            return False
        try:
            return (
                lc.validate("abc") is True  # len 3, in [2,5]
                and lc.validate("ab") is True  # len 2, boundary
                and lc.validate("abcde") is True  # len 5, boundary
                and lc.validate("a") is False  # len 1, too short
                and lc.validate("abcdef") is False  # len 6, too long
                and lc.validate(123) is False  # non-string
                and lc.validate(None) is False
            )
        except Exception:
            return False

    checks.append(
        ("LengthConstraint.validate 闭区间正确 + 拒绝非字符串", _check_validate())
    )

    # domain 层：constraint_type 属性
    checks.append(
        (
            'LengthConstraint.constraint_type == "length"',
            lc is not None and getattr(lc, "constraint_type", None) == "length",
        )
    )

    # domain 层：构造参数校验 —— 非法参数在 __init__ 阶段抛 ConstraintConfigError。
    # 陷阱：agent 不校验构造参数（非法配置拖到 validate 才暴露，或静默存下）。
    # 断言异常类型必须是 domain.ConstraintConfigError 本身（或其子类），
    # 抛裸 ValueError / TypeError / 不抛都判失败。
    def _raises_config_error(**kwargs: object) -> bool:
        if domain is None or LengthConstraint is None:
            return False
        cce = getattr(domain, "ConstraintConfigError", None)
        if not (isinstance(cce, type) and issubclass(cce, BaseException)):
            return False
        try:
            LengthConstraint(**kwargs)
        except cce:
            return True
        except Exception:
            return False
        return False

    checks.append(
        (
            "构造参数 min_len > max_len 抛 ConstraintConfigError",
            _raises_config_error(min_len=5, max_len=2),
        )
    )
    checks.append(
        (
            "构造参数任一为负数抛 ConstraintConfigError",
            _raises_config_error(min_len=-1, max_len=5)
            and _raises_config_error(min_len=0, max_len=-2),
        )
    )

    # service 层：validate_column 端到端能用 length 约束
    def _check_service() -> bool:
        if service is None:
            return False
        try:
            r = service.validate_column(
                ["ab", "abcdef", "abc"], "length", {"min_len": 2, "max_len": 5}
            )
            # "ab" ok, "abcdef" too long (idx 1), "abc" ok
            return (
                r["passed"] is False
                and r["violations"] == [1]
                and r.get("constraint_type") == "length"
            )
        except Exception:
            return False

    checks.append(("service.validate_column 端到端可用 length 约束", _check_service()))

    # service 层：未知类型仍报错（注册表完整性）
    def _check_unknown() -> bool:
        if service is None:
            return False
        try:
            r = service.validate_column(["a"], "nonexistent", {})
            return r.get("error") is not None
        except Exception:
            return False

    checks.append(("未知约束类型仍报错（三层完整性）", _check_unknown()))

    # 架构洞察：service.py 不应被大改（generic 编排层通用）
    svc_path = os.path.join(WORKSPACE, "service.py")
    svc_src = (
        open(svc_path, encoding="utf-8").read() if os.path.exists(svc_path) else ""
    )
    checks.append(
        (
            "service.py 未被大改（架构正确：编排层通用）",
            "def validate_column" in svc_src,
        )
    )

    # api 层：真实 import api 模块（task.md 声明的 fastapi 依赖在此坐实）
    checks.append(("api.py 可导入", api is not None))

    # api 层：真实 HTTP 请求 GET /constraint-types，清单必须含 "length"
    # （同时断言了路由注册存在且响应内容来自最新注册表）
    def _check_api_types() -> bool:
        if api is None:
            return False
        try:
            from fastapi.testclient import TestClient

            resp = TestClient(api.app).get("/constraint-types")
            return resp.status_code == 200 and "length" in resp.json().get("types", [])
        except Exception:
            return False

    checks.append(('api GET /constraint-types 清单含 "length"', _check_api_types()))

    # 架构考点（★★★）："只改 domain、不碰 service/api"。
    # 两层都是 generic 编排/透传，源码里不应出现具体约束类型名 "length" 的特判
    # （如 if constraint_type == "length": 分支或硬编码清单）。
    api_path = os.path.join(WORKSPACE, "api.py")
    api_src = (
        open(api_path, encoding="utf-8").read() if os.path.exists(api_path) else ""
    )
    checks.append(
        (
            'service.py 无 "length" 字样特判（编排层对具体类型无知）',
            '"length"' not in svc_src and "'length'" not in svc_src,
        )
    )
    checks.append(
        (
            'api.py 无 "length" 字样特判（路由层对具体类型无知）',
            '"length"' not in api_src and "'length'" not in api_src,
        )
    )

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
