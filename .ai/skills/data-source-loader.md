---
name: "data-source-loader"
description: "Precis 数据源加载与预览开发规范。适用于 CSV/Excel/JSON/SQL 数据源加载器、预览服务、文件类型转换等模块。"
scope: ["backend/app/shared/core/data_source/**/*.py", "backend/app/api/routers/preview/**/*.py"]
---

# Precis 数据源加载与预览开发规范

## 适用范围

- 数据源加载器（CSV、Excel、JSON、SQL）
- 数据源规格定义（Source Spec）
- 预览服务（Header Row、Content Mode、Path Mode）
- 文件类型转换与提取器
- 路径白名单与权限校验

## 加载器架构

数据源模块采用分层架构：

```
data_source/
├── loaders/          # 加载器实现
│   ├── base.py       # 加载器基类
│   ├── csv_loader.py
│   ├── excel_loader.py
│   ├── json_loader.py
│   ├── sql_loader.py
│   ├── converter.py  # 类型转换
│   └── extractor.py  # 数据提取
├── specs/            # 数据源规格
│   ├── base.py
│   ├── csv_source.py
│   ├── excel_source.py
│   ├── json_source.py
│   └── sql_source.py
└── loader.py         # 加载器入口与注册表
```

## 加载器基类规范

所有加载器必须继承 `BaseLoader`：

```python
from abc import ABC, abstractmethod
from typing import Any
import pandas as pd

from app.shared.core.data_source.specs.base import SourceSpec

class BaseLoader(ABC):
    """数据源加载器基类
    
    功能概述:
    - 定义数据加载的标准接口
    - 支持多种数据源类型的统一访问
    
    子类必须实现:
    - load(): 加载数据为 DataFrame
    - validate(): 验证数据源配置
    """
    
    @abstractmethod
    def load(self, spec: SourceSpec) -> pd.DataFrame:
        """加载数据
        
        Args:
            spec: 数据源规格配置
            
        Returns:
            pd.DataFrame: 加载后的数据
            
        Raises:
            DataSourceError: 加载失败
        """
        pass
    
    @abstractmethod
    def validate(self, spec: SourceSpec) -> bool:
        """验证数据源配置
        
        Args:
            spec: 数据源规格配置
            
        Returns:
            bool: 配置是否有效
        """
        pass
    
    def get_preview(self, spec: SourceSpec, limit: int = 100) -> pd.DataFrame:
        """获取数据预览（可选实现）
        
        Args:
            spec: 数据源规格配置
            limit: 预览行数限制
            
        Returns:
            pd.DataFrame: 预览数据
        """
        df = self.load(spec)
        return df.head(limit)
```

## CSV 加载器实现示例

```python
import pandas as pd
from app.shared.core.data_source.loaders.base import BaseLoader
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.core.data_source.loaders.exceptions import DataSourceError

class CSVLoader(BaseLoader):
    """CSV 数据加载器
    
    功能概述:
    - 支持 UTF-8、GBK 等编码自动检测
    - 支持自定义分隔符
    - 支持空值策略配置
    """
    
    def load(self, spec: CSVSourceSpec) -> pd.DataFrame:
        """加载 CSV 文件"""
        try:
            df = pd.read_csv(
                spec.path,
                encoding=spec.encoding or "utf-8",
                delimiter=spec.delimiter or ",",
                dtype=str,  # 先按字符串读取，后续由 Schema 类型转换
                keep_default_na=False
            )
            
            # 应用空值策略
            if spec.null_strategy == "null":
                df = df.replace("", pd.NA)
            
            return df
            
        except UnicodeDecodeError as e:
            raise DataSourceError(
                f"CSV 编码错误，尝试指定其他编码: {e}",
                source_path=spec.path
            )
        except FileNotFoundError:
            raise DataSourceError(
                f"CSV 文件不存在: {spec.path}",
                source_path=spec.path
            )
    
    def validate(self, spec: CSVSourceSpec) -> bool:
        """验证 CSV 配置"""
        import os
        return os.path.exists(spec.path) and spec.path.endswith(".csv")
```

## Excel 加载器实现示例

```python
import pandas as pd
from app.shared.core.data_source.loaders.base import BaseLoader
from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec

class ExcelLoader(BaseLoader):
    """Excel 数据加载器
    
    功能概述:
    - 支持 .xlsx 和 .xls 格式
    - 支持指定 Sheet 名称或索引
    - 支持指定表头行位置
    """
    
    def load(self, spec: ExcelSourceSpec) -> pd.DataFrame:
        """加载 Excel 文件"""
        try:
            df = pd.read_excel(
                spec.path,
                sheet_name=spec.sheet or 0,
                header=spec.header_row or 0,
                dtype=str,
                engine="openpyxl"
            )
            return df
            
        except ValueError as e:
            if "No sheet named" in str(e):
                raise DataSourceError(
                    f"Sheet 不存在: {spec.sheet}",
                    source_path=spec.path
                )
            raise
```

