"""
@fileoverview 项目清单写入模块

功能概述:
- 将项目清单写入 project.precis.yaml 文件
- 提供清单的持久化功能
- 管理清单中各种引用（schema、constraint、regex）

架构设计:
- 写入职责: 专注于清单文件保存和引用管理
- 工具函数: 提供 ensure_*_ref 系列函数用于动态添加引用
- 完整性保证: 写入时自动排除空值字段，确保配置简洁

输入示例:
    manifest = ProjectManifest(
        version=2,
        project=ProjectInfo(id="my-project", name="My Project"),
        schemas=[SchemaRef(id="users", path="schemas/users.schema.yaml")],
    )

输出示例:
    save_manifest(manifest, "project.precis.yaml")
"""

from __future__ import annotations

from pathlib import Path

from app.shared.core.io.yaml import write_yaml

from .types import ConstraintRef, ManualDataRef, ProjectManifest, RegexRef, SchemaRef


def save_manifest(manifest: ProjectManifest, manifest_path: str | Path) -> None:
    """
    @methoddesc 将项目清单保存到 YAML 文件。

    本函数将 ProjectManifest 对象序列化为 YAML 格式并写入指定文件。
    写入时自动排除空值字段（exclude_none=True），生成干净简洁的配置文件。

    处理流程：
        1. 路径标准化：将路径转换为 Path 对象
        2. 模型序列化：将 Pydantic 模型转换为字典（排除 None 值）
        3. YAML 写入：调用底层 YAML 工具写入文件

    参数说明：
        manifest: 已构建的 ProjectManifest 对象，包含完整的项目配置。
                 建议在保存前确保所有必要字段已正确填充。
        manifest_path: 目标文件路径，支持字符串或 Path 对象。
                      如果父目录不存在，写入前需要确保目录已创建。

    返回值：
        无返回值。函数执行完成后，清单内容已持久化到指定文件。

    异常抛出：
        可能抛出 I/O 相关异常（如权限不足、磁盘空间不足等）。

    示例：
        >>> manifest = ProjectManifest(
        ...     version=2,
        ...     project=ProjectInfo(id="my-project", name="My Project"),
        ...     schemas=[SchemaRef(id="users", path="schemas/users.yaml")]
        ... )
        >>> save_manifest(manifest, "./project.precis.yaml")
        >>> # 文件内容已写入
    """
    # 将 Pydantic 模型序列化为字典，exclude_none=True 排除空值字段
    # 这样可以生成干净简洁的 YAML 配置文件
    write_yaml(Path(manifest_path), manifest.model_dump(exclude_none=True))


def ensure_schema_ref(manifest: ProjectManifest, table_id: str, default_path: str = None) -> SchemaRef:
    """
    @methoddesc 确保清单中包含指定 table_id 的 schema 引用。

    本函数用于动态向清单添加 schema 引用。如果指定的 schema 引用已存在，
    直接返回现有引用；如果不存在，则创建新的引用并添加到清单中。

    处理流程：
        1. 查找现有引用：在 manifest.schemas 列表中查找匹配的 ID
        2. 存在判断：找到则直接返回，找不到则进入步骤 3
        3. 创建新引用：使用提供的 table_id 和 default_path 构建新引用
        4. 添加到清单：将新引用追加到 manifest.schemas 列表
        5. 返回引用：返回找到或创建的 SchemaRef 对象

    参数说明：
        manifest: 目标 ProjectManifest 对象，引用将被添加到此清单。
        table_id: Schema 文件对应的表 ID，必须与 schema 文件内部的 id 一致。
        default_path: 当引用不存在时使用的默认路径。
                     默认为 "schemas/{table_id}.schema.yaml"。

    返回值：
        SchemaRef: 找到或创建的 schema 引用对象，包含：
            - id: 表 ID
            - path: schema 文件相对路径

    示例：
        >>> manifest = ProjectManifest(...)
        >>> # 确保 users schema 引用存在
        >>> ref = ensure_schema_ref(manifest, "users")
        >>> print(ref.path)
        'schemas/users.schema.yaml'
    """
    # Step 1: 线性查找 - 在现有 schema 引用列表中查找匹配 ID
    # 使用生成器表达式配合 next() 实现高效的首次匹配查找
    ref = next((s for s in manifest.schemas if s.id == table_id), None)

    # Step 2: 存在则直接返回 - 无需修改清单
    if ref:
        return ref

    # Step 3: 不存在则创建新引用 - 使用默认路径或自定义路径
    # 默认路径格式: schemas/{table_id}.schema.yaml
    new_ref = SchemaRef(id=table_id, path=default_path or f"schemas/{table_id}.schema.yaml")

    # Step 4: 添加到清单 - 修改传入的 manifest 对象
    manifest.schemas.append(new_ref)

    # Step 5: 返回引用 - 供调用方使用
    return new_ref


