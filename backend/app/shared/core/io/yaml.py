"""@fileoverview YAML 文件读写工具模块

功能概述:
- 提供 YAML 配置文件的统一读写接口（read_yaml / write_yaml / write_yaml_atomic）
- 使用 safe_load/safe_dump 防止代码注入，自动处理 UTF-8 编码
- write_yaml_atomic 提供原子写入（临时文件 + os.replace），确保崩溃安全
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path
from typing import Any, cast

import yaml  # type: ignore[import-untyped]


def read_yaml(path: Path) -> dict[str, Any]:
    """
    @methoddesc 读取 YAML 文件并解析为字典。

    ============================================================================
    配置文件示例 (本函数处理的配置文件长这样)
    ============================================================================
    本函数可以处理以下格式的 YAML 配置文件：

    ```yaml
    # ============================================================
    # Precis 项目清单文件示例
    # ============================================================

    # 项目配置版本号
    version: 2

    # 项目基本信息
    project:
      id: my-data-project
      name: My Data Project

    # 项目设置
    settings:
      validation:
        auto_validate: true
        strict_mode: false
        error_handling: continue
        timeout_seconds: 30
      file_processing:
        default_encoding: utf-8
        csv_delimiter: ","
      script_security:
        allow_eval: false
        sandbox_mode: true

    # Schema 文件索引
    schemas:
      - id: users
        path: schemas/users.schema.yaml

    # Constraint 文件索引
    constraints:
      - id: email_notnull
        path: constraints/email_notnull.constraint.yaml

    # Regex 节点文件索引
    regex_nodes:
      - id: phone_validation
        path: regex_nodes/phone_validation.regex.yaml

    # Patterns 目录
    patterns_dir: patterns
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: CLI 启动时读取项目配置文件
      用户在终端执行 `precis validate --project ./my-project` 命令时，
      系统需要读取项目根目录下的 project.precis.yaml 文件来获取
      项目的所有配置引用（schemas、constraints、regex_nodes 等）。

    - 场景2: API 上传项目时读取配置
      用户通过 Web界面上传一个项目压缩包时，后端需要解压并读取
      配置文件来解析项目结构。

    - 场景3: 加载表结构定义
      系统需要读取 *.schema.yaml 文件来获取表的列定义和数据源信息。

    - 场景4: 加载约束规则
      系统需要读取 *.constraint.yaml 文件来获取数据校验规则。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - path: Path 对象，表示 YAML 文件的路径
        示例值: Path("project.precis.yaml")

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 打开文件                                         │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: Path 对象                                           │
      │ 操作: 使用 open() 函数以只读模式打开文件，指定 UTF-8 编码  │
      │ 输出: 文件句柄对象                                         │
      │ 示例:                                                    │
      │   输入: Path("config.yaml")                               │
      │   处理: open("config.yaml", "r", encoding="utf-8")        │
      │   输出: <_io.TextIOWrapper name='config.yaml' ...>      │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: 解析 YAML 内容                                    │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 文件句柄对象                                         │
      │ 操作: 使用 yaml.safe_load() 安全解析 YAML 文本             │
      │       safe_load 会自动识别 YAML 语法结构                  │
      │ 输出: Python 字典对象                                     │
      │ 示例:                                                    │
      │   输入: "version: 2\nproject:\n  id: test" 的文本        │
      │   处理: yaml.safe_load(文本)                             │
      │   输出: {"version": 2, "project": {"id": "test"}}       │
      └─────────────────────────────────────────────────────────────┘

    最终输出: Dict[str, Any] - 包含所有配置项的字典对象
      示例:
        {
            "version": 2,
            "project": {"id": "my-project", "name": "My Project"},
            "schemas": [{"id": "users", "path": "schemas/users.yaml"}],
            ...
        }

    ============================================================================
    异常处理 (可能出什么问题)
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | FileNotFoundError | 指定的文件路径不存在 | 调用方需要检查文件是否存在 |
    | PermissionError | 没有文件读取权限 | 调用方需要检查文件权限设置 |
    | yaml.YAMLError | YAML 格式错误（如缩进错误、语法错误）| 返回带文件路径的错误信息 |
    | UnicodeDecodeError | 文件编码不是 UTF-8 | 需要指定正确的编码格式 |

    :param path: YAML 文件的路径对象，支持绝对路径和相对路径
    :return: YAML 解析后的字典，文件内容将被映射为 Python 字典结构
    :raises FileNotFoundError: 当指定路径的文件不存在时抛出
    :raises yaml.YAMLError: 当 YAML 格式错误时抛出
    """
    with open(path, encoding="utf-8") as f:
        return cast(dict[str, Any], yaml.safe_load(f))


def write_yaml(path: Path, data: dict[str, Any]) -> None:
    """
    @methoddesc 将字典数据写入 YAML 文件。

    ============================================================================
    输入数据示例 (这个函数接收什么数据)
    ============================================================================
    本函数接收以下格式的 Python 字典数据：

    ```python
    # 示例1: 项目清单数据
    {
        "version": 2,
        "project": {
            "id": "my-data-project",
            "name": "My Data Project"
        },
        "settings": {
            "validation": {
                "auto_validate": True,
                "strict_mode": False
            }
        },
        "schemas": [
            {"id": "users", "path": "schemas/users.schema.yaml"}
        ],
        "constraints": [
            {"id": "email_notnull", "path": "constraints/email_notnull.constraint.yaml"}
        ],
        "regex_nodes": [],
        "patterns_dir": "patterns"
    }

    # 示例2: 约束配置数据
    {
        "version": 2,
        "id": "unique_user_email",
        "type": "Unique",
        "enabled": True,
        "description": "用户邮箱必须唯一",
        "refs": {
            "table_id": "users",
            "column_ids": ["email"]
        },
        "params": {}
    }

    # 示例3: Schema 配置数据
    {
        "version": 2,
        "id": "users",
        "name": "users",
        "source": {
            "mode": "relative_file",
            "path": "data/users.xlsx",
            "sheet": "Sheet1",
            "header_row": 0
        },
        "columns": [
            {"id": "user_id", "name": "user_id", "type": "string", "primary_key": True},
            {"id": "email", "name": "email", "type": "string"}
        ],
        "constraints": [],
        "script_checks": []
    }
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 用户通过 UI 创建新的约束规则
      用户在约束创建页面填写完配置表单后，点击保存按钮。
      系统将表单数据构建为字典，然后调用 write_yaml 将其
      写入到 constraints/ 目录下的 *.constraint.yaml 文件。

    - 场景2: 保存项目设置
      用户在项目设置页面修改了校验超时时间、文件编码等配置，
      点击保存后，系统将更新后的设置写入 project.precis.yaml。

    - 场景3: 导出项目配置
      用户希望将当前项目配置导出为可分享的配置文件，
      系统将项目所有配置序列化为 YAML 文件供用户下载。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - path: Path 对象，表示目标 YAML 文件的路径
        示例值: Path("constraints/email_notnull.constraint.yaml")
      - data: Dict[str, Any]，要写入的字典数据
        示例值: {"version": 2, "id": "email_notnull", ...}

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 检查并创建父目录                                  │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 目标文件路径                                         │
      │ 操作: 检查父目录是否存在，不存在则递归创建                  │
      │       parents=True: 递归创建所有不存在的父目录            │
      │       exist_ok=True: 如果目录已存在，不抛出异常            │
      │ 输出: 无（目录已就绪）                                     │
      │ 示例:                                                    │
      │   输入: Path("constraints/new/email.yaml")               │
      │   处理: 创建 constraints/ 和 constraints/new/ 目录        │
      │   输出: (无返回值，目录已创建)                            │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: 打开文件准备写入                                  │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 目标路径                                            │
      │ 操作: 使用 open() 函数以写入模式创建/覆盖文件             │
      │       encoding="utf-8" 确保正确处理中文                  │
      │ 输出: 文件句柄对象                                         │
      │ 示例:                                                    │
      │   输入: Path("config.yaml")                               │
      │   处理: open("config.yaml", "w", encoding="utf-8")       │
      │   输出: <_io.TextIOWrapper name='config.yaml' mode='w'>  │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 3: 序列化为 YAML 并写入                              │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 字典数据                                            │
      │ 操作: 使用 yaml.safe_dump() 将字典序列化为 YAML 格式     │
      │       allow_unicode=True: 支持中文字符                    │
      │       sort_keys=False: 保持键的原始顺序，便于版本控制    │
      │ 输出: 无（直接写入文件）                                  │
      │ 示例:                                                    │
      │   输入: {"version": 2, "project": {"id": "test"}}        │
      │   处理: yaml.safe_dump(字典, 文件句柄, allow_unicode=True, sort_keys=False) │
      │   输出: (YAML 文本已写入文件)                             │
      │         version: 2                                        │
      │         project:                                          │
      │           id: test                                       │
      └─────────────────────────────────────────────────────────────┘

    最终输出: None (无返回值，写入成功后直接返回)

    ============================================================================
    异常处理 (可能出什么问题)
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | PermissionError | 没有文件写入权限或父目录写权限 | 需要检查文件/目录权限设置 |
    | FileNotFoundError | 父目录不存在且无法创建（如磁盘满）| 需要检查磁盘空间和路径有效性 |
    | IsADirectoryError | path 指向一个已存在的目录 | 需要确保 path 是文件路径而非目录 |

    注意事项:
    - 如果文件已存在，write_yaml 会覆盖原有内容
    - 写入前会自动创建所有必要的父目录
    - YAML 键的顺序由字典本身决定，不会自动排序

    :param path: 目标 YAML 文件的路径对象
    :param data: 要写入的字典数据，支持嵌套字典和列表
    :raises PermissionError: 没有写入权限时抛出
    :raises FileNotFoundError: 父目录无法创建时抛出
    """
    # 创建父目录，确保路径存在
    # parents=True: 递归创建所有父目录
    # exist_ok=True: 如果目录已存在，不抛出异常
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        # allow_unicode=True: 支持 Unicode 字符（如中文）
        # sort_keys=False: 保持字典键的原始顺序，便于版本控制和审查
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)


def _replace_file_with_retry(src: str, dst: Path, max_retries: int = 3, delay: float = 0.2) -> None:
    """原子替换文件，Windows 上目标文件被锁定时自动重试。"""
    for attempt in range(max_retries + 1):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt < max_retries:
                time.sleep(delay)
            else:
                raise


def write_yaml_atomic(path: Path, data: dict[str, Any]) -> None:
    """使用原子写入方式将数据写入 YAML 文件。

    使用临时文件 + os.replace 原子重命名策略，确保：
    - 写入过程中如果失败，不会影响原文件
    - 写入完成后原子性地替换原文件
    - Windows 上目标文件被锁定时自动重试

    使用 yaml.safe_dump（安全序列化器），防止代码注入。
    """
    path = Path(path)
    dir_path = path.parent
    dir_path.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(dir=dir_path, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
            f.flush()
            os.fsync(f.fileno())
        # os.replace 在同一文件系统上是原子操作（POSIX 和 Windows 均保证）
        _replace_file_with_retry(temp_path, path)
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise
