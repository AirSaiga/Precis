"""配置自检公共工具模块。

提供所有检查模块共享的：
- 展示名工具（display helpers）：将数据文件对象转为面向用户的友好显示字符串
- Actions 工具：生成 LoadingError.actions 中的 UI 动作列表
- 列标识符收集工具：递归收集 schema 列 id/name

这些纯函数被 inspector_id_checks / inspector_reference_checks 共享，
是跨检查模块的公共基础设施。
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.shared.core.project.constraint.types import ConstraintFile
    from app.shared.core.project.manual_data.types import ManualDataFile
    from app.shared.core.project.regex.types import RegexNodeFile
    from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
    from app.shared.core.project.transform.types import TransformFile


# ============================================================================
# 常量
# ============================================================================

_UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

_CONSTRAINT_LABELS: dict[str, str] = {
    "NotNull": "非空",
    "Unique": "唯一",
    "AllowedValues": "允许值",
    "ForeignKey": "外键",
    "Conditional": "条件",
    "Scripted": "脚本",
    "Range": "区间",
    "Charset": "字符集",
    "DateLogic": "日期逻辑",
    "Composite": "组合",
}

_PLACEHOLDER_NAMES = {
    "新建",
    "未命名",
    "新建规则",
    "新规则",
    "约束",
    "规则",
    "脚本约束",
    "新建脚本约束",
    "未命名约束",
    "新建正则",
    "正则",
    "constraint",
    "rule",
    "new rule",
}
# 形如"新建XXX规则/约束/正则"这类类型词堆叠、无实质内容的占位值
_PLACEHOLDER_PATTERN = re.compile(r"(新建|未命名|新的?|新增)[\w\u4e00-\u9fa5]*(规则|约束|正则)?")


# ============================================================================
# 展示名工具（display helpers）
# ============================================================================


def is_machine_id(value: str) -> bool:
    """判断一个 id 是否为机器生成的不可读标识（UUID 或冗长编码）。

    这类 id 直接拼进面向用户的文案会变成噪音，应由友好化处理转为中性占位。
    """
    if not value:
        return False
    # 标准 UUID
    if _UUID_PATTERN.match(value):
        return True
    # 较长的 base64url / 编码串（schema id 常见形态，如 sc_ 后接 22 位编码）
    stripped = value.split("_", 1)[-1] if value.startswith(("sc_", "c_", "r_", "t_")) else value
    if len(stripped) >= 20 and re.fullmatch(r"[A-Za-z0-9_\-]+", stripped):
        return True
    return False


def schema_display(schema_file: TableSchemaFile | None, fallback_id: str = "") -> str:
    """生成数据表的友好显示名称。"""
    if schema_file is None:
        id_text = fallback_id or "未知"
        return f"数据表「{id_text}」"
    name = getattr(schema_file, "name", None) or getattr(schema_file, "id", "")
    return f"数据表「{name}」"


def is_meaningful_name(name: str | None) -> bool:
    """判断 description/name 是否对用户有定位价值。

    项目里约束的 description 常被填成"新建脚本约束""未命名规则"这类占位值，
    把它们当"规则名"展示反而误导用户、无法定位。
    """
    if not name:
        return False
    text = name.strip()
    if len(text) < 2:
        return False
    if text.lower() in _PLACEHOLDER_NAMES:
        return False
    if _PLACEHOLDER_PATTERN.fullmatch(text):
        return False
    return True


def constraint_display(cf: ConstraintFile | None) -> str:
    """生成约束规则的友好显示名称。

    优先用有信息量的 description；若 description 是占位垃圾值（如"新建脚本约束"），
    则不展示名字，只给类型标签（如"脚本规则"），避免误导。
    """
    if cf is None:
        return "未知规则"
    label = _CONSTRAINT_LABELS.get(getattr(cf, "type", ""), "规则")
    desc = getattr(cf, "description", None)
    if is_meaningful_name(desc):
        return f"{label}规则「{desc}」"
    return f"{label}规则"


def regex_display(rf: RegexNodeFile | None) -> str:
    """生成正则规则的友好显示名称。"""
    if rf is None:
        return "未知正则规则"
    name = getattr(rf, "name", None) or getattr(rf, "id", "")
    return f"正则规则「{name}」"


def transform_display(tf: TransformFile | None) -> str:
    """生成转换规则的友好显示名称。"""
    if tf is None:
        return "未知转换规则"
    name = getattr(tf, "name", None) or getattr(tf, "id", "")
    return f"转换规则「{name}」"


def manual_data_display(mdf: ManualDataFile | None) -> str:
    """生成 ManualData 节点的友好显示名称。"""
    if mdf is None:
        return "未知 ManualData 节点"
    name = getattr(mdf, "column_name", None) or getattr(mdf, "id", "")
    return f"ManualData 节点「{name}」"


# ============================================================================
# Actions 工具（UI 动作列表构建）
# ============================================================================


def default_actions_for_file(
    file_path: str,
    ref_id: str | None = None,
    include_dismiss: bool = True,
) -> list[dict]:
    """为指向某个文件的错误生成通用动作列表。"""
    actions: list[dict] = []
    if file_path:
        actions.append(
            {
                "type": "open_file",
                "label": "打开文件",
                "label_key": "inspection.actions.openFile",
                "file_path": file_path,
            }
        )
        actions.append(
            {
                "type": "copy",
                "label": "复制文件路径",
                "label_key": "inspection.actions.copyFilePath",
                "text": file_path,
            }
        )
    if ref_id:
        actions.append(
            {
                "type": "copy",
                "label": "复制 ID",
                "label_key": "inspection.actions.copyId",
                "text": ref_id,
            }
        )
    if include_dismiss:
        actions.append(
            {
                "type": "dismiss",
                "label": "忽略",
                "label_key": "inspection.actions.dismiss",
            }
        )
    return actions


def actions_for_node_ref(node_id: str | None) -> list[dict]:
    """为指向画布节点（约束/正则等）的问题生成动作列表。

    核心是提供 navigate（定位到画布节点），让用户能直接跳转到出问题的规则，
    解决"不知道是哪条约束"的定位难题。辅以复制 ID 和忽略。
    """
    actions: list[dict] = []
    if node_id:
        actions.append(
            {
                "type": "navigate",
                "label": "定位到节点",
                "label_key": "inspection.actions.navigateToNode",
                "target": node_id,
            }
        )
        actions.append(
            {
                "type": "copy",
                "label": "复制 ID",
                "label_key": "inspection.actions.copyId",
                "text": node_id,
            }
        )
    actions.append(
        {
            "type": "dismiss",
            "label": "忽略",
            "label_key": "inspection.actions.dismiss",
        }
    )
    return actions


# ============================================================================
# 列标识符收集工具
# ============================================================================


def collect_column_identifiers(columns: list[ColumnSpec]) -> set[str]:
    """递归收集 schema 中所有列的 id 和 name（包括嵌套子列）。"""
    collected: set[str] = set()
    for c in columns or []:
        if c.id is not None:
            collected.add(c.id)
        if c.name is not None:
            collected.add(c.name)
        if c.children:
            collected |= collect_column_identifiers(c.children)
    return collected
