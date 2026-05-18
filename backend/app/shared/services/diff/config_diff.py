"""
@fileoverview 配置差异比对模块

功能概述:
- 比较两份项目配置（manifest/schemas/constraints/regex_nodes）的差异
- 支持新增、修改、删除三种差异类型的识别
- 为 AI 配置生成后的合并确认提供数据支持

架构设计:
- 服务类模式: ConfigDiffService 提供类方法 compare 作为统一入口
- 递归比对: _diff_recursive 处理 dict/list 嵌套结构的深层差异
- 资源级比对: _compare_resources 处理 schemas/constraints/regex_nodes 的增删改
- 属性级比对: _build_property_diff 生成 PropertyDiff 变更列表

输入示例:
    old = {"manifest": {...}, "schemas": {"users": old_schema}}
    new = {"manifest": {...}, "schemas": {"users": new_schema}}
    result = ConfigDiffService.compare(old, new)

输出示例:
    ConfigDiffResult(
        manifest=[{"path": ["project", "name"], "old_value": "A", "new_value": "B", "diff_type": "modified"}],
        schemas=[ConfigItemDiff(id="users", type=DiffType.MODIFIED, changes=[...])],
        constraints=[],
        regex_nodes=[]
    )
"""

import logging
from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class DiffType(str, Enum):
    """
    @classdesc 差异类型枚举

    定义配置比对时可能出现的四种差异状态：
    - ADDED: 新增内容
    - MODIFIED: 修改内容
    - DELETED: 删除内容
    - UNCHANGED: 未变更（通常不展示）
    """

    ADDED = "added"
    MODIFIED = "modified"
    DELETED = "deleted"
    UNCHANGED = "unchanged"


class PropertyDiff(BaseModel):
    """
    @classdesc 属性级差异模型

    记录单个配置属性的变更详情，包括属性名、旧值、新值和变更类型。
    """

    key: str
    oldValue: Optional[Any] = None
    newValue: Optional[Any] = None
    type: DiffType


class ConfigItemDiff(BaseModel):
    """
    @classdesc 配置项差异模型

    记录单个配置资源（如 schema、constraint）的整体变更，
    包含资源 ID、名称、变更类型以及具体的属性变更列表。
    """

    id: str
    name: str
    type: DiffType
    original: Optional[dict[str, Any]] = None
    generated: Optional[dict[str, Any]] = None
    changes: list[PropertyDiff] = Field(default_factory=list)


class ConfigDiffResult(BaseModel):
    """
    @classdesc 配置差异结果模型

    聚合整个项目配置的差异信息，分别存储 manifest、schemas、constraints、regex_nodes 的变更列表。
    """

    manifest: list[Any] = Field(default_factory=list)
    schemas: list[ConfigItemDiff] = Field(default_factory=list)
    constraints: list[ConfigItemDiff] = Field(default_factory=list)
    regex_nodes: list[ConfigItemDiff] = Field(default_factory=list)


