"""
最小 FastAPI app（C15 seed）。
含 2 个顶层路由 + 1 个 include_router 引入的子路由器（3 个子路由）。

在 FastAPI 0.138+ 下，include_router 的结果被封装为 _IncludedRouter，
naive 遍历 app.routes 拿不到子路由。
"""

from fastapi import FastAPI
from fastapi.routing import APIRouter

# 关闭自动生成的 /docs /redoc /openapi.json 路由，
# 使 app 只含用户定义的路由（便于对 collect_paths 做精确等值校验）。
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


# 顶层路由
@app.get("/")
def root():
    return {"ok": True}


@app.get("/health")
def health():
    return {"status": "ok"}


# 子路由器（将通过 include_router 挂载）
items_router = APIRouter(prefix="/api/items", tags=["items"])


@items_router.get("")
def list_items():
    return []


@items_router.post("")
def create_item():
    return {"created": True}


@items_router.get("/{item_id}")
def get_item(item_id: int):
    return {"id": item_id}


# 挂载子路由器 —— 这一步在 0.138+ 会产生 _IncludedRouter
app.include_router(items_router)
