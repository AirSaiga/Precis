"""
@fileoverview 项目加载器类型定义

功能概述:
- 定义项目加载过程中的核心数据类型
- 提供 LoadingError、LoadedProject、LoadedRegexNode 等数据类

架构设计:
- 不可变数据类: LoadedProject、LoadedRegexNode 使用 frozen dataclass
- 延迟导入: 通过 TYPE_CHECKING 避免循环依赖

输入示例:
    LoadedProject(
        manifest_path=Path("project.precis.yaml"),
        manifest=manifest,
        schema_files={"users": schema_file},
        ...
    )

输出示例:
    loading_errors = project.loading_errors  # List[LoadingError]
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Optional

# 直接导入 RegexNodeFile（类型明确，不会引起循环依赖）
from ..regex.types import RegexNodeFile
from ..transform.types import TransformFile

# 仅在类型检查阶段导入，避免运行时循环导入问题
if TYPE_CHECKING:
    from app.shared.domain import DataSetSchema

    from ..constraint.types import ConstraintFile
    from ..manifest.types import ProjectManifest
    from ..schema.types import TableSchemaFile


@dataclass
class LoadingError:
    """@classdesc 加载错误详情

    当项目加载过程中出现文件不存在、解析失败、路径错误等问题时，
    会创建该对象记录错误的详细信息，便于后续排查和展示。

    字段说明:
        - error_type: 错误类型标识（如 SchemaNotFound、SchemaParseError 等）
        - file_path: 发生错误的文件绝对路径
        - ref_id: 对应 manifest 中引用的 ID（可选）
        - message: 人类可读的错误描述
        - suggestion: 修复建议

    === 面向 UI 的扩展字段（前后端契约） ===
        - id: 稳定唯一 id，用于"忽略"持久化（localStorage 等）
        - severity: 严重度 — blocker（阻塞） | warning（警告） | info（提示）
        - title: 人类可读的短标题（中文 fallback，前端有 title_key 时优先用 i18n 渲染）
        - description: 根因说明（中文 fallback，前端有 description_key 时优先用 i18n 渲染）
        - fix_hint: 高亮显示的修复建议（中文 fallback，前端有 fix_hint_key 时优先用 i18n 渲染）
        - actions: 可执行动作列表（open_file / copy / dismiss / auto_fix / navigate）
                   每个 action 可携带 label_key 用于前端 i18n 渲染
        - fix_api: 一键修复的 API 描述（method/path/body）— 仅在"安全操作"时填充
        - context: 上下文数据（如可用表列表、当前值与期望值），用于前端渲染对比表

    === i18n 字段（可选） ===
        - title_key / description_key / fix_hint_key: i18n 键名，前端有该 key 时优先渲染
        - message_params: 模板参数字典，用于 i18n 字符串插值（如 {"constraintId": "fk_x"}）
    """

    error_type: str  # SchemaNotFound, SchemaParseError, ConstraintNotFound, etc.
    file_path: str  # 出错的文件路径
    ref_id: Optional[str] = None  # 引用ID
    message: str = ""  # 错误信息
    suggestion: str = ""  # 修复建议

    # === 面向 UI 的扩展字段 ===
    id: str = ""  # 稳定 id，用于"忽略"持久化
    severity: str = "warning"  # blocker | warning | info
    title: str = ""  # 人类可读短标题
    description: str = ""  # 根因说明
    fix_hint: str = ""  # 修复建议（突出显示）
    actions: list[dict] = field(default_factory=list)  # 可执行动作列表
    fix_api: Optional[dict] = None  # 一键修复 API 描述
    context: dict = field(default_factory=dict)  # 上下文数据（用于渲染对比表等）

    # === i18n 渲染字段（可选，前端有 key 时优先使用） ===
    title_key: str = ""  # i18n key，对应 title
    description_key: str = ""  # i18n key，对应 description
    fix_hint_key: str = ""  # i18n key，对应 fix_hint
    message_params: dict = field(default_factory=dict)  # i18n 插值参数

    def to_dict(self) -> dict:
        """@methoddesc 将错误对象序列化为字典格式

        便于转换为 JSON 返回给前端或写入日志。

        返回值:
            {
                "error_type": ...,
                "file_path": ...,
                "ref_id": ...,
                "message": ...,
                "suggestion": ...,
                "id": ...,
                "severity": ...,
                "title": ...,
                "description": ...,
                "fix_hint": ...,
                "actions": ...,
                "fix_api": ...,
                "context": ...,
                "title_key": ...,
                "description_key": ...,
                "fix_hint_key": ...,
                "message_params": ...,
            }
        """
        return {
            "error_type": self.error_type,
            "file_path": self.file_path,
            "ref_id": self.ref_id,
            "message": self.message,
            "suggestion": self.suggestion,
            "id": self.id,
            "severity": self.severity,
            "title": self.title,
            "description": self.description,
            "fix_hint": self.fix_hint,
            "actions": self.actions,
            "fix_api": self.fix_api,
            "context": self.context,
            "title_key": self.title_key,
            "description_key": self.description_key,
            "fix_hint_key": self.fix_hint_key,
            "message_params": self.message_params,
        }


@dataclass(frozen=True)
class LoadedProject:
    """@classdesc 已加载项目的完整数据结构

    该对象包含从 manifest 文件加载后的所有配置和运行时对象，
    是项目加载流程的最终产物。

    字段说明:
        - manifest_path: manifest 文件路径
        - manifest: manifest 原始数据对象
        - schema_files: 所有 schema 配置文件的映射（table_id -> TableSchemaFile）
        - constraint_files: 所有约束配置文件的映射（constraint_id -> ConstraintFile）
        - regex_node_files: 所有正则节点配置文件的映射（regex_id -> RegexNodeFile）
        - dataset_schema: 运行时的数据集 Schema（包含 TableSchema 和约束实例）
        - warnings: 加载过程中的警告信息列表
        - loading_errors: 加载过程中的错误信息列表
    """

    manifest_path: Path
    manifest: "ProjectManifest"
    schema_files: dict[str, "TableSchemaFile"]
    constraint_files: dict[str, "ConstraintFile"]
    regex_node_files: dict[str, RegexNodeFile]
    dataset_schema: "DataSetSchema"
    transform_files: dict[str, TransformFile] = None
    warnings: list[str] = None
    loading_errors: list[LoadingError] = None

    def __post_init__(self):
        # frozen=True 表示实例创建后不可变，因此必须通过 object.__setattr__ 来修改属性
        if self.warnings is None:
            object.__setattr__(self, "warnings", [])
        if self.loading_errors is None:
            object.__setattr__(self, "loading_errors", [])
        if self.transform_files is None:
            object.__setattr__(self, "transform_files", {})


@dataclass(frozen=True)
class LoadedRegexNode:
    """@classdesc 已加载的正则表达式节点数据

    将 RegexNodeFile 配置与编译后的正则模式、源表/列引用封装在一起。

    字段说明:
        - config: 原始的 RegexNodeFile 配置对象
        - pattern: 编译后的正则表达式模式（re.Pattern）
        - source_table: 该正则节点引用的源表 ID（可选）
        - source_column: 该正则节点引用的源列 ID（可选）
    """

    config: RegexNodeFile
    pattern: re.Pattern
    source_table: Optional[str]
    source_column: Optional[str]
