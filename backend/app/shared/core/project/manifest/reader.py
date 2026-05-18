"""
@fileoverview 项目清单读取模块

功能概述:
- 从 project.precis.yaml 文件读取项目清单配置
- 提供清单文件的加载、解析和校验功能
- 支持批量加载多个约束配置文件

架构设计:
- 单一职责: 仅负责清单文件读取，不涉及写入逻辑
- 依赖注入: 使用 YAML 读取工具进行文件解析
- 类型安全: 使用 Pydantic 模型验证确保清单格式正确

输入示例:
    # project.precis.yaml
    version: 2
    project:
      id: my-project
      name: My Project
    schemas:
      - id: users
        path: schemas/users.schema.yaml

输出示例:
    manifest = load_manifest("project.precis.yaml")
    print(manifest.project.name)
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from app.shared.core.io.yaml import read_yaml

from .types import ProjectManifest

if TYPE_CHECKING:
    from .types import ProjectManifest


def load_manifest(manifest_path: str | Path) -> ProjectManifest:
    """
    @methoddesc 从 project.precis.yaml 文件加载项目清单。

    ============================================================================
    配置文件示例 (本函数处理的配置文件长这样)
    ============================================================================
    本函数处理以下格式的 project.precis.yaml 文件：

    ```yaml
    # ============================================================
    # Precis 项目清单文件 (project.precis.yaml)
    # ============================================================
    # 这是项目的入口文件，记录所有配置文件的索引引用
    # 通过此文件，系统可以定位项目中所有的 schema、constraint 和 regex 配置

    # 配置版本号，固定为 2
    version: 2

    # 项目基本信息
    project:
      id: my-data-project           # 项目唯一标识符（系统内部使用）
      name: My Data Project         # 项目展示名称（UI 显示使用）

    # 项目设置（所有可选字段都有默认值）
    settings:
      validation:                   # 校验行为设置
        auto_validate: true         # 配置变更时自动执行校验
        strict_mode: false          # 非严格模式（发现错误继续校验）
        error_handling: continue    # 错误处理策略：continue/report/stop
        timeout_seconds: 30         # 单次校验超时时间（秒）
        batch_max_files: 100        # 批量校验最大文件数
      file_processing:              # 文件处理设置
        default_encoding: utf-8     # 默认文件编码
        csv_delimiter: ","          # CSV 分隔符
      script_security:              # 脚本安全设置
        allow_eval: false           # 禁止 eval() 函数
        allow_exec: false           # 禁止 exec() 函数
        sandbox_mode: true          # 启用沙箱模式
        timeout_seconds: 10         # 脚本执行超时时间（秒）

    # Schema 文件索引列表
    schemas:
      - id: users                   # 表 ID（必须与 schema 文件内的 id 一致）
        path: schemas/users.schema.yaml   # 相对于 manifest 所在目录的路径
      - id: orders
        path: schemas/orders.schema.yaml

    # Constraint 文件索引列表
    constraints:
      - id: unique_user_email
        path: constraints/unique_user_email.constraint.yaml

    # Regex 节点文件索引列表
    regex_nodes:
      - id: phone_number
        path: regex_nodes/phone_number.regex.yaml

    # Patterns 目录路径
    patterns_dir: patterns
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: CLI 启动数据校验
      用户在命令行执行 `precis validate --project ./my-project` 启动数据校验。
      系统自动在项目目录查找 project.precis.yaml 文件，调用 load_manifest 读取并解析该文件。

    - 场景2: 前端加载项目配置
      用户在前端打开一个已存在的项目。
      前端发送请求到后端获取项目配置，后端调用 load_manifest 读取项目清单，
      将 ProjectManifest 对象序列化为 JSON 返回给前端。

    - 场景3: 项目初始化向导
      用户创建新项目时，系统会创建一个默认的 project.precis.yaml 文件，
      然后调用 load_manifest 验证配置文件是否有效。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - manifest_path: str | Path，项目清单文件路径
        示例值: "./my-project/project.precis.yaml" 或 Path("project.precis.yaml")

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 参数标准化                                      │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 字符串或 Path 对象                                  │
      │ 操作: 使用 Path() 构造函数转换为 Path 对象                 │
      │       确保跨平台兼容性，统一处理路径格式                    │
      │ 输出: Path 对象                                          │
      │ 示例:                                                    │
      │   输入: "./my-project/project.precis.yaml" (str)       │
      │   处理: Path("./my-project/project.precis.yaml")        │
      │   输出: Path("./my-project/project.precis.yaml")        │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: 文件存在性检查                                   │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: Path 对象                                           │
      │ 操作: 使用 path.exists() 方法检查文件是否存在             │
      │       快速失败，避免后续无效的 I/O 操作                   │
      │ 输出: 布尔值（存在为 True，不存在为 False）             │
      │ 示例:                                                    │
      │   输入: Path("./my-project/project.precis.yaml")        │
      │   处理: Path("./my-project/project.precis.yaml").exists() │
      │   输出: True (如果文件存在)                              │
      │ 异常:                                                    │
      │   - 不存在: 抛出 ValueError("manifest 文件不存在: ...") │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 3: YAML 解析                                       │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: Path 对象                                           │
      │ 操作: 调用 read_yaml() 读取 YAML 文件内容                 │
      │       返回包含所有配置项的字典对象                        │
      │ 输出: Dict[str, Any] - 原始配置字典                     │
      │ 示例:                                                    │
      │   输入: Path("project.precis.yaml")                   │
      │   处理: read_yaml(Path("project.precis.yaml"))         │
      │   输出: {"version": 2, "project": {...}, "schemas": []} │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 4: Pydantic 模型验证                               │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: Dict[str, Any] - 原始配置字典                       │
      │ 操作: 使用 ProjectManifest.model_validate() 验证数据       │
      │       自动执行类型检查、必填字段验证、格式校验等           │
      │ 输出: ProjectManifest 对象                                │
      │ 示例:                                                    │
      │   输入: {"version": 2, "project": {"id": "test"}}       │
      │   处理: ProjectManifest.model_validate(字典)              │
      │   输出: ProjectManifest(version=2, project=ProjectInfo(...)) │
      │ 验证内容:                                                 │
      │   - version 必须是整数 2                                 │
      │   - project 必须是包含 id 和 name 的对象                 │
      │   - settings 会被赋予默认值（如果省略）                   │
      │   - schemas/constraints/regex_nodes 中的 ID 必须唯一       │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 5: 异常包装（验证失败时）                           │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 验证异常                                            │
      │ 操作: 将验证异常包装为 ValueError，添加文件路径信息       │
      │       便于调用方定位问题                                  │
      │ 输出: ValueError 异常                                     │
      │ 示例:                                                    │
      │   输入: ValidationError (Pydantic 验证错误)              │
      │   处理: raise ValueError(f"manifest 校验失败: {path}\n{e}")│
      │   输出: ValueError("manifest 校验失败: project.precis.yaml\n...") │
      └─────────────────────────────────────────────────────────────┘

    最终输出: ProjectManifest - 验证通过的项目清单对象
      示例:
        manifest = load_manifest("./my-project/project.precis.yaml")
        print(manifest.project.name)  # 输出: My Data Project
        print(len(manifest.schemas))  # 输出: 2
        print(manifest.settings.validation.auto_validate)  # 输出: True

    ============================================================================
    异常处理 (可能出什么问题)
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | ValueError | manifest 文件不存在 | 检查文件路径是否正确 |
    | ValueError | YAML 格式错误（如缩进错误）| 使用 YAML 格式检查工具验证文件 |
    | ValueError | 必填字段缺失（如 project 字段）| 补全缺失的必填字段 |
    | ValueError | 类型错误（如 version 不是整数）| 检查字段类型是否正确 |
    | ValueError | ID 重复（schemas/constraints/regex_nodes）| 检查并移除重复的 ID |

    :param manifest_path: 清单文件路径，支持字符串或 Path 对象
    :return: ProjectManifest - 验证通过的项目清单对象
    :raises ValueError: 文件不存在或格式校验失败时抛出

    示例:
        >>> manifest = load_manifest("./my-project/project.precis.yaml")
        >>> print(manifest.project.name)
        'My Data Project'
        >>> print(f"Found {len(manifest.schemas)} schemas")
        'Found 5 schemas'
    """
    # Step 1: 参数标准化 - 将输入转换为 Path 对象，确保统一处理
    path = Path(manifest_path)

    # Step 2: 文件存在性检查 - 快速失败，避免后续无效的 I/O 操作
    if not path.exists():
        raise ValueError(f"manifest 文件不存在: {manifest_path}")

    # Step 3: YAML 解析 - 读取原始配置文件内容，返回字典结构
    raw = read_yaml(path)

    # Step 4: Pydantic 模型验证 - 确保配置符合预期的数据结构
    #         自动执行类型检查、必填字段验证、格式校验等
    try:
        return ProjectManifest.model_validate(raw)
    except Exception as e:
        # Step 5: 异常包装 - 添加文件路径上下文，便于问题定位
        raise ValueError(f"manifest 校验失败: {manifest_path}\n{e}") from e