## 数据源规格定义

```python
from pydantic import BaseModel, Field
from typing import Optional, Literal

class CSVSourceSpec(BaseModel):
    """CSV 数据源规格
    
    字段说明:
        - path: 文件路径
        - encoding: 文件编码（默认 utf-8）
        - delimiter: 分隔符（默认逗号）
        - null_strategy: 空值处理策略
    """
    
    path: str = Field(..., description="CSV 文件路径")
    encoding: Optional[str] = Field("utf-8", description="文件编码")
    delimiter: Optional[str] = Field(",", description="字段分隔符")
    null_strategy: Literal["null", "empty", "keep"] = Field(
        "null",
        description="空值处理策略"
    )
    
    class Config:
        frozen = True
```

## 加载器注册表

```python
from app.shared.core.data_source.loaders.base import BaseLoader
from app.shared.core.data_source.loaders.csv_loader import CSVLoader
from app.shared.core.data_source.loaders.excel_loader import ExcelLoader
from app.shared.core.data_source.loaders.json_loader import JSONLoader
from app.shared.core.data_source.loaders.sql_loader import SQLLoader

class LoaderRegistry:
    """加载器注册表
    
    功能概述:
    - 管理所有数据源加载器
    - 根据文件扩展名或类型自动分发
    """
    
    _loaders: dict[str, type[BaseLoader]] = {
        "csv": CSVLoader,
        "xlsx": ExcelLoader,
        "xls": ExcelLoader,
        "json": JSONLoader,
        "sql": SQLLoader,
    }
    
    @classmethod
    def get_loader(cls, file_extension: str) -> BaseLoader:
        """获取对应类型的加载器"""
        loader_class = cls._loaders.get(file_extension.lower())
        if loader_class is None:
            raise ValueError(f"不支持的数据源类型: {file_extension}")
        return loader_class()
    
    @classmethod
    def register(cls, extension: str, loader_class: type[BaseLoader]) -> None:
        """注册新加载器"""
        cls._loaders[extension.lower()] = loader_class
```

## 预览服务规范

预览 API 支持多种模式：

```python
from enum import Enum

class PreviewMode(str, Enum):
    """预览模式"""
    HEADER_ROW = "header_row"      # 仅返回表头行信息
    CONTENT = "content"            # 返回前 N 行内容
    PATH = "path"                  # 验证路径可访问性

class PreviewService:
    """预览服务
    
    功能概述:
    - 快速预览数据源内容，无需完整加载项目
    - 支持路径权限校验
    """
    
    def preview(
        self,
        path: str,
        mode: PreviewMode = PreviewMode.CONTENT,
        options: dict | None = None
    ) -> dict:
        """获取数据预览
        
        Args:
            path: 文件路径
            mode: 预览模式
            options: 额外选项（如 sheet、header_row 等）
            
        Returns:
            dict: 预览结果
        """
        # 路径白名单校验
        if not self._path_validator.is_allowed(path):
            raise PermissionError(f"路径不在白名单内: {path}")
        
        # 根据模式返回不同结果
        if mode == PreviewMode.HEADER_ROW:
            return self._preview_header(path, options)
        elif mode == PreviewMode.CONTENT:
            return self._preview_content(path, options)
        elif mode == PreviewMode.PATH:
            return self._preview_path(path)
        
        raise ValueError(f"未知的预览模式: {mode}")
```

## 路径白名单与权限

```python
from pathlib import Path

class PathWhitelist:
    """路径白名单管理
    
    功能概述:
    - 限制可访问的数据文件路径
    - 防止路径遍历攻击
    """
    
    def __init__(self, allowed_paths: list[str]):
        self._allowed_paths = [Path(p).resolve() for p in allowed_paths]
    
    def is_allowed(self, target_path: str) -> bool:
        """检查路径是否在白名单内"""
        target = Path(target_path).resolve()
        
        # 防止路径遍历
        if ".." in target.parts:
            return False
        
        # 检查是否在允许的路径前缀下
        for allowed in self._allowed_paths:
            try:
                target.relative_to(allowed)
                return True
            except ValueError:
                continue
        
        return False
```
