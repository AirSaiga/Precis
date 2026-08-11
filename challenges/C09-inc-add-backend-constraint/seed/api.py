"""API 层：校验路由（C09 seed）。

通过 HTTP 暴露 service 层的校验能力。
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from service import validate_column

app = FastAPI()


class ValidateRequest(BaseModel):
    values: list[Any]
    constraint_type: str
    constraint_params: dict[str, Any]


class ValidateResponse(BaseModel):
    passed: bool
    violations: list[int]
    constraint_type: str | None = None
    error: str | None = None


@app.post("/validate", response_model=ValidateResponse)
def validate_endpoint(req: ValidateRequest) -> ValidateResponse:
    result = validate_column(req.values, req.constraint_type, req.constraint_params)
    return ValidateResponse(**result)


# 约束类型清单端点（列出所有可用约束类型）
@app.get("/constraint-types")
def list_constraint_types() -> dict[str, list[str]]:
    """返回所有已注册的约束类型名。"""
    from domain import CONSTRAINT_FACTORIES

    return {"types": sorted(CONSTRAINT_FACTORIES.keys())}
