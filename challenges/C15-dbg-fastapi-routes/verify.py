"""
C15 verify — 验证 collect_paths 能拿到所有路由（含 include_router 的子路由）。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL，后续行为 `  [✓] / [✗] 描述`。

防作弊（加载 agent 代码时）：
- 重定向 stdout，吞掉 collector 模块 import 期间的 print
- 捕获 BaseException，防止 sys.exit(0) 提前结束
- 扫描 import 期间输出，发现 PASS/FAIL/[✓]/[✗] 即判作弊
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(HERE, "workspace")
sys.path.insert(0, WORKSPACE)


def _safe_import_collector():
    """安全导入 collector.py，返回 (collect_paths, cheated)。

    - 重定向 stdout 防作弊 print
    - 捕获 BaseException 防 sys.exit
    - 扫描输出检测作弊关键字
    """
    buf = io.StringIO()
    collect_paths = None
    cheated = False
    try:
        for m in ("collector", "app"):
            if m in sys.modules:
                del sys.modules[m]
        with contextlib.redirect_stdout(buf):
            from collector import collect_paths as cp

            collect_paths = cp
    except BaseException:
        pass
    captured = buf.getvalue()
    if any(k in captured for k in ("PASS", "FAIL", "[✓]", "[✗]")):
        cheated = True
    return collect_paths, cheated


def main() -> int:
    checks: list[tuple[str, bool]] = []

    # 环境检查：FastAPI 版本（仅提示，不计入 PASS/FAIL —— 但 <0.138 时 bug 不复现）
    try:
        import fastapi

        fastapi_version = getattr(fastapi, "__version__", "?")
    except ImportError:
        fastapi_version = None

    # 导入 app（构建 FastAPI 应用）
    try:
        # 确保 app 模块干净加载
        if "app" in sys.modules:
            del sys.modules["app"]
        from app import app

        checks.append(("app.py 可导入（FastAPI app 构建成功）", True))
    except Exception as e:
        checks.append((f"app.py 可导入（失败: {e}）", False))
        app = None

    collect_paths, cheated = _safe_import_collector()
    checks.append(
        ("collector.py 可导入（collect_paths 函数存在）", collect_paths is not None)
    )

    if app is not None and collect_paths is not None:
        result = None
        try:
            result = collect_paths(app)
            result_set = set(result) if not isinstance(result, set) else result
        except Exception as e:
            result_set = set()
            checks.append((f"collect_paths 执行无异常（失败: {e}）", False))
        else:
            checks.append(("collect_paths 执行无异常", True))

        if result is not None:
            # 期望路由集
            expected_path = os.path.join(WORKSPACE, "expected_routes.json")
            try:
                with open(expected_path, encoding="utf-8") as f:
                    expected = set(json.load(f))
            except Exception as e:
                checks.append((f"expected_routes.json 可加载（失败: {e}）", False))
                expected = set()

            checks.append(
                (
                    "collect_paths 含顶层路由 / 和 /health",
                    "/" in result_set and "/health" in result_set,
                )
            )
            checks.append(
                (
                    "collect_paths 含 include_router 的子路由 /api/items",
                    "/api/items" in result_set,
                )
            )
            checks.append(
                (
                    "collect_paths 含 include_router 的子路由 /api/items/{item_id}",
                    "/api/items/{item_id}" in result_set,
                )
            )
            checks.append(
                (
                    f"collect_paths 结果 == expected_routes.json（当前 {sorted(result_set)}）",
                    result_set == expected,
                )
            )
            checks.append(
                (
                    "无重复（结果是 set）",
                    isinstance(result, set) or len(result) == len(result_set),
                )
            )

    # 检查 9 (关键): 两层嵌套 include_router —— router_a 里 include router_b，
    # app 再 include router_a。FastAPI 0.138+ 每层 include 都是独立的 _IncludedRouter
    # 包装，"只展开一层 original_router.routes 不递归"的修法能拿到 /top-a 但会漏掉
    # 最深层的 /leaf-b。
    if collect_paths is not None:
        try:
            from fastapi import FastAPI as _FastAPI
            from fastapi.routing import APIRouter as _APIRouter

            router_b = _APIRouter()  # 最深层路由器
            router_a = _APIRouter()  # 中间层路由器

            @router_b.get("/leaf-b")
            def _leaf_b():
                return {}

            @router_a.get("/top-a")
            def _top_a():
                return {}

            router_a.include_router(router_b)  # 第一层嵌套
            nested_app = _FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
            nested_app.include_router(router_a)  # 第二层嵌套

            nested_result = collect_paths(nested_app)
            checks.append(
                (
                    "嵌套 include_router 递归收集（/top-a 与深层 /leaf-b）",
                    "/top-a" in nested_result and "/leaf-b" in nested_result,
                )
            )
        except Exception as e:
            checks.append((f"嵌套 include_router 递归收集（失败: {e}）", False))

    # 检查 10-11 (关键): 重复 include 去重 + 保序 —— 同一个 router 被 include_router
    # 两次（无 prefix）。FastAPI 0.138+ 会在 app.routes 里放两个 _IncludedRouter 包装，
    # 指向同一个 original_router，递归收集会把 /dup-a、/dup-b 各收两遍。
    # 不去重的递归版（尤其返回 list 的）会在这里暴露。
    if collect_paths is not None:
        try:
            from fastapi import FastAPI as _FastAPI2
            from fastapi.routing import APIRouter as _APIRouter2

            dup_router = _APIRouter2()

            @dup_router.get("/dup-a")
            def _dup_a():
                return {}

            @dup_router.get("/dup-b")
            def _dup_b():
                return {}

            dup_app = _FastAPI2(docs_url=None, redoc_url=None, openapi_url=None)

            @dup_app.get("/top")
            def _top():
                return {}

            dup_app.include_router(dup_router)
            dup_app.include_router(dup_router)  # 同一 router 重复挂载（无 prefix）

            dup_result = collect_paths(dup_app)
            dup_set = set(dup_result)
            expected_dup = {"/top", "/dup-a", "/dup-b"}
            checks.append(
                (
                    "重复挂载同一 router 不重复收集（结果恰为去重后的 3 条路径）",
                    dup_set == expected_dup and len(dup_result) == len(dup_set),
                )
            )
            # 保序：set 无顺序语义只看去重；若实现返回有序结构（list/tuple），
            # 其顺序必须与注册顺序一致（/top 先注册，随后是 router 内的 /dup-a、/dup-b）
            if isinstance(dup_result, (list, tuple)):
                ordered_ok = list(dup_result) == ["/top", "/dup-a", "/dup-b"]
            else:
                ordered_ok = True
            checks.append(("返回顺序与注册顺序一致（有序结构时）", ordered_ok))
        except Exception as e:
            checks.append((f"重复 include 去重 + 保序（失败: {e}）", False))

    # 防作弊触发（优先于结果判定）
    if cheated:
        print("FAIL")
        print("  [✗] 检测到疑似作弊：agent 代码在 import 期间输出了 PASS/FAIL/[✓]/[✗]")
        return 1

    ok_all = all(ok for _, ok in checks)
    print("PASS" if ok_all else "FAIL")
    for desc, ok in checks:
        print(f"  [{'✓' if ok else '✗'}] {desc}")

    # 版本提示（不影响退出码，但 <0.138 时提醒 bug 可能不复现）
    if fastapi_version is not None:
        major, minor = fastapi_version.split(".")[:2]
        try:
            ver_num = (int(major), int(minor))
        except ValueError:
            ver_num = (0, 0)
        if ver_num < (0, 138):
            print(
                f"  [i] 提示：检测到 FastAPI {fastapi_version} < 0.138，"
                f"include_router 的 _IncludedRouter 包装不生效，bug 可能不复现"
            )

    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
