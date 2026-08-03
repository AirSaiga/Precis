"""
@fileoverview SQL 数据源加载器模块

功能概述:
- 通过 SQLAlchemy 连接数据库并执行 SELECT / WITH 查询
- 使用 pandas.read_sql 加载结果为 DataFrame
- 查询字符串安全清洗：拒绝非 SELECT/WITH、分号、危险关键字（B20）
- 支持 schema-prefixed 表名（如 public.users，B21）
- 模块级引擎缓存，按 connection_string 复用，避免连接池耗尽（B22）

架构设计:
- 继承 DataSourceLoader，通过注册表自动发现
- _get_engine() 管理 SQLAlchemy 引擎生命周期（带缓存）
- _sanitize_query() 在查询执行前进行白名单校验
- 危险关键字和语法特征通过模块级常量集中管理

输入示例:
    spec = SQLSourceSpec(
        connection_string="postgresql://user:pass@localhost/db",
        query="SELECT id, name FROM public.users WHERE active = true"
    )
    loader = SQLLoader(spec)

输出示例:
    df = loader.load()
    # 返回 pandas.DataFrame，仅包含查询结果
    # 若查询包含危险关键字或非 SELECT 语句则抛出 DataLoadError
"""

from __future__ import annotations

import logging
import re
import threading
from collections import OrderedDict
from typing import Any

import pandas as pd

from ..specs.sql_source import SQLSourceSpec
from .base import DataLoadError, DataSourceLoader
from .registry import register_loader

logger = logging.getLogger(__name__)

# 模块级引擎缓存，按 connection_string 复用，避免连接池耗尽（B22）。
# B-locksafety: 多线程安全改造——
#   1. 校验执行器会把同步加载工作 offload 到线程池（executor.py），_get_engine 会被
#      多线程并发调用，原裸 dict 无锁存在竞态（两线程同时 miss 各建一个 engine，
#      一个成孤儿永不 dispose）。
#   2. 缓存改为 OrderedDict 实现 LRU（容量 _ENGINE_CACHE_MAX），淘汰时调用
#      engine.dispose() 释放底层连接池，避免轮换凭据/多 DB 场景 FD 耗尽。
#   3. atexit 注册进程退出时全量 dispose（桌面应用生命周期短，主要靠 LRU 淘汰兜底）。
_ENGINE_CACHE_MAX = 8
_engine_cache: OrderedDict[str, Any] = OrderedDict()
_engine_cache_lock = threading.Lock()

# 危险的 SQL 关键字，用于拒绝潜在的注入攻击（B20）
_DANGEROUS_SQL_KEYWORDS = (
    "drop ",
    "delete ",
    "insert ",
    "update ",
    "create ",
    "alter ",
    "truncate ",
    "grant ",
    "revoke ",
    "exec ",
    "execute ",
    "union ",
    "--",
    "/*",
    "*/",
)


