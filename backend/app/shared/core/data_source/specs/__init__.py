"""@fileoverview 数据源规格模块入口

功能概述:
- 统一导出各类数据源规格类（Excel、CSV、JSON、SQL）
- 提供延迟导入和旧版名称兼容支持
- 通过 __getattr__ 实现按需加载，避免循环导入并减少启动时间

架构设计:
- 基础类（DataSourceSpec、FileSourceSpec）直接导入
- 具体实现类（ExcelSourceSpec 等）通过 __getattr__ 延迟导入
- 旧版名称（ExcelSpec 等）映射到新版类，保持向后兼容
- __all__ 显式声明公开接口，控制 from module import * 的行为

输入示例:
    from app.shared.core.data_source.specs import DataSourceSpec, ExcelSourceSpec
    from app.shared.core.data_source.specs import create_spec  # 工厂函数

    # 旧版名称仍可正常使用（兼容支持）
    from app.shared.core.data_source.specs import ExcelSpec

输出示例:
    # create_spec 根据 type 字段自动创建对应实例
    spec = create_spec({"type": "csv", "path": "data.csv"})
    # 返回 CSVSourceSpec 实例
"""

from .base import (
    DataSourceSpec,
    create_spec,
    get_spec_class,
    register_source_spec,
)
from .file_base import FileSourceSpec


# 延迟导入具体实现，避免循环依赖
# 当用户首次访问这些名称时，才会执行实际导入
def __getattr__(name: str):
    """
    @methoddesc 延迟导入具体数据源规格类

    当代码访问 app.shared.core.data_source.specs.ExcelSourceSpec 等属性时，
    此函数会被调用，执行实际的导入操作。

    延迟导入的好处：
    1. 避免循环依赖（具体子类可能引用其他模块）
    2. 减少启动时间（只有实际使用的类才会被加载）
    3. 内存优化（未使用的类不会占用内存）

    Args:
        name: 要访问的属性名称（如 "ExcelSourceSpec"）

    Returns:
        对应的数据源规格类

    Raises:
        AttributeError: 如果名称不是已知的规格类或旧版别名
    """
    if name == "ExcelSourceSpec":
        from .excel_source import ExcelSourceSpec

        return ExcelSourceSpec
    elif name == "CSVSourceSpec":
        from .csv_source import CSVSourceSpec

        return CSVSourceSpec
    elif name == "JSONSourceSpec":
        from .json_source import JSONSourceSpec

        return JSONSourceSpec
    elif name == "SQLSourceSpec":
        from .sql_source import SQLSourceSpec

        return SQLSourceSpec
    elif name in ("ExcelSpec", "CSVSpec", "JSONSpec"):
        # 旧版名称映射到新类，保持向后兼容
        # 这样使用旧名称的代码无需修改即可继续工作
        if name == "ExcelSpec":
            from .excel_source import ExcelSourceSpec

            return ExcelSourceSpec
        elif name == "CSVSpec":
            from .csv_source import CSVSourceSpec

            return CSVSourceSpec
        elif name == "JSONSpec":
            from .json_source import JSONSourceSpec

            return JSONSourceSpec
    # 如果名称不匹配任何已知类，抛出标准 AttributeError
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


# 显式声明模块的公开接口
# 控制 from app.shared.core.data_source.specs import * 时导入哪些名称
__all__ = [
    # 基础规格
    "DataSourceSpec",  # 所有数据源的抽象基类
    "FileSourceSpec",  # 文件数据源的抽象基类
    # 旧版规格（兼容）
    "ExcelSpec",
    "CSVSpec",
    "JSONSpec",
    # 新版规格（延迟加载）
    "ExcelSourceSpec",  # Excel 数据源规格
    "CSVSourceSpec",  # CSV 数据源规格
    "JSONSourceSpec",  # JSON 数据源规格
    "SQLSourceSpec",  # SQL 数据源规格
    # 注册函数
    "register_source_spec",  # 装饰器：注册数据源规格类
    "get_spec_class",  # 根据类型获取规格类
    "create_spec",  # 工厂函数：根据字典创建规格实例
]
