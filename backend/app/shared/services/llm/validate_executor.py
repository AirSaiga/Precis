"""
@fileoverview 项目数据校验执行模块

功能概述:
- 调用后端校验引擎执行数据校验
- 支持全量校验和指定表的过滤校验
- 格式化校验结果和错误信息

输入示例:
    result = execute_validate_project("/workspace", table_filter="users")

输出示例:
    {
        "success": True,
        "message": "发现 3 个数据错误:\n  - users.email: ...",
        "details": {"error_count": 3, "errors": [...], "duration_ms": 150}
    }
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def execute_validate_project(workspace_path: str, table_filter: str | list[str] | None = None) -> dict[str, Any]:
    """
    @methoddesc 执行项目数据校验

    调用后端校验引擎，根据项目清单和数据目录执行全量或指定表的数据校验。
    格式化校验结果，最多显示前 10 个错误。

    参数:
        workspace_path: 项目工作区路径（包含 project.precis.yaml）
        table_filter: 可选的表名过滤，支持单个表名字符串或表名列表

    返回:
        校验结果字典，包含 success、message、details
        - success=True 表示校验流程执行成功（即使发现数据错误）
        - details 中包含 error_count、errors 列表等

    示例:
        >>> result = execute_validate_project("/workspace", table_filter="users")
        >>> result["success"]
        True
    """
    manifest_path = os.path.join(workspace_path, "project.precis.yaml")
    data_dir = workspace_path

    if not os.path.exists(manifest_path):
        return {"success": False, "message": f"项目配置文件不存在: {manifest_path}", "details": None}

    try:
        from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

        # 使用默认配置执行校验
        options = ValidationOptions(
            timeout_seconds=30,
            allow_unsafe_eval=False,
            table_filter=table_filter,
        )

        executor = ValidationExecutor(manifest_path)
        result = executor.execute(data_dir, options)

        errors = result.get("errors", [])
        loading_errors = result.get("loading_errors", [])
        duration_ms = result.get("duration_ms", 0)

        # 格式化加载警告（loading_errors 为非致命的加载阶段问题）
        loading_section = ""
        if loading_errors:
            loading_details = []
            for le in loading_errors[:10]:
                le_type = le.get("error_type") or le.get("type") or "未知错误"
                le_table = le.get("table", "")
                # message 可能为空（inspect 级错误），优先读 title，与 CLI validate.py 处理一致
                le_message = le.get("title") or le.get("message") or ""
                prefix = f"{le_table}." if le_table else ""
                loading_details.append(f"  - [{le_type}] {prefix}{le_message}")
            if len(loading_errors) > 10:
                loading_details.append(f"  ... 还有 {len(loading_errors) - 10} 个加载警告")
            loading_section = "加载警告:\n" + "\n".join(loading_details)

        if errors:
            # 格式化错误信息，最多显示前 10 个
            error_details = []
            for err in errors[:10]:
                # 兼容 error_type（真实数据）和 type（遗留 mock）
                err_type = err.get("error_type") or err.get("type") or "未知错误"
                table = err.get("table", "未知表")
                column = err.get("column", "")
                message = err.get("message", "")

                if column:
                    error_details.append(f"  - {table}.{column}: {message} ({err_type})")
                else:
                    error_details.append(f"  - {table}: {message} ({err_type})")

            if len(errors) > 10:
                error_details.append(f"  ... 还有 {len(errors) - 10} 个错误")

            full_message = f"发现 {len(errors)} 个数据错误:\n" + "\n".join(error_details)
            if loading_section:
                full_message += "\n" + loading_section

            return {
                "success": True,  # 校验执行成功，只是发现数据错误
                "message": full_message,
                "details": {
                    "error_count": len(errors),
                    "duration_ms": duration_ms,
                    "errors": errors[:20],  # 返回前20个错误详情
                    "has_errors": True,
                    "loading_errors": loading_errors[:20],
                    "has_loading_errors": len(loading_errors) > 0,
                    "table_filter": table_filter,
                },
            }
        else:
            if loading_section:
                # 无校验错误但存在加载警告
                full_message = f"数据校验通过，但存在 {len(loading_errors)} 个加载警告:\n" + "\n".join(
                    loading_section.split("\n")[1:]  # 去掉 "加载警告:" 标题行，改用计数前缀
                )
            else:
                full_message = f"数据校验通过（耗时 {duration_ms}ms）"

            return {
                "success": True,
                "message": full_message,
                "details": {
                    "error_count": 0,
                    "duration_ms": duration_ms,
                    "errors": [],
                    "has_errors": False,
                    "loading_errors": loading_errors[:20],
                    "has_loading_errors": len(loading_errors) > 0,
                    "table_filter": table_filter,
                },
            }

    except Exception as e:
        logger.error(f"执行校验失败: {e}", exc_info=True)
        return {"success": False, "message": f"校验执行失败: {str(e)}", "details": None}
