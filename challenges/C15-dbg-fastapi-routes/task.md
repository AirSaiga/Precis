# C15-dbg-fastapi-routes — 修复 collect_paths 丢失 include_router 子路由

| 项 | 值 |
|----|-----|
| ID | C15 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | Python |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Python ≥3.12 + **FastAPI ≥0.138**（见下"版本要求"） |

## 版本要求（务必先确认）

本题的 bug 只在 **FastAPI ≥ 0.138** 下出现。先跑：

```bash
python -c "import fastapi; print(fastapi.__version__)"
```

如果版本 `< 0.138`，`include_router` 的结果不会被封装为 `_IncludedRouter`，naive 遍历 `app.routes` 反而能拿到全部子路由，**bug 不复现、题目无解**。需要先升级：

```bash
pip install "fastapi>=0.138.0"
```

确认打印的版本 ≥ 0.138 后再开始。

## 背景

`workspace/` 里有三个文件，构成一个最小可复现案例：

- `workspace/app.py` —— 一个最小 FastAPI app：2 个顶层路由（`/`、`/health`）+ 1 个通过 `app.include_router(items_router)` 挂载的子路由器（`items_router`，prefix=`/api/items`，含 3 个子路由）。app 关闭了自动生成的 `/docs`、`/redoc`、`/openapi.json`，所以 `app.routes` 只含用户定义的路由。
- `workspace/collector.py` —— 一个 `collect_paths(app) -> set[str]` 函数，**它有 bug**：只遍历 `app.routes` 顶层，拿不到 `include_router` 引入的子路由。
- `workspace/expected_routes.json` —— 正确答案：app 的全部 4 条路由路径。

这是 Precis 代码库里一个**真实陷阱**，见主仓库 `AGENTS.md` 的"FastAPI `app.routes` 版本差异"一节：FastAPI 0.138+ 改变了 `include_router()` 的内部表示——被 include 的路由器不再把每条 `APIRoute` 平铺到 `app.routes` 列表里，而是封装为一个内部的 `_IncludedRouter` 对象，真正的子路由通过 `route.original_router.routes` 访问。任何"遍历 `app.routes` 并期望拿到每条子路由"的代码，在 0.138+ 下都会**静默漏掉** `include_router` 引入的路由。

**先读 `workspace/app.py` 和 `workspace/collector.py`**，理解：

- app 结构：2 个顶层 `@app.get` + 1 个 `APIRouter`（`items_router`，prefix `/api/items`）经 `app.include_router(...)` 挂载
- `collect_paths` 当前实现：一个简单的 `for route in app.routes: paths.add(route.path)` 循环
- bug 的本质：循环只看到顶层的 `APIRoute`（`/`、`/health`），看不到 `_IncludedRouter` 包装对象（它没有有用的 `.path`），因此 `/api/items` 和 `/api/items/{item_id}` 丢失

## 症状

当前 `collect_paths(app)` 返回：

```
{'/', '/health'}
```

而 `expected_routes.json` 期望：

```
{'/', '/health', '/api/items', '/api/items/{item_id}'}
```

注意：**程序不报错、不抛异常**——只是返回值少了几条路径。这是最阴险的那种 bug：没有任何信号告诉你少了东西。

## 任务

修复 `collect_paths`，使其返回 app 的**全部**路由路径，**包括**通过 `include_router` 引入的子路由。修复后必须满足：

```python
collect_paths(app) == set(expected_routes)
```

其中 `expected_routes` 是 `expected_routes.json` 加载出的列表。

### 规格

- **函数名**：`collect_paths`（保持不变）
- **文件**：`workspace/collector.py`
- **签名**：`collect_paths(app: FastAPI) -> set[str]`
- **行为**：
  - 顶层 `@app.get(...)` 路由 → 照常收集其 `.path`
  - 通过 `app.include_router(...)` 挂载的子路由器 → **必须递归收集**其内部所有子路由的 `.path`（在 FastAPI 0.138+ 下它们藏在 `_IncludedRouter.original_router.routes` 里）
  - 嵌套 `include_router`（子路由器里再 include 子路由器）→ 同样要能拿到（递归的自然结果）
  - 返回值是 `set[str]`，自动去重（同一个 path 不同 method 只算一条）

### 约束（务必遵守）

- 只改 `workspace/collector.py`。
- 不碰 `workspace/app.py`、`workspace/expected_routes.json`、`seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Python 标准库 + FastAPI）。

### 提示

- 在 Python REPL 里 `import` app 后打印 `app.routes`，逐个看 `type(route).__name__` 和 `getattr(route, "path", None)`。你会看到：顶层的 `APIRoute` 有正常的 `.path`（`/`、`/health`），但 include 进来的子路由器对应的那个对象类型是 `_IncludedRouter`，它的 `.path` 是 `None`。
- **关键属性**：`_IncludedRouter` 对象有个 `original_router` 属性，它持有真正的 `APIRouter`，其 `.routes` 里才是子端点。
- 修复方式是**递归**：对每条 route，先尝试取它的 `.path`；再检查它有没有 `original_router`，有就**递归**进它的 `.routes` 继续收集。
- **关键决策点**：
  - 用 `getattr(route, "original_router", None)` 而非 `route.original_router`——防御式写法，在没有 `original_router` 属性的旧版 FastAPI（<0.138）或普通 `APIRoute` 上不会 `AttributeError`，让同一份代码跨版本工作。
  - 递归是必要的：嵌套 `include_router` 会产生多层 `_IncludedRouter`。
  - 用 `getattr(route, "path", None)` 取 path（有些 route 对象没有 `.path` 属性），`None` 时不加入集合。
  - 结果用 `set`，天然去重（`@items_router.get("")` 和 `@items_router.post("")` 解析后 path 都是 `/api/items`）。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。约 6 项检查详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
