"""
@fileoverview 项目清单覆盖度检查模块

功能概述:
- 计算 project.precis.yaml 清单与实际磁盘文件的覆盖关系
- 检测未入清单的资源（unlisted）和清单引用但缺失的资源（dangling）
- 为前端提供清单一致性诊断数据

架构设计:
- 纯函数设计: compute_manifest_coverage 无副作用，仅读取文件系统
- 数据类: CoverageRef、ManifestCoverage 使用 frozen dataclass 保证不可变性
- 扫描策略: 分别扫描 schemas/、constraints/、regex/ 目录与清单比对

输入示例:
    manifest = ProjectManifestV2(
        schemas=[SchemaRef(id="users", path="schemas/users.schema.yaml")],
        constraints=[],
        regex_nodes=[],
    )
    coverage = compute_manifest_coverage("/path/to/project", manifest)

输出示例:
    ManifestCoverage(
        unlisted_schemas=[CoverageRef(id="orders", path="schemas/orders.schema.yaml")],
        unlisted_constraints=[],
        unlisted_regex_nodes=[],
        dangling_schemas=[CoverageRef(id="old_users", path="schemas/old_users.schema.yaml")],
        dangling_constraints=[],
        dangling_regex_nodes=[],
    )
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from app.shared.core.io.yaml import read_yaml
from app.shared.core.project.manifest.types import ProjectManifestV2
from app.shared.core.utils.path_utils import normalize_to_posix

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CoverageRef:
    """@classdesc 单个资源的覆盖度引用

    用于标识一个具体的配置文件，包含资源 ID 和文件路径。

    字段说明:
        - id: 资源的唯一标识符（从文件名或文件内容中提取）
        - path: 文件相对于项目根目录的路径

    示例:
        CoverageRef(id="users", path="schemas/users.schema.yaml")
    """

    id: str  # 资源唯一标识符
    path: str  # 文件相对路径


@dataclass(frozen=True)
class ManifestCoverage:
    """@classdesc 清单覆盖度结果

    保存清单与实际磁盘文件的对比结果，分为两类：
    - unlisted: 磁盘上有但清单中未引用的文件（遗漏配置）
    - dangling: 清单中引用了但磁盘上缺失的文件（无效引用）

    字段说明:
        - unlisted_schemas: 未入清单的 schema 文件
        - unlisted_constraints: 未入清单的 constraint 文件
        - unlisted_regex_nodes: 未入清单的 regex 文件
        - dangling_schemas: 引用但缺失的 schema 文件
        - dangling_constraints: 引用但缺失的 constraint 文件
        - dangling_regex_nodes: 引用但缺失的 regex 文件

    示例:
        ManifestCoverage(
            unlisted_schemas=[CoverageRef(id="orders", path="schemas/orders.schema.yaml")],
            unlisted_constraints=[],
            unlisted_regex_nodes=[],
            dangling_schemas=[CoverageRef(id="old_users", path="schemas/old_users.schema.yaml")],
            dangling_constraints=[],
            dangling_regex_nodes=[],
        )
    """

    unlisted_schemas: list[CoverageRef]  # 磁盘存在但清单未引用的 schema
    unlisted_constraints: list[CoverageRef]  # 磁盘存在但清单未引用的 constraint
    unlisted_regex_nodes: list[CoverageRef]  # 磁盘存在但清单未引用的 regex
    dangling_schemas: list[CoverageRef]  # 清单引用但磁盘缺失的 schema
    dangling_constraints: list[CoverageRef]  # 清单引用但磁盘缺失的 constraint
    dangling_regex_nodes: list[CoverageRef]  # 清单引用但磁盘缺失的 regex


def compute_manifest_coverage(config_path: str, manifest: ProjectManifestV2) -> ManifestCoverage:
    """@methoddesc 计算清单与实际磁盘文件的覆盖关系

    本函数通过对比 manifest 中记录的文件引用与磁盘上实际存在的文件，
    发现两类问题：
    1. unlisted（未入清单）：磁盘上有配置文件，但 manifest 里没有引用它
    2. dangling（悬空引用）：manifest 里引用了某个文件，但磁盘上找不到它

    ============================================================================
    处理流程
    ============================================================================
    1. 构建三个目录路径：schemas/、constraints/、regex/
    2. 收集 manifest 中已引用的文件路径和 ID
    3. 扫描磁盘目录，找出未入清单的文件（unlisted）
    4. 遍历 manifest 引用，找出缺失的文件（dangling）
    5. 组装并返回 ManifestCoverage 结果对象

    ============================================================================
    参数说明
    ============================================================================
    :param config_path: 项目根目录路径（manifest 所在目录）
    :param manifest: 已加载的项目清单对象
    :return: ManifestCoverage 覆盖度结果对象

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 项目健康检查
      用户执行项目诊断时，系统调用此函数发现配置不一致问题。
    - 场景2: 前端项目概览页面
      前端展示项目配置完整性时，调用此接口获取统计数据。
    """
    # ============================================================================
    # 第一步：构建三个资源目录的绝对路径
    # ============================================================================
    # 分别在项目根目录下查找 schemas、constraints、regex 子目录
    schemas_dir = os.path.join(config_path, "schemas")
    constraints_dir = os.path.join(config_path, "constraints")
    regex_dir = os.path.join(config_path, "regex")

    # ============================================================================
    # 第二步：收集 manifest 中已引用的路径和 ID
    # ============================================================================
    # schema_paths 使用小写路径集合，用于不区分大小写的路径匹配
    # 注意：schemas 使用 path 字段匹配，constraints 和 regex 使用 id 字段匹配
    schema_paths = {normalize_to_posix(r.path or "").lower() for r in (manifest.schemas or [])}
    constraint_ids = {r.id for r in (manifest.constraints or [])}
    regex_ids = {r.id for r in (manifest.regex_nodes or [])}

    # ============================================================================
    # 第三步：扫描 schemas 目录，找出未入清单的 schema 文件
    # ============================================================================
    # 遍历 schemas/ 目录下所有 .schema.yaml 结尾的文件
    # 对于每个文件：
    #   - 如果 manifest 中已引用（按路径匹配），跳过
    #   - 否则，尝试读取文件内容获取真实的 id 字段
    #   - 如果读取失败，使用文件名（去掉 .schema.yaml 后缀）作为 id
    unlisted_schemas: list[CoverageRef] = []
    if os.path.isdir(schemas_dir):
        for filename in os.listdir(schemas_dir):
            # 只处理 .schema.yaml 后缀的文件
            if filename.lower().endswith(".schema.yaml"):
                # 构建相对路径，统一使用正斜杠
                rel_path = f"schemas/{filename}"
                # 检查 manifest 中是否已引用该路径（不区分大小写）
                if normalize_to_posix(rel_path).lower() in schema_paths:
                    continue  # 已入清单，跳过
                # 默认使用文件名（去掉 .schema.yaml）作为 id
                rid = filename[:-12]
                try:
                    # 尝试读取文件内容，获取真实的 id 字段
                    raw = read_yaml(Path(os.path.join(schemas_dir, filename)))
                    file_id = raw.get("id") if isinstance(raw, dict) else None
                    # 如果文件内 id 是有效的字符串，使用文件内的 id
                    if isinstance(file_id, str) and file_id.strip():
                        rid = file_id.strip()
                except Exception as e:
                    # 读取失败时记录警告，但仍使用文件名作为 id
                    logger.warning(f"读取schema文件失败: {filename}, 错误: {e}")
                # 将未入清单的 schema 添加到结果列表
                unlisted_schemas.append(CoverageRef(id=rid, path=rel_path))
    # 按 id 排序，保证输出结果稳定可预测
    unlisted_schemas.sort(key=lambda r: r.id)

    # ============================================================================
    # 第四步：扫描 constraints 目录，找出未入清单的约束文件
    # ============================================================================
    # constraints 使用文件名（去掉 .constraint.yaml）作为 id，与 manifest 中的 id 匹配
    unlisted_constraints: list[CoverageRef] = []
    if os.path.isdir(constraints_dir):
        for filename in os.listdir(constraints_dir):
            if filename.lower().endswith(".constraint.yaml"):
                # 从文件名中提取约束 id（去掉 .constraint.yaml 后缀）
                rid = filename[:-16]
                # 如果 manifest 中未引用该 id，则标记为未入清单
                if rid not in constraint_ids:
                    unlisted_constraints.append(CoverageRef(id=rid, path=f"constraints/{filename}"))
    unlisted_constraints.sort(key=lambda r: r.id)

    # ============================================================================
    # 第五步：扫描 regex 目录，找出未入清单的正则文件
    # ============================================================================
    # regex 使用文件名（去掉 .regex.yaml）作为 id，与 manifest 中的 id 匹配
    unlisted_regex_nodes: list[CoverageRef] = []
    if os.path.isdir(regex_dir):
        for filename in os.listdir(regex_dir):
            if filename.lower().endswith(".regex.yaml"):
                # 从文件名中提取 regex id（去掉 .regex.yaml 后缀）
                rid = filename[:-11]
                # 如果 manifest 中未引用该 id，则标记为未入清单
                if rid not in regex_ids:
                    unlisted_regex_nodes.append(CoverageRef(id=rid, path=f"regex/{filename}"))
    unlisted_regex_nodes.sort(key=lambda r: r.id)

    # ============================================================================
    # 第六步：检查 dangling schemas（清单引用但磁盘缺失）
    # ============================================================================
    # 遍历 manifest 中所有 schema 引用，检查对应的文件是否存在于磁盘
    dangling_schemas: list[CoverageRef] = []
    for ref in manifest.schemas or []:
        # 如果文件不存在，标记为悬空引用
        if not os.path.isfile(os.path.join(config_path, ref.path)):
            dangling_schemas.append(CoverageRef(id=ref.id, path=ref.path))
    dangling_schemas.sort(key=lambda r: r.id)

    # ============================================================================
    # 第七步：检查 dangling constraints（清单引用但磁盘缺失）
    # ============================================================================
    dangling_constraints: list[CoverageRef] = []
    for ref in manifest.constraints or []:
        if not os.path.isfile(os.path.join(config_path, ref.path)):
            dangling_constraints.append(CoverageRef(id=ref.id, path=ref.path))
    dangling_constraints.sort(key=lambda r: r.id)

    # ============================================================================
    # 第八步：检查 dangling regex nodes（清单引用但磁盘缺失）
    # ============================================================================
    dangling_regex_nodes: list[CoverageRef] = []
    for ref in manifest.regex_nodes or []:
        if not os.path.isfile(os.path.join(config_path, ref.path)):
            dangling_regex_nodes.append(CoverageRef(id=ref.id, path=ref.path))
    dangling_regex_nodes.sort(key=lambda r: r.id)

    # ============================================================================
    # 第九步：组装并返回覆盖度结果
    # ============================================================================
    return ManifestCoverage(
        unlisted_schemas=unlisted_schemas,
        unlisted_constraints=unlisted_constraints,
        unlisted_regex_nodes=unlisted_regex_nodes,
        dangling_schemas=dangling_schemas,
        dangling_constraints=dangling_constraints,
        dangling_regex_nodes=dangling_regex_nodes,
    )


def coverage_to_api_dict(coverage: ManifestCoverage) -> dict:
    """@methoddesc 将 ManifestCoverage 对象转换为 API 响应字典

    本函数将覆盖度检查结果转换为前端易用的字典格式，
    包含一个 is_complete 标志和按类型分组的 unlisted/dangling 列表。

    参数说明:
        :param coverage: ManifestCoverage 覆盖度结果对象
        :return: API 响应字典，结构如下:
            {
                "is_complete": bool,  # 是否完全覆盖（无任何问题）
                "unlisted": {
                    "schemas": [{"id": str, "path": str}, ...],
                    "constraints": [...],
                    "regex_nodes": [...],
                },
                "dangling": {
                    "schemas": [...],
                    "constraints": [...],
                    "regex_nodes": [...],
                },
            }

    示例:
        >>> coverage = ManifestCoverage(
        ...     unlisted_schemas=[CoverageRef(id="orders", path="schemas/orders.schema.yaml")],
        ...     unlisted_constraints=[],
        ...     unlisted_regex_nodes=[],
        ...     dangling_schemas=[],
        ...     dangling_constraints=[],
        ...     dangling_regex_nodes=[],
        ... )
        >>> result = coverage_to_api_dict(coverage)
        >>> result["is_complete"]
        False
        >>> len(result["unlisted"]["schemas"])
        1
    """
    # is_complete 为 True 的条件：所有 unlisted 和 dangling 列表都为空
    # 即没有任何遗漏配置，也没有任何无效引用
    return {
        "is_complete": not (
            coverage.unlisted_schemas
            or coverage.unlisted_constraints
            or coverage.unlisted_regex_nodes
            or coverage.dangling_schemas
            or coverage.dangling_constraints
            or coverage.dangling_regex_nodes
        ),
        # 未入清单的资源（磁盘有但清单未引用）
        "unlisted": {
            "schemas": [r.__dict__ for r in coverage.unlisted_schemas],
            "constraints": [r.__dict__ for r in coverage.unlisted_constraints],
            "regex_nodes": [r.__dict__ for r in coverage.unlisted_regex_nodes],
        },
        # 悬空引用的资源（清单引用但磁盘缺失）
        "dangling": {
            "schemas": [r.__dict__ for r in coverage.dangling_schemas],
            "constraints": [r.__dict__ for r in coverage.dangling_constraints],
            "regex_nodes": [r.__dict__ for r in coverage.dangling_regex_nodes],
        },
    }
