"""
@fileoverview 复合约束模块

功能概述:
- 将多个子约束组织为一个逻辑单元，按策略聚合校验结果
- 支持三种逻辑策略：all（全部通过）、any（至少一个通过）、none（全部失败）
- 子约束在配置文件中以内嵌列表形式存储，不生成独立文件

架构设计:
- 继承 Constraint 基类，遵循统一的 validate() 接口
- 递归调用子约束的 validate()，收集结果后按 logic 策略聚合
- 子约束通过工厂递归创建，保持与独立约束相同的运行时类型

输入示例:
    CompositeConstraint(
        sub_constraints=[
            UniqueConstraint(table="users", column=["email"]),
            NotNullConstraint(table="users", column="name"),
        ],
        logic="all",
        refs={"table_id": "users"},
    )

输出示例:
    result = composite.validate(datasets)
    # logic="all" 时，返回所有子约束错误的并集
    # logic="any" 时，若至少一个子约束无错则返回空错误列表
    # logic="none" 时，若全部子约束有错则返回空错误列表
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import Constraint


class CompositeConstraint(Constraint):
    """@classdesc 复合约束

    包含多个子约束，按指定的逻辑策略聚合校验结果。

    字段说明:
        - sub_constraints: 子约束实例列表
        - logic: 聚合策略 ("all" | "any" | "none")
        - refs: 引用区（通常包含 table_id 等）
        - enabled: 是否启用（继承属性）
    """

    def __init__(
        self,
        sub_constraints: list[Constraint],
        logic: str = "all",
        refs: dict[str, Any] | None = None,
        **kwargs: Any,
    ):
        self.sub_constraints = sub_constraints
        self.logic = logic
        self.refs = refs or {}
        # 兼容基类中可能存在的 table 属性访问
        self.table = self.refs.get("table_id")

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs: Any) -> dict[str, Any]:
        """@methoddesc 执行复合约束验证

        遍历所有子约束，递归调用 validate()，然后按 logic 策略聚合结果。

        参数:
            datasets: 数据集字典
            **kwargs: 透传给子约束的额外参数（如 allow_unsafe_eval）

        返回:
            {"errors": [...], "info": {...}}
        """
        # 如果没有子约束，直接视为通过
        if not self.sub_constraints:
            return {"errors": [], "info": {}}

        sub_results: list[dict[str, Any]] = []
        for sub in self.sub_constraints:
            # 跳过未启用的子约束（若子约束有 enabled 属性）
            if not getattr(sub, "enabled", True):
                continue
            result = sub.validate(datasets, **kwargs)
            sub_results.append(result)

        # 如果没有启用的子约束，视为通过
        if not sub_results:
            return {"errors": [], "info": {}}

        all_errors: list[dict[str, Any]] = []
        all_info: dict[str, Any] = {}
        passed_count = 0

        for result in sub_results:
            errors = result.get("errors", [])
            info = result.get("info", {})
            all_info.update(info)
            if not errors:
                passed_count += 1
            else:
                all_errors.extend(errors)

        # 根据 logic 策略决定最终错误列表
        final_errors: list[dict[str, Any]] = []

        if self.logic == "all":
            # 所有子约束都必须通过：返回所有错误的并集
            final_errors = all_errors

        elif self.logic == "any":
            # 至少一个子约束通过即算通过
            if passed_count == 0:
                final_errors = [
                    {
                        "error_type": "CompositeConstraint",
                        "message": (
                            f"复合约束（logic=any）要求至少一个子约束通过，但全部 {len(sub_results)} 个子约束均失败"
                        ),
                        "table": self.table,
                    }
                ]

        elif self.logic == "none":
            # 所有子约束都必须失败才算通过（反向校验）
            if passed_count > 0:
                final_errors = [
                    {
                        "error_type": "CompositeConstraint",
                        "message": (f"复合约束（logic=none）要求全部子约束失败，但有 {passed_count} 个子约束通过"),
                        "table": self.table,
                    }
                ]

        else:
            # 未知逻辑策略，回退到 all 行为
            final_errors = all_errors

        return {"errors": final_errors, "info": all_info}

    def get_constraint_info(self) -> dict[str, Any]:
        """@methoddesc 获取复合约束的元信息"""
        info = super().get_constraint_info()
        info["logic"] = self.logic
        info["sub_constraint_count"] = len(self.sub_constraints)
        return info

    def _get_description(self) -> str:
        """@methoddesc 获取描述信息"""
        return f"Composite 约束（logic={self.logic}，包含 {len(self.sub_constraints)} 个子约束）"
