# C15 — 修复 collect_paths 丢失部分路由

| 项 | 值 |
|------|-----|
| ID | C15 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | Python |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Python ≥3.12 + FastAPI ≥0.138 |

## 版本要求

本题依赖 FastAPI ≥ 0.138 的行为。先确认版本：

```bash
python -c "import fastapi; print(fastapi.__version__)"
```

低于 0.138 请先升级（`pip install "fastapi>=0.138.0"`），否则题目不复现。

## 背景

`workspace/` 里三个文件构成最小可复现案例：

- `workspace/app.py` —— 一个最小 FastAPI app：2 个顶层路由（`/`、`/health`）+ 1 个通过 `app.include_router(items_router)` 挂载的子路由器（prefix `/api/items`，含 3 个子路由）。app 关闭了自动生成的 `/docs`、`/redoc`、`/openapi.json`，所以 `app.routes` 只含用户定义的路由。
- `workspace/collector.py` —— `collect_paths(app) -> set[str]`，收集 app 的路由路径。
- `workspace/expected_routes.json` —— 正确答案：app 的全部 4 条路由路径。

## 症状

`collect_paths(app)` 返回的路径比预期少 —— 通过 `include_router` 挂载的子路由没有出现在结果里。程序不报错、不抛异常，只是返回值少了几条路径，没有任何信号告诉你少了什么。

期望结果（`expected_routes.json`）：

```
{'/', '/health', '/api/items', '/api/items/{item_id}'}
```

修复 `collect_paths`，使其返回 app 的**全部**路由路径，满足：

```python
collect_paths(app) == set(expected_routes)
```

## 规格

- **函数名**：`collect_paths`（保持不变）
- **文件**：`workspace/collector.py`
- **签名**：`collect_paths(app: FastAPI) -> set[str]`
- **行为**：返回 app 的全部路由路径（顶层 + `include_router` 引入的子路由，含嵌套 `include_router`），`set` 自动去重。

## 约束

- 只改 `workspace/collector.py`。
- 不碰 `workspace/app.py`、`workspace/expected_routes.json`、`seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Python 标准库 + FastAPI）。

## 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。9 项检查（含两层嵌套 include_router 的递归收集）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
