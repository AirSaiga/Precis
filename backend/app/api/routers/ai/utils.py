"""
@fileoverview AI 路由通用工具端点模块

功能概述:
- 提供路径展开工具，支持目录递归、通配符、相对路径解析
- 用于 AI 配置生成前批量收集数据文件路径
- 支持基于 X-Project-Config-Path 解析相对路径

架构设计:
- 纯工具函数，不依赖具体 AI 业务逻辑
- 自动过滤隐藏目录和常见非数据目录
- 支持的数据文件类型：.xlsx, .xls, .csv, .json, .jsonl

输入示例:
    POST /ai/utils/expand-paths
    ["data/", "*.csv", "./users.xlsx"]

输出示例:
    [
        "D:/project/data/users.xlsx",
        "D:/project/data/orders.csv"
    ]
"""

import os

from fastapi import Header

from .router import router

# 支持的数据文件扩展名
_DATA_EXTENSIONS = {".xlsx", ".xls", ".csv", ".json", ".jsonl"}

# 递归遍历时跳过的目录
_SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".venv", "venv", ".idea"}

_MAX_DEPTH = 5
_MAX_FILES = 1000


def _expand_directory(dir_path: str, max_depth: int = _MAX_DEPTH) -> list[str]:
    """递归展开目录，收集所有数据文件路径

    :param dir_path: 目录绝对路径
    :param max_depth: 最大递归深度
    :return: 数据文件路径列表（去重、排序）
    """
    result = []
    for root, dirs, files in os.walk(dir_path):
        depth = root[len(dir_path) :].count(os.sep)
        if depth >= max_depth:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in _SKIP_DIRS]
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in _DATA_EXTENSIONS:
                result.append(os.path.join(root, fname))
                if len(result) >= _MAX_FILES:
                    return result
    return sorted(result)


def _resolve_path(path: str, config_path: str | None) -> str:
    """解析路径：如果为相对路径，则基于项目配置目录拼接

    :param path: 原始路径（可能是相对或绝对）
    :param config_path: 项目配置目录（绝对路径），用于解析相对路径
    :return: 绝对路径
    """
    # 如果已经是绝对路径，直接返回
    if os.path.isabs(path):
        return path

    # 如果有配置路径，基于配置路径解析相对路径
    if config_path:
        base = os.path.dirname(config_path) if os.path.isfile(config_path) else config_path
        return os.path.normpath(os.path.join(base, path))

    # 兜底：返回原路径
    return path


@router.post("/utils/expand-paths", response_model=list[str])
def expand_paths(
    paths: list[str],
    x_project_config_path: str | None = Header(None, alias="X-Project-Config-Path"),
) -> list[str]:
    """展开路径列表

    支持以下展开方式：
    - 目录递归展开：自动遍历目录及其子目录，收集所有数据文件
    - 通配符展开：支持 * 和 ? 通配符
    - 相对路径解析：基于 X-Project-Config-Path 解析相对路径

    数据文件类型：.xlsx, .xls, .csv, .json, .jsonl
    """
    result = []
    seen = set()

    for raw_path in paths:
        # 1. 解析为绝对路径
        path = _resolve_path(raw_path, x_project_config_path)

        # 2. 如果是目录，递归展开
        if os.path.isdir(path):
            for file_path in _expand_directory(path):
                norm = os.path.normpath(file_path)
                if norm not in seen:
                    seen.add(norm)
                    result.append(norm)
            continue

        # 3. 如果是具体文件，直接保留
        if os.path.isfile(path):
            norm = os.path.normpath(path)
            if norm not in seen:
                seen.add(norm)
                result.append(norm)
            continue

        # 4. 通配符展开
        if "*" in raw_path or "?" in raw_path:
            import glob

            for matched in glob.glob(path):
                if os.path.isfile(matched):
                    norm = os.path.normpath(matched)
                    if norm not in seen:
                        seen.add(norm)
                        result.append(norm)
                elif os.path.isdir(matched):
                    for file_path in _expand_directory(matched):
                        norm = os.path.normpath(file_path)
                        if norm not in seen:
                            seen.add(norm)
                            result.append(norm)

    return result
