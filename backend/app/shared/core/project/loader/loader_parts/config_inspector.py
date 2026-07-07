"""配置文件格式自检模块 — 编排入口。

本文件已拆分为 4 个职责清晰的子模块，此处保留 inspect_config 编排入口
+ re-export 全部公开符号，保持 3 个调用方（loader/main.py、full_config.py、CLI）
的 import 路径完全兼容。

拆分后的模块结构（按 DAG 依赖层级）：
- inspector_helpers.py          — 公共工具（display/actions/columns，Layer 0）
- inspector_id_checks.py        — ID 一致性检查（Layer 1）
- inspector_reference_checks.py — 引用完整性检查（Layer 1）
- inspector_uniqueness_checks.py — Schema 唯一性检查（Layer 1，不依赖 helpers）
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.shared.core.project.constraint.types import ConstraintFile
    from app.shared.core.project.manifest.types import ProjectManifest
    from app.shared.core.project.manual_data.types import ManualDataFile
    from app.shared.core.project.regex.types import RegexNodeFile
    from app.shared.core.project.schema.types import TableSchemaFile
    from app.shared.core.project.transform.types import TransformFile

# re-export 全部公开符号，保持调用方零改动
# 向后兼容别名：测试直接 import 了原文件的 _xxx 私有函数，
# 拆分后这些函数移到了 inspector_helpers 并去掉了 _ 前缀。
# 此处提供带 _ 前缀的别名保持测试零改动。
from app.shared.core.project.loader.loader_parts.inspector_helpers import (  # noqa: F401
    default_actions_for_file as _default_actions_for_file,
)
from app.shared.core.project.loader.loader_parts.inspector_id_checks import (  # noqa: F401
    inspect_id_consistency,
)
from app.shared.core.project.loader.loader_parts.inspector_reference_checks import (  # noqa: F401
    inspect_reference_integrity,
    inspect_regex_reference_integrity,
)
from app.shared.core.project.loader.loader_parts.inspector_uniqueness_checks import (  # noqa: F401
    inspect_schema_id_orphan_conflict,
    inspect_source_uniqueness,
)


def inspect_config(
    manifest_path: Path,
    manifest: ProjectManifest,
    schema_files: dict[str, TableSchemaFile],
    constraint_files: dict[str, ConstraintFile],
    regex_node_files: dict[str, RegexNodeFile],
    transform_files: dict[str, TransformFile],
    manual_data_files: dict[str, ManualDataFile],
    warnings: list[str],
    loading_errors: list,  # list[LoadingError]，用 list 避免循环 import
) -> None:
    """配置文件格式自检主入口。

    按 5 个检查维度依次执行，结果就地追加到 warnings / loading_errors：
    1. ID 跨文件一致性（manifest ID vs 文件内部 ID）
    2. Schema ID 全局唯一性（基于磁盘扫描，检测重复 ID）
    3. Schema 数据源唯一性（检测多个 schema 指向同一数据源）
    4. 约束引用完整性（表/列是否存在）
    5. 正则引用完整性（表/列是否存在）
    """
    logger.info("[配置自检] 开始检查项目配置: %s", manifest_path.parent.name)
    logger.info(
        "[配置自检] 检查范围: %d schemas, %d constraints, %d regex, %d transforms, %d manual_data",
        len(schema_files),
        len(constraint_files),
        len(regex_node_files),
        len(transform_files),
        len(manual_data_files),
    )

    errors_before = len(loading_errors)
    warnings_before = len(warnings)

    inspect_id_consistency(
        manifest,
        schema_files,
        constraint_files,
        regex_node_files,
        transform_files,
        manual_data_files,
        warnings,
        loading_errors,
    )

    # Schema ID 全局唯一性检测（基于磁盘扫描）
    # 同时覆盖 manifest 内文件冲突与孤儿文件冲突，避免重复上报
    inspect_schema_id_orphan_conflict(manifest_path.parent, manifest, schema_files, loading_errors)

    inspect_source_uniqueness(schema_files, loading_errors)

    inspect_reference_integrity(schema_files, constraint_files, warnings, loading_errors)

    inspect_regex_reference_integrity(regex_node_files, schema_files, warnings, loading_errors)

    errors_found = len(loading_errors) - errors_before
    warnings_found = len(warnings) - warnings_before

    if errors_found == 0 and warnings_found == 0:
        logger.info("[配置自检] 检查通过，未发现问题")
    else:
        logger.warning("[配置自检] 发现 %d 个问题", errors_found)
        for err in loading_errors[errors_before:]:
            logger.warning("[配置自检] [%s] %s", err.error_type, err.message)
