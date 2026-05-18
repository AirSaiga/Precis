"""
@fileoverview SQL 数据源规格模块

功能概述:
- 定义 SQL 数据库连接的数据源规格类
- 支持连接字符串、表名或查询语句配置
- 提供查询参数和批量读取大小配置
- 连接信息展示时自动隐藏密码等敏感信息

架构设计:
- 直接继承自 DataSourceSpec（非文件类数据源）
- 通过 @register_source_spec 装饰器自动注册到规格注册表
- 与 SQLLoader 配对使用，实现数据库数据加载
- 连接键由 connection_string 和 table_or_query 组合生成

输入示例:
    spec = SQLSourceSpec(
        connection_string="postgresql://user:pass@localhost/db",
        table_or_query="SELECT * FROM users WHERE age > 18",
        params={"min_age": 18},
        batch_size=1000
    )

输出示例:
    key = spec.get_connection_key()
    # "postgresql://user:pass@localhost/db:SELECT * FROM users WHERE age > 18"
    display = spec.to_display_dict()
    # {"connection": "postgresql://user:***@localhost/db", "table_or_query": "...", ...}
"""

from __future__ import annotations

from typing import Any, ClassVar

from pydantic import Field

from .base import DataSourceSpec, register_source_spec


@register_source_spec
class SQLSourceSpec(DataSourceSpec):
    """
    @classdesc SQL 数据库数据源规格

    用于从 SQL 数据库（PostgreSQL、MySQL、SQLite 等）加载数据。
    支持通过完整查询语句或表名指定要读取的数据。

    属性:
        connection_string: 数据库连接字符串（包含协议、用户名、密码、主机、数据库名）
        table_or_query: 表名或 SQL 查询语句
        params: 查询参数（用于参数化查询，防止 SQL 注入）
        batch_size: 批量读取大小（每次从数据库读取的行数）

    示例:
        ```yaml
        source:
          type: sql
          connection_string: "postgresql://user:pass@localhost/mydb"
          table_or_query: "SELECT * FROM users WHERE status = %(status)s"
          params:
            status: "active"
        ```
    """

    source_type: ClassVar[str] = "sql"
    type: str = "sql"

    # 连接配置
    connection_string: str = Field(..., description="数据库连接字符串（如 postgresql://user:pass@localhost/db）")
    table_or_query: str = Field(..., description="表名（如 'users'）或 SQL 查询语句（如 'SELECT * FROM users'）")
    params: dict[str, Any] | None = Field(None, description="查询参数（用于参数化查询，如 {'min_age': 18}）")

    # 性能配置
    batch_size: int = Field(1000, ge=1, description="批量读取大小（每次从数据库读取的行数，用于控制内存使用）")

    def get_connection_key(self) -> str:
        """
        @methoddesc 获取连接标识符

        SQL 数据源的连接键由连接字符串和查询语句组合而成，
        确保同一个数据库的不同查询被视为不同的数据源。

        Returns:
            "连接字符串:查询语句" 格式的字符串
        """
        return f"{self.connection_string}:{self.table_or_query}"

    def get_loader_class(self):
        """
        @methoddesc 获取 SQL 数据加载器类

        延迟导入避免循环依赖。
        SQLLoader 负责使用 SQLAlchemy 建立连接并执行查询。

        Returns:
            SQLLoader 类
        """
        # 延迟导入避免循环依赖（SQLLoader 可能会引用 SQLSourceSpec）
        from ..loaders import SQLLoader

        return SQLLoader

    def to_display_dict(self) -> dict[str, Any]:
        """
        @methoddesc 转换为显示用的字典（隐藏敏感信息）

        在展示连接信息时，自动将密码替换为 ***，避免敏感信息泄露。
        解析逻辑：将 connection_string 按 @ 分割，再提取用户名部分，将密码替换。

        Returns:
            包含脱敏后的 connection、table_or_query 等字段的字典
        """
        base = super().to_display_dict()  # 获取基类的通用字段

        # 隐藏连接字符串中的密码
        conn = self.connection_string
        if "@" in conn:
            # 尝试隐藏密码部分：connection_string 格式通常为 "协议://用户名:密码@主机/数据库"
            parts = conn.split("@")
            if len(parts) == 2:
                user_pass = parts[0]  # "协议://用户名:密码" 部分
                if ":" in user_pass and "://" in user_pass:
                    # 分割出协议和凭据："postgresql://" 和 "user:pass"
                    protocol, creds = user_pass.rsplit("://", 1)
                    if ":" in creds:
                        # 提取用户名，将密码替换为 ***
                        user = creds.split(":")[0]
                        conn = f"{protocol}://{user}:***@{parts[1]}"

        return {
            **base,
            "connection": conn,  # 脱敏后的连接字符串
            "table_or_query": self.table_or_query,
        }