class ConfigDiffService:
    """
    @classdesc 配置差异比对服务

    提供类方法 compare 作为统一入口，支持递归比对 dict/list 嵌套结构，
    识别新增、修改、删除三种差异类型。
    """

    @classmethod
    def compare(cls, old_config: dict[str, Any], new_config: dict[str, Any]) -> ConfigDiffResult:
        """
        @methoddesc 比较两份完整配置并返回差异结果

        参数:
            old_config: 旧配置字典
            new_config: 新配置字典

        返回:
            ConfigDiffResult 差异结果对象
        """
        logger.debug("Starting config comparison")
        result = ConfigDiffResult()

        old_manifest = old_config.get("manifest", {})
        new_manifest = new_config.get("manifest", {})
        if hasattr(old_manifest, "model_dump"):
            old_manifest = old_manifest.model_dump(exclude_none=True)
        if hasattr(new_manifest, "model_dump"):
            new_manifest = new_manifest.model_dump(exclude_none=True)

        result.manifest = cls._diff_recursive(old_manifest, new_manifest, [])

        result.schemas = cls._compare_resources(old_config.get("schemas", {}), new_config.get("schemas", {}))
        result.constraints = cls._compare_resources(
            old_config.get("constraints", {}), new_config.get("constraints", {})
        )
        result.regex_nodes = cls._compare_resources(
            old_config.get("regex_nodes", {}), new_config.get("regex_nodes", {})
        )

        total_changes = len(result.manifest) + len(result.schemas) + len(result.constraints) + len(result.regex_nodes)
        logger.debug(f"Config comparison completed: {total_changes} changes detected")
        return result

    @classmethod
    def _compare_resources(cls, old_resources: dict[str, Any], new_resources: dict[str, Any]) -> list[ConfigItemDiff]:
        """
        @methoddesc 比对资源字典（schemas/constraints/regex_nodes）

        识别新增、删除和修改的资源项。

        参数:
            old_resources: 旧资源字典
            new_resources: 新资源字典

        返回:
            ConfigItemDiff 列表
        """
        result: list[ConfigItemDiff] = []

        old_keys = set(old_resources.keys())
        new_keys = set(new_resources.keys())

        added_keys = new_keys - old_keys
        common_keys = old_keys.intersection(new_keys)

        for key in added_keys:
            new_val = new_resources[key]
            if hasattr(new_val, "model_dump"):
                new_val = new_val.model_dump(exclude_none=True)
            result.append(
                ConfigItemDiff(id=key, name=key, type=DiffType.ADDED, original=None, generated=new_val, changes=[])
            )

        for key in common_keys:
            old_val = old_resources[key]
            new_val = new_resources[key]

            if hasattr(old_val, "model_dump"):
                old_val = old_val.model_dump(exclude_none=True)
            if hasattr(new_val, "model_dump"):
                new_val = new_val.model_dump(exclude_none=True)

            changes = cls._build_property_diff(old_val, new_val, [])
            if changes:
                result.append(
                    ConfigItemDiff(
                        id=key, name=key, type=DiffType.MODIFIED, original=old_val, generated=new_val, changes=changes
                    )
                )

        return result

    @classmethod
    def _build_property_diff(cls, old: dict[str, Any], new: dict[str, Any], path: list[str]) -> list[PropertyDiff]:
        """
        @methoddesc 递归构建属性级差异列表

        深度遍历字典结构，对比每个键值对的变更。

        参数:
            old: 旧字典
            new: 新字典
            path: 当前路径前缀

        返回:
            PropertyDiff 列表
        """
        changes: list[PropertyDiff] = []

        if not isinstance(old, dict) or not isinstance(new, dict):
            return changes

        old_keys = set(old.keys())
        new_keys = set(new.keys())

        for key in new_keys - old_keys:
            changes.append(
                PropertyDiff(
                    key=".".join(path + [key]) if path else key, oldValue=None, newValue=new[key], type=DiffType.ADDED
                )
            )

        for key in old_keys - new_keys:
            changes.append(
                PropertyDiff(
                    key=".".join(path + [key]) if path else key, oldValue=old[key], newValue=None, type=DiffType.DELETED
                )
            )

        for key in old_keys.intersection(new_keys):
            old_v = old[key]
            new_v = new[key]

            if isinstance(old_v, dict) and isinstance(new_v, dict):
                changes.extend(cls._build_property_diff(old_v, new_v, path + [key]))
            elif old_v != new_v:
                changes.append(
                    PropertyDiff(
                        key=".".join(path + [key]) if path else key,
                        oldValue=old_v,
                        newValue=new_v,
                        type=DiffType.MODIFIED,
                    )
                )

        return changes

    @classmethod
    def _diff_recursive(cls, old: Any, new: Any, path: list[Union[str, int]]) -> list[Any]:
        """
        @methoddesc 递归比对任意数据结构

        支持 dict、list 和基本类型的深层比对。

        参数:
            old: 旧值
            new: 新值
            path: 当前路径

        返回:
            变更字典列表
        """
        changes = []

        if isinstance(old, dict) and isinstance(new, dict):
            old_keys = set(old.keys())
            new_keys = set(new.keys())

            for key in new_keys - old_keys:
                changes.append({"path": path + [key], "old_value": None, "new_value": new[key], "diff_type": "added"})

            for key in old_keys - new_keys:
                changes.append({"path": path + [key], "old_value": old[key], "new_value": None, "diff_type": "removed"})

            for key in old_keys.intersection(new_keys):
                changes.extend(cls._diff_recursive(old[key], new[key], path + [key]))

        elif isinstance(old, list) and isinstance(new, list):
            len_old = len(old)
            len_new = len(new)

            for i in range(min(len_old, len_new)):
                changes.extend(cls._diff_recursive(old[i], new[i], path + [i]))

            if len_new > len_old:
                for i in range(len_old, len_new):
                    changes.append({"path": path + [i], "old_value": None, "new_value": new[i], "diff_type": "added"})

            if len_old > len_new:
                for i in range(len_new, len_old):
                    changes.append({"path": path + [i], "old_value": old[i], "new_value": None, "diff_type": "removed"})

        else:
            if old != new:
                changes.append({"path": path, "old_value": old, "new_value": new, "diff_type": "modified"})

        return changes
