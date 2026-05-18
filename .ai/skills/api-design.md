---
name: "api-design"
description: "Precis RESTful API 设计规范。适用于 backend/app/api/ 下的路由定义、请求/响应模型、错误处理、OpenAPI 文档等。"
scope: ["backend/app/api/**/*.py"]
---

# Precis RESTful API 设计规范

## 适用范围

- API 路由定义（routers/）
- 请求/响应 Pydantic 模型（models/）
- 错误响应格式
- OpenAPI/Swagger 文档
- 分页与过滤规范

## 路由设计原则

### URL 结构

```
/api/v2/
├── /projects              # 项目管理
│   ├── GET    /           # 列表（支持分页、过滤）
│   ├── POST   /           # 创建
│   ├── GET    /{id}       # 详情
│   ├── PUT    /{id}       # 全量更新
│   ├── DELETE /{id}       # 删除
│   └── POST   /{id}/validate  # 项目校验
├── /schemas               # Schema 管理
├── /constraints           # 约束管理
├── /regex                 # 正则节点管理
├── /ai                    # AI 服务
│   ├── POST /chat
│   ├── POST /v2/config/generate
│   └── GET  /providers
└── /preview               # 数据预览
```

### HTTP 方法语义

| 方法 | 语义 | 幂等性 | 响应码 |
|------|------|--------|--------|
| GET | 获取资源 | 是 | 200 / 404 |
| POST | 创建资源 / 执行操作 | 否 | 201 / 200 / 409 |
| PUT | 全量更新 | 是 | 200 / 404 |
| PATCH | 部分更新 | 否 | 200 / 404 |
| DELETE | 删除资源 | 是 | 204 / 404 |

## 统一响应格式

### 成功响应

```json
{
  "success": true,
  "data": { ... },
  "message": null
}
```

### 列表响应（带分页）

```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20
  },
  "message": null
}
```

### 错误响应

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数校验失败",
    "details": [
      { "field": "email", "message": "无效的邮箱格式" }
    ]
  }
}
```

## Pydantic 响应模型

```python
from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Optional, List

T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    """统一 API 响应包装器"""
    success: bool = Field(..., description="是否成功")
    data: Optional[T] = Field(None, description="响应数据")
    message: Optional[str] = Field(None, description="提示信息")

class ApiErrorDetail(BaseModel):
    """错误详情"""
    field: Optional[str] = Field(None, description="出错字段")
    message: str = Field(..., description="错误描述")

class ApiErrorResponse(BaseModel):
    """错误响应"""
    code: str = Field(..., description="错误码")
    message: str = Field(..., description="错误信息")
    details: List[ApiErrorDetail] = Field(default_factory=list, description="详细错误")

class PaginatedData(BaseModel, Generic[T]):
    """分页数据"""
    items: List[T] = Field(..., description="数据列表")
    total: int = Field(..., ge=0, description="总记录数")
    page: int = Field(..., ge=1, description="当前页码")
    pageSize: int = Field(..., ge=1, le=1000, description="每页大小")

# 使用示例
class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None

class ProjectListResponse(ApiResponse[PaginatedData[ProjectResponse]]):
    pass
```

## 路由实现规范

```python
from fastapi import APIRouter, HTTPException, status, Query, Depends
from typing import List, Optional

from app.api.models.project import ProjectResponse, ProjectCreateRequest
from app.api.dependencies import get_project_service

router = APIRouter(prefix="/projects", tags=["projects"])

@router.get(
    "",
    response_model=ApiResponse[PaginatedData[ProjectResponse]],
    summary="获取项目列表",
    description="获取所有项目，支持分页和搜索",
    responses={
        200: {"description": "成功返回项目列表"},
        401: {"description": "未授权"}
    }
)
async def list_projects(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页大小"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    service = Depends(get_project_service)
) -> ApiResponse[PaginatedData[ProjectResponse]]:
    """获取项目列表
    
    支持分页和关键词搜索，返回项目基本信息。
    """
    result = await service.list_projects(
        page=page,
        page_size=page_size,
        search=search
    )
    
    return ApiResponse(
        success=True,
        data=PaginatedData(
            items=[ProjectResponse(**item) for item in result.items],
            total=result.total,
            page=page,
            pageSize=page_size
        )
    )

@router.post(
    "",
    response_model=ApiResponse[ProjectResponse],
    status_code=status.HTTP_201_CREATED,
    summary="创建项目",
    description="创建新的数据校验项目"
)
async def create_project(
    request: ProjectCreateRequest,
    service = Depends(get_project_service)
) -> ApiResponse[ProjectResponse]:
    """创建项目
    
    项目 ID 必须唯一，建议使用小写+下划线格式。
    """
    try:
        project = await service.create_project(request)
        return ApiResponse(
            success=True,
            data=ProjectResponse(**project.dict()),
            message="项目创建成功"
        )
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ApiErrorResponse(
                code="PROJECT_EXISTS",
                message=str(e)
            ).dict()
        )

@router.get(
    "/{project_id}",
    response_model=ApiResponse[ProjectResponse],
    summary="获取项目详情"
)
async def get_project(
    project_id: str,
    service = Depends(get_project_service)
) -> ApiResponse[ProjectResponse]:
    """获取项目详情"""
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ApiErrorResponse(
                code="PROJECT_NOT_FOUND",
                message=f"项目 '{project_id}' 不存在"
            ).dict()
        )
    
    return ApiResponse(success=True, data=ProjectResponse(**project.dict()))

@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除项目"
)
async def delete_project(
    project_id: str,
    service = Depends(get_project_service)
) -> None:
    """删除项目及其所有配置"""
    success = await service.delete_project(project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ApiErrorResponse(
                code="PROJECT_NOT_FOUND",
                message=f"项目 '{project_id}' 不存在"
            ).dict()
        )
```

## 错误码规范

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `VALIDATION_ERROR` | 422 | 请求参数校验失败 |
| `PROJECT_NOT_FOUND` | 404 | 项目不存在 |
| `PROJECT_EXISTS` | 409 | 项目 ID 已存在 |
| `SCHEMA_NOT_FOUND` | 404 | Schema 不存在 |
| `CONSTRAINT_VIOLATION` | 400 | 约束校验失败 |
| `AI_PROVIDER_ERROR` | 502 | AI Provider 调用失败 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

## 分页规范

### 请求参数

```python
from fastapi import Query

async def list_items(
    page: int = Query(1, ge=1, description="页码（从 1 开始）"),
    page_size: int = Query(20, ge=1, le=100, description="每页大小"),
    sort_by: Optional[str] = Query(None, description="排序字段"),
    sort_order: SortOrder = Query(SortOrder.DESC, description="排序方向")
):
    pass
```

### 响应结构

```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

## OpenAPI 文档优化

```python
from fastapi import FastAPI

app = FastAPI(
    title="Precis API",
    description="数据校验与配置管理 API",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    contact={
        "name": "Precis Team",
        "url": "https://github.com/precis-community"
    }
)

# 注册路由
app.include_router(project_router, prefix="/api/v2")
app.include_router(ai_router, prefix="/api/v2")
```

## 请求 ID 与日志追踪

每个请求应携带唯一的 `X-Request-ID`，用于日志追踪和问题排查：

```python
from fastapi import Request
import uuid

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response
```
