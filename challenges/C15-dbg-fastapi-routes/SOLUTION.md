<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C15 SOLUTION — collect_paths 丢失 include_router 子路由

参考实现见下方代码块。

## 关键决策

1. **递归遍历而非扁平循环**：FastAPI 0.138+ 把 `include_router()` 的结果封装为内部的 `_IncludedRouter` 对象，真正的子路由藏在 `_IncludedRouter.original_router.routes` 里。一个嵌套 `include_router`（路由器 A include 路由器 B）会产生多层 `_IncludedRouter`，所以必须递归才能全拿到。把 `collect_paths` 的核心循环抽成一个内部 `_collect(routes)`，对每个 route 既取它的 `.path`、又递归它的 `original_router.routes`。

2. **用 `getattr(route, "original_router", None)` 而非 `route.original_router`**：防御式写法。普通 `APIRoute`、`APIWebSocketRoute`、旧版 FastAPI（<0.138）的 route 对象**没有** `original_router` 属性，直接访问会 `AttributeError`。`getattr(..., None)` 让同一份代码跨 FastAPI 版本、跨 route 类型都能工作——这正是真实 Precis 代码库的做法（见 `backend/tests/unit/test_ai_router_registration.py` 的 `_collect_paths`）。

3. **用 `getattr(route, "path", None)` 取 path**：并非所有 route 对象都有 `.path`（`_IncludedRouter` 的 `.path` 是 `None`，某些 mount/websocket route 结构不同）。统一用 `getattr` + `is not None` 守卫，`None` 时不加入集合，避免把 `None` 混进 `set[str]`。

4. **结果用 `set` 天然去重**：`@items_router.get("")` 和 `@items_router.post("")` 经 prefix 拼接后 path 都是 `/api/items`（HTTP method 不同但 path 相同）。`set` 自动合并，符合"收集路径"（而非"收集端点"）的语义。

5. **为什么这个 bug 特别阴险**：程序**不报错、不抛异常**，只是返回值悄悄少了几条路径。没有任何信号告诉你少了东西——调用方（路由清单、健康检查、文档生成、权限审计）会基于不完整的数据继续工作，问题只在很晚之后才暴露。这类"静默漏数据"比"抛错"难调试得多。

## 参考实现

```python
"""
路由收集器（C15 SOLUTION）。

修复点：递归遍历，处理 FastAPI 0.138+ 的 _IncludedRouter 包装。
"""
from __future__ import annotations

from fastapi import FastAPI


def collect_paths(app: FastAPI) -> set[str]:
    """收集 app 的所有路由路径（含 include_router 引入的子路由）。

    FastAPI 0.138+ 把 include_router 的结果封装为 _IncludedRouter，
    子路由藏在 route.original_router.routes 里，需递归收集。
    用 getattr 防御式访问，兼容旧版 FastAPI 和无 original_router 的 route。
    """

    def _collect(routes) -> set[str]:
        paths: set[str] = set()
        for route in routes:
            # 1. 取 route 自身的 path（有就加）
            path = getattr(route, "path", None)
            if path is not None:
                paths.add(path)
            # 2. 若是 _IncludedRouter 包装，递归进 original_router.routes
            original = getattr(route, "original_router", None)
            if original is not None:
                paths.update(_collect(original.routes))
        return paths

    return _collect(app.routes)
```

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 只加 `original_router` 检查但不递归（直接 `original.routes` 一层 for） | 嵌套 `include_router` 漏掉更深层子路由（本题 verify 只测一层，能过；但真实场景会漏） |
| 用 `route.original_router` 直接访问而非 `getattr` | 普通 `APIRoute` 没有 `original_router` 属性 → `AttributeError` → collect_paths 抛异常 → 检查"执行无异常"FAIL |
| 用 `route.path` 直接访问而非 `getattr` | `_IncludedRouter` 等对象 `.path` 可能不存在或为 `None`；若 `None` 被加入 set 会污染结果，且 `set[str]` 类型不一致 |
| 只递归不取顶层 route 的 `.path`（把 path 收集放进 else 分支） | 顶层 `APIRoute`（`/`、`/health`）丢失 → 检查"含顶层路由"FAIL |
| 在模块顶层 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（verify 重定向 import 期间的 stdout 并扫描 PASS/FAIL/[✓]/[✗]），整体 FAIL |
| 改了 app.py（如手动展开 routes） | 违反约束（虽然 verify 不强检，但 task.md 明确禁止；且破坏了"修复 collect_paths"的考察点） |
| 只处理 `include_router` 但忘了 set 去重，返回 list 含重复 `/api/items` | 检查"无重复（结果是 set 或长度一致）"可能仍过（因为可转 set），但语义上不干净 |

## 边缘情况说明

- **旧版 FastAPI（<0.138）**：`_IncludedRouter` 包装不生效，子路由直接平铺在 `app.routes` 里，`getattr(route, "original_router", None)` 返回 `None` 不递归——代码照常工作。这正体现了防御式 `getattr` 的价值：一份代码跨版本。
- **`path=None` 的 route**：`_IncludedRouter` 的 `.path` 是 `None`，`getattr` 取到 `None` 后被 `if path is not None` 守卫挡住，不会污染 `set[str]`。
- **同 path 不同 method**：`GET /api/items` 与 `POST /api/items` 路径相同，`set` 自动合并为一条。本题 `expected_routes.json` 也只列一条 `/api/items`。

## 出题者自验步骤

1. **确认 FastAPI 版本 ≥ 0.138**：
   ```bash
   python -c "import fastapi; print(fastapi.__version__)"
   ```
   若 `< 0.138`，先 `pip install "fastapi>=0.138.0"`，否则 bug 不复现。

2. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed）

3. 把参考答案（上方代码块）写进 `workspace/collector.py`（覆盖 seed 副本）。

4. `cd C15-dbg-fastapi-routes && python verify.py` → 必须 PASS（退出码 0）。
   预期 6 项检查全 `[✓]`：
   - app.py 可导入
   - collector.py 可导入
   - collect_paths 执行无异常
   - 含顶层路由 / 和 /health
   - 含子路由 /api/items
   - 含子路由 /api/items/{item_id}
   - 结果 == expected_routes.json
   - 无重复（set）

5. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。

6. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让"含子路由 /api/items"、"含子路由 /api/items/{item_id}"、"结果 == expected"三项 FAIL（collect_paths 仍只返回 `{/, /health}`），整体 FAIL。

7. 再次 `./reset.sh` 复位到干净状态入库。