def ensure_constraint_ref(manifest: ProjectManifest, constraint_id: str, default_path: str = None) -> ConstraintRef:
    """
    @methoddesc 确保清单中包含指定 constraint_id 的约束引用。

    本函数用于动态向清单添加 constraint 引用。如果指定的 constraint 引用已存在，
    直接返回现有引用；如果不存在，则创建新的引用并添加到清单中。

    处理流程：
        1. 查找现有引用：在 manifest.constraints 列表中查找匹配的 ID
        2. 存在判断：找到则直接返回，找不到则进入步骤 3
        3. 创建新引用：使用提供的 constraint_id 和 default_path 构建新引用
        4. 添加到清单：将新引用追加到 manifest.constraints 列表
        5. 返回引用：返回找到或创建的 ConstraintRef 对象

    参数说明：
        manifest: 目标 ProjectManifest 对象，引用将被添加到此清单。
        constraint_id: Constraint 文件对应的约束 ID，必须与 constraint 文件内部的 id 一致。
        default_path: 当引用不存在时使用的默认路径。
                     默认为 "constraints/{constraint_id}.constraint.yaml"。

    返回值：
        ConstraintRef: 找到或创建的 constraint 引用对象，包含：
            - id: 约束 ID
            - path: constraint 文件相对路径

    示例：
        >>> manifest = ProjectManifest(...)
        >>> # 确保 email_format constraint 引用存在
        >>> ref = ensure_constraint_ref(manifest, "email_format")
        >>> print(ref.path)
        'constraints/email_format.constraint.yaml'
    """
    # Step 1: 线性查找 - 在现有 constraint 引用列表中查找匹配 ID
    ref = next((c for c in manifest.constraints if c.id == constraint_id), None)

    # Step 2: 存在则直接返回
    if ref:
        return ref

    # Step 3: 不存在则创建新引用 - 使用默认路径或自定义路径
    # 默认路径格式: constraints/{constraint_id}.constraint.yaml
    new_ref = ConstraintRef(id=constraint_id, path=default_path or f"constraints/{constraint_id}.constraint.yaml")

    # Step 4: 添加到清单
    manifest.constraints.append(new_ref)

    # Step 5: 返回引用
    return new_ref


def ensure_regex_ref(manifest: ProjectManifest, regex_id: str, default_path: str = None) -> RegexRef:
    """
    @methoddesc 确保清单中包含指定 regex_id 的正则节点引用。

    本函数用于动态向清单添加 regex 引用。如果指定的 regex 引用已存在，
    直接返回现有引用；如果不存在，则创建新的引用并添加到清单中。

    处理流程：
        1. 查找现有引用：在 manifest.regex_nodes 列表中查找匹配的 ID
        2. 存在判断：找到则直接返回，找不到则进入步骤 3
        3. 创建新引用：使用提供的 regex_id 和 default_path 构建新引用
        4. 添加到清单：将新引用追加到 manifest.regex_nodes 列表
        5. 返回引用：返回找到或创建的 RegexRef 对象

    参数说明：
        manifest: 目标 ProjectManifest 对象，引用将被添加到此清单。
        regex_id: Regex 节点文件对应的 ID，必须与 regex 文件内部的 id 一致。
        default_path: 当引用不存在时使用的默认路径。
                     默认为 "regex/{regex_id}.regex.yaml"。

    返回值：
        RegexRef: 找到或创建的 regex 引用对象，包含：
            - id: 正则节点 ID
            - path: regex 文件相对路径

    示例：
        >>> manifest = ProjectManifest(...)
        >>> # 确保 phone_number regex 引用存在
        >>> ref = ensure_regex_ref(manifest, "phone_number")
        >>> print(ref.path)
        'regex/phone_number.regex.yaml'
    """
    # Step 1: 线性查找 - 在现有 regex 引用列表中查找匹配 ID
    ref = next((r for r in manifest.regex_nodes if r.id == regex_id), None)

    # Step 2: 存在则直接返回
    if ref:
        return ref

    # Step 3: 不存在则创建新引用 - 使用默认路径或自定义路径
    # 默认路径格式: regex/{regex_id}.regex.yaml
    new_ref = RegexRef(id=regex_id, path=default_path or f"regex/{regex_id}.regex.yaml")

    # Step 4: 添加到清单
    manifest.regex_nodes.append(new_ref)

    # Step 5: 返回引用
    return new_ref


def ensure_manual_data_ref(manifest: ProjectManifest, manual_data_id: str, default_path: str = None) -> ManualDataRef:
    """@methoddesc 确保清单中包含指定 manual_data_id 的 ManualData 引用。

    如果引用已存在则直接返回，否则创建新引用并添加到清单中。

    参数:
        manifest: 目标 ProjectManifest 对象
        manual_data_id: ManualData 节点 ID
        default_path: 默认路径（若为 None 则自动生成）

    返回:
        找到或创建的 ManualDataRef 对象
    """
    ref = next((md for md in manifest.manual_data if md.id == manual_data_id), None)

    if ref:
        return ref

    new_ref = ManualDataRef(id=manual_data_id, path=default_path or f"manual_data/{manual_data_id}.manual_data.yaml")
    manifest.manual_data.append(new_ref)
    return new_ref