@register_loader("sql")
class SQLLoader(DataSourceLoader["SQLSourceSpec"]):
    """
    @classdesc SQL 数据库加载器

    使用 pandas 的 read_sql 方法从数据库加载数据。
    支持多种数据库后端（通过 SQLAlchemy）。
    """

    spec_class = SQLSourceSpec  # 类型由泛型指定

    def _get_engine(self, connection_string: str) -> Any:
        """
        @methoddesc 获取或创建数据库引擎（带缓存）。

        使用模块级字典 _engine_cache 按 connection_string 缓存引擎实例，
        避免重复创建连接池导致资源耗尽。

        Args:
            connection_string: SQLAlchemy 数据库连接字符串
                例如 "postgresql://user:pass@localhost/db"

        Returns:
            SQLAlchemy 引擎实例

        Raises:
            ImportError: 如果未安装 sqlalchemy 则会在 import 时抛出

        示例:
            >>> engine = loader._get_engine("sqlite:///test.db")
        """
        from sqlalchemy import create_engine

        # B-locksafety: 加锁保证"检查-创建-放入缓存"原子，避免并发 miss 各建 engine。
        # 锁只保护 dict 操作（快），create_engine 在锁外执行后会再次拿锁写入——
        # 但为简单起见这里在锁内创建（SQLLoader 加载本身是 offload 到线程的批操作，
        # create_engine 的开销相对 DB 查询可忽略，优先保证正确性）。
        with _engine_cache_lock:
            if connection_string in _engine_cache:
                # 命中：移到队尾标记为最近使用（LRU）
                _engine_cache.move_to_end(connection_string)
                return _engine_cache[connection_string]

            engine = create_engine(connection_string)

            # 放入缓存前，若已达容量上限，淘汰最久未用的 engine 并 dispose 其连接池
            while len(_engine_cache) >= _ENGINE_CACHE_MAX:
                _, evicted = _engine_cache.popitem(last=False)
                try:
                    evicted.dispose()
                except Exception as e:  # noqa: BLE001
                    logger.warning("淘汰 SQL engine 时 dispose 失败（可能已关闭）: %s", e)

            _engine_cache[connection_string] = engine
            return engine

    def _sanitize_query(self, query: str) -> str:
        """
        @methoddesc 检查查询字符串是否包含危险的 SQL 注入特征（B20）。

        安全策略（白名单模式）：
        1. 只允许以 SELECT 或 WITH 开头的查询
        2. 拒绝包含分号（;）的查询，防止多语句执行
        3. 拒绝危险关键字（如 DROP、DELETE、INSERT、UPDATE 等）

        如果查询不通过安全检查，会抛出 DataLoadError。

        Args:
            query: 用户提供的原始 SQL 查询字符串

        Returns:
            清洗后的查询字符串（去除首尾空白）

        Raises:
            DataLoadError: 查询包含危险特征或不以 SELECT/WITH 开头时抛出

        示例:
            >>> safe_query = loader._sanitize_query("SELECT * FROM users")
            >>> # 返回: "SELECT * FROM users"
            >>> loader._sanitize_query("DROP TABLE users")
            >>> # 抛出 DataLoadError
        """
        stripped = query.strip()
        lower = stripped.lower()

        # 只允许 SELECT 和 WITH 开头的查询
        if not lower.startswith(("select", "with")):
            raise DataLoadError(
                f"SQL 查询必须以 SELECT 或 WITH 开头，当前查询: {stripped[:80]}...",
                self.spec,
            )

        # 拒绝分号（多语句特征）
        if ";" in stripped:
            raise DataLoadError(
                "SQL 查询不允许包含分号（;），请使用单条 SELECT 语句",
                self.spec,
            )

        # 拒绝危险关键字
        for keyword in _DANGEROUS_SQL_KEYWORDS:
            if keyword in lower:
                raise DataLoadError(
                    f"SQL 查询包含危险关键字 '{keyword.strip()}'，已被拒绝",
                    self.spec,
                )

        return stripped

    def load(self) -> pd.DataFrame:
        """
        @methoddesc 从 SQL 数据库加载数据

        Returns:
            DataFrame

        Raises:
            DataLoadError: 加载失败时抛出
            ImportError: 缺少必要的驱动时抛出
        """
        try:
            from sqlalchemy import text
        except ImportError:
            raise DataLoadError("加载 SQL 数据源需要安装 sqlalchemy: pip install sqlalchemy", self.spec)

        try:
            # 复用已缓存的引擎（B22）
            engine = self._get_engine(self.spec.connection_string)

            # 构建查询
            query_input = self.spec.table_or_query.strip()
            if query_input.lower().startswith(("select", "with")):
                # 用户提供了查询语句，先进行安全检查（B20）
                safe_query = self._sanitize_query(query_input)
                with engine.connect() as conn:
                    df = pd.read_sql(text(safe_query), conn, params=self.spec.params)
            else:
                # 用户提供了表名，使用 SQLAlchemy 的 Table + select 安全构建查询
                # Table 名称会被自动引用，防止 SQL 注入
                from sqlalchemy import MetaData, Table, select

                # 表名中禁止出现可疑字符
                if not re.match(r"^[\w.]+$", query_input):
                    raise DataLoadError(f"表名包含非法字符: {query_input}", self.spec)

                # 支持 schema.table 格式（如 public.users）（B21）
                if "." in query_input:
                    schema_name, table_name = query_input.rsplit(".", 1)
                    table = Table(table_name, MetaData(), schema=schema_name)
                else:
                    table = Table(query_input, MetaData())
                with engine.connect() as conn:
                    df = pd.read_sql(select(table), conn)

            return df

        except Exception as e:
            raise DataLoadError(f"SQL 加载失败: {e}", self.spec, e)

    def validate(self) -> list[str]:
        """
        @methoddesc 验证 SQL 数据源配置。

        检查项：
        - 连接字符串是否为空
        - 表名或查询语句是否为空
        - SQLAlchemy 库是否已安装

        Returns:
            错误信息列表，空列表表示验证通过

        示例:
            >>> errors = loader.validate()
            >>> if errors:
            ...     print("验证失败:", errors)
        """
        errors = []

        # 检查连接字符串
        if not self.spec.connection_string:
            errors.append("连接字符串不能为空")

        # 检查表名/查询
        if not self.spec.table_or_query:
            errors.append("表名或查询语句不能为空")

        # 检查 SQLAlchemy 是否可用
        import importlib.util

        if importlib.util.find_spec("sqlalchemy") is None:
            errors.append("缺少 SQLAlchemy: pip install sqlalchemy")

        return errors


def _dispose_all_engines() -> None:
    """进程退出时全量释放缓存的 SQL engine 连接池（B-locksafety）。"""
    with _engine_cache_lock:
        while _engine_cache:
            _, engine = _engine_cache.popitem(last=False)
            try:
                engine.dispose()
            except Exception as e:  # noqa: BLE001
                logger.warning("进程退出 dispose SQL engine 失败: %s", e)


import atexit

atexit.register(_dispose_all_engines)
