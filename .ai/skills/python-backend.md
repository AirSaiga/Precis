---
name: "python-backend"
description: "Precis Python 后端开发规范。适用于 backend/ 目录下 FastAPI、Pydantic、校验引擎、数据源等模块的开发。"
scope: ["backend/**/*.py"]
---

# Precis Python 后端开发规范

## 适用范围

- FastAPI API 路由与模型定义
- Pydantic 配置与数据验证模型
- 依赖注入与服务层
- 数据校验引擎（validators、constraints）
- 数据源加载器（CSV/Excel/JSON/SQL）
- AI 服务与配置生成

## 文件头规范

每个 Python 文件必须包含详细的文件头文档：

```python
"""
@fileoverview 模块名称和功能概述

功能概述:
- 功能点 1
- 功能点 2

架构设计:
- 设计模式说明
- 模块间关系

输入示例:
    示例代码或数据

输出示例:
    示例代码或数据
"""
```

## 导入规范

```python
# 1. 标准库导入
from __future__ import annotations
import sys
import os
from typing import Dict, List, Optional

# 2. 第三方库导入
from pydantic import BaseModel, Field, field_validator, model_validator
from fastapi import FastAPI, APIRouter, HTTPException, status, Depends

# 3. 项目内部导入
from app.shared.core.project.manifest.types_parts.constants import V2_VERSION
from app.shared.core.project.manifest.types_parts.info import ProjectInfo
```

## 类型注解规范

- 必须使用类型注解
- 使用 `from __future__ import annotations` 支持延迟注解
- Pydantic 模型用于配置和数据验证

```python
class ProjectManifest(BaseModel):
    """项目清单主类型
    
    字段说明:
        - version: 配置版本号，当前固定为 2
        - project: 项目基本信息
    
    数据校验:
        - ID 唯一性: 自动检测重复 ID
    """
    version: int = Field(V2_VERSION, description="配置版本号（固定为 2）")
    project: ProjectInfo
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    schemas: List[SchemaRef] = Field(default_factory=list)
```

## 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 类名 | PascalCase | `ProjectManifest`, `ValidationSettings` |
| 函数/方法 | snake_case | `validate_config()`, `load_manifest()` |
| 常量 | UPPER_SNAKE_CASE | `V2_VERSION`, `DEFAULT_ENCODING` |
| 私有方法/变量 | 前缀下划线 | `_validate_unique_ids`, `_config_path` |
| 模块名 | snake_case | `manifest_loader.py`, `types_parts/` |

## FastAPI 路由规范

```python
from fastapi import APIRouter, HTTPException, status, Depends

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    responses={404: {"description": "Not found"}},
)

@router.get(
    "",
    response_model=ProjectListResponse,
    summary="获取项目列表",
    description="获取所有项目的列表，支持分页"
)
async def list_projects(
    skip: int = 0,
    limit: int = 100,
    service: ProjectService = Depends(get_project_service)
) -> ProjectListResponse:
    """获取项目列表
    
    Args:
        skip: 跳过数量（分页）
        limit: 返回数量限制
        service: 项目服务（依赖注入）
        
    Returns:
        ProjectListResponse: 项目列表响应
    """
    ...
```

## 依赖注入规范

```python
from typing import Generator, Optional

_project_service: Optional[ProjectService] = None

def get_project_service() -> Generator[ProjectService, None, None]:
    """获取项目服务"""
    global _project_service
    if _project_service is None:
        _project_service = ProjectService()
    try:
        yield _project_service
    finally:
        pass
```

## 错误处理规范

自定义错误应继承 `APIError`（内部封装了 HTTPException）：

```python
class APIError(HTTPException):
    """API 错误基类"""
    def __init__(self, status_code: int, detail: str, error_code: Optional[str] = None):
        super().__init__(status_code=status_code, detail=detail)
        self.error_code = error_code

class NotFoundError(APIError):
    """资源不存在错误"""
    def __init__(self, resource: str, identifier: str):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{resource} '{identifier}' 不存在",
            error_code="NOT_FOUND"
        )
```

## 注释规范

- 使用中文注释
- 复杂逻辑必须添加行内注释
- 使用 `# ========` 分隔大段代码

```python
# ============================================================================
# 路径配置（必须最先执行！）
# ============================================================================

# 添加项目根目录到 Python 导入路径
# __file__ = D:\Project\backend\app\api\main.py
# main.py → api → app → backend → Project
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
```
