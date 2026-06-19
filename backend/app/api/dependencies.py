"""
@fileoverview API 依赖注入模块

功能概述:
- 提供 FastAPI 依赖注入函数
- 从 HTTP Header 获取并验证项目配置路径
- 提供 ProjectStore 数据容器在请求生命周期内传递项目路径

架构设计:
- 使用 FastAPI 的 Depends 机制实现依赖注入
- 通过 X-Project-Config-Path Header 接收项目路径，支持多项目
- 路径验证包括绝对路径检查和目录存在性检查
- ProjectStore 可轻松 mock，便于单元测试

输入示例:
    Header: X-Project-Config-Path: D:/project/.precis

输出示例:
    ProjectStore(project_path="D:/project/.precis")
"""

# backend/app/api/dependencies.py
import os

from fastapi import Depends, Header, HTTPException


class ProjectStore:
    """
    项目存储类。

    这是一个简单的数据容器类，用于在 FastAPI 依赖注入链中传递项目路径信息。
    通过将项目路径封装为对象，可以在类型提示中明确表达依赖关系。

    设计目的：
    - 提供类型安全的项目路径传递方式
    - 方便在路由处理器中获取项目根目录
    - 支持依赖注入的单元测试（可轻松 mock）

    属性：
        project_path: 项目配置目录的绝对路径
    """

    def __init__(self, project_path: str):
        """
        初始化项目存储对象。

        :param project_path: 项目配置目录的绝对路径
        """
        self.project_path = project_path


async def get_project_config_path(
    x_project_config_path: str = Header(..., description="项目配置文件目录的绝对路径"),
) -> str:
    """
    获取并验证项目配置路径的依赖函数。

    该函数是 FastAPI 的依赖项，用于从 HTTP Header 中提取项目配置路径，
    并进行合法性验证：
    1. 检查路径是否为绝对路径
    2. 检查路径对应的目录是否存在

    处理流程：
    1. 从 X-Project-Config-Path Header 获取路径
    2. 验证路径是否为绝对路径
    3. 验证路径对应的目录是否存在
    4. 返回验证后的绝对路径

    :param x_project_config_path: HTTP Header 中的项目配置路径
    :return: 验证通过的项目配置绝对路径
    :raises HTTPException: 路径验证失败时返回 400 或 404 错误

    Header 示例：
        X-Project-Config-Path: /path/to/project/config
    """
    # 步骤1：先校验原始输入是否为绝对路径
    # 在 Windows 下，os.path.abspath 会把相对路径（如 "../project"）解析成绝对路径，
    # 导致后续 isabs 检查无法拒绝相对路径。因此必须在规范化之前先做判断。
    if not os.path.isabs(x_project_config_path):
        raise HTTPException(status_code=400, detail="X-Project-Config-Path header 必须是一个绝对路径。")

    # 路径标准化并解析为绝对路径，防御 Path Traversal
    # 【安全策略】使用 os.path.normpath 消除路径中的 .. 等相对路径成分
    # 再使用 os.path.abspath 转换为绝对路径，防止路径穿越攻击
    normalized_path = os.path.abspath(os.path.normpath(x_project_config_path))

    # 步骤2：验证路径对应的目录是否存在
    # 确保项目配置目录已经创建，避免后续文件操作失败
    # 【错误码选择】404 表示资源不存在，400 表示请求参数错误
    if not os.path.isdir(normalized_path):
        raise HTTPException(status_code=404, detail=f"提供的项目配置路径不存在: {normalized_path}")

    # 步骤3：验证通过，返回绝对路径
    # 【返回值】返回标准化后的绝对路径，供后续文件操作使用
    return normalized_path


async def get_project_store(project_path: str = Depends(get_project_config_path)) -> ProjectStore:
    """
    创建项目存储对象的依赖函数。

    该函数是 FastAPI 的依赖项，负责：
    1. 调用 get_project_config_path 获取验证后的项目路径
    2. 创建 ProjectStore 实例并返回

    这种分层设计的好处：
    - 职责分离：路径验证和对象创建分别处理
    - 可复用性：get_project_config_path 可以被其他依赖函数复用
    - 可测试性：每个函数都可以独立进行单元测试

    :param project_path: 已验证的项目配置路径（由 get_project_config_path 注入）
    :return: 包含项目路径的 ProjectStore 实例

    使用示例：
        @app.get("/projects/{project_id}/schemas")
        async def get_schemas(project: ProjectStore = Depends(get_project_store)):
            # 可以直接使用 project.project_path 访问项目路径
            schemas = load_schemas(project.project_path)
            return schemas
    """
    # 创建并返回项目存储对象，将路径封装为对象形式
    return ProjectStore(project_path=project_path)
