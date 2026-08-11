"""
最小 FastAPI app（C15 seed）。
含 2 个顶层路由 + 1 个通过 include_router 引入的子路由器（3 个子路由）。
关闭自动生成的 /docs /redoc /openapi.json，使 app 只含用户定义的路由。
"""

from fastapi import FastAPI
from fastapi.routing import APIRouter

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


# 挂载子路由器
app.include_router(items_router)
