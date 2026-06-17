"""
@fileoverview 加载期错误友好文案生成

功能概述:
- 把加载阶段(main.py)产生的技术性异常，转换为面向普通用户的友好 LoadingError 字段
- 统一管理 title / description / fix_hint / severity，避免散落在各处硬编码
- 为每类加载错误提供 i18n key，前端可优先用本地化文案渲染

设计原则:
- 纯函数，返回 dict（可直接解包进 LoadingError 构造参数）
- 文案以用户视角描述问题（"文件找不到了"而非"FileNotFoundError"）
- 原始技术细节保留在 message 字段，前端折叠展示供高级用户排查

覆盖的错误类型:
- 路径校验失败 (PathValidationError)
- 文件不存在 (NotFound)
- 文件解析失败 (ParseError) — 含 YAML 语法 / Pydantic 校验两种子类
- 模板展开失败 (TemplateExpansionError)
"""

from __future__ import annotations

import os

# 文件类型 → 中文友好名称映射（用于文案插值）
_RESOURCE_LABELS: dict[str, str] = {
    "schema": "数据表定义",
    "constraint": "约束规则",
    "regex": "正则规则",
    "transform": "数据转换",
    "template": "模板",
}


def _resource_label(file_type: str) -> str:
    """获取文件类型的友好中文名称，未知类型回退到原名。"""
    key = (file_type or "").lower()
    return _RESOURCE_LABELS.get(key, file_type or "配置文件")


def path_validation_error(file_type: str, ref_id: str, raw_message: str) -> dict:
    """路径校验失败（路径越界/非法字符等）。

    Args:
        file_type: 文件类型（schema/constraint/...）
        ref_id: manifest 中的引用 ID
        raw_message: 原始异常字符串（保留供排查）

    Returns:
        LoadingError 友好字段 dict（title/description/fix_hint/severity 等）
    """
    label = _resource_label(file_type)
    return {
        "severity": "blocker",
        "title": f"{label}的路径存在问题",
        "description": f"项目清单里指向「{label}」的路径（编号 {ref_id}）无法被安全访问。这通常是路径写错了，或指向了项目目录之外的位置。",
        "fix_hint": "请检查项目清单中该资源的 path 是否正确，确保它指向项目目录内的文件。",
        "message": raw_message,
        "title_key": "inspection.issues.load.pathValidation.title",
        "description_key": "inspection.issues.load.pathValidation.description",
        "fix_hint_key": "inspection.issues.load.pathValidation.fixHint",
        "message_params": {"resourceLabel": label, "refId": ref_id},
    }


def file_not_found_error(file_type: str, ref_id: str, file_path: str) -> dict:
    """引用的文件不存在。

    Args:
        file_type: 文件类型
        ref_id: manifest 中的引用 ID
        file_path: 缺失的文件绝对路径

    Returns:
        LoadingError 友好字段 dict
    """
    label = _resource_label(file_type)
    # 文件名单独抽出，避免长路径直接糊在描述里
    filename = os.path.basename(file_path) if file_path else ""
    return {
        "severity": "blocker",
        "title": f"{label}文件找不到了",
        "description": f"项目清单里引用的「{label}」（编号 {ref_id}）对应的文件「{filename or file_path}」不存在。可能文件被移动、删除或改名了。",
        "fix_hint": "请确认该文件是否还在，或从项目清单中移除这条已经失效的引用。",
        "message": f"{file_type} 文件不存在: {file_path}",
        "title_key": "inspection.issues.load.notFound.title",
        "description_key": "inspection.issues.load.notFound.description",
        "fix_hint_key": "inspection.issues.load.notFound.fixHint",
        "message_params": {"resourceLabel": label, "refId": ref_id, "filename": filename},
    }


def parse_error(file_type: str, ref_id: str, file_path: str, raw_exception: BaseException) -> dict:
    """文件解析失败（YAML 语法错或 Pydantic 校验错）。

    把冗长的原始异常归类为两种用户可理解的子类，原始信息保留在 message。

    Args:
        file_type: 文件类型
        ref_id: manifest 中的引用 ID
        file_path: 出错文件路径
        raw_exception: 原始异常对象

    Returns:
        LoadingError 友好字段 dict
    """
    label = _resource_label(file_type)
    raw_text = str(raw_exception)
    # 区分 YAML 语法错误 vs 字段校验错误，给出不同的修复方向
    is_yaml_syntax = _looks_like_yaml_error(raw_exception, raw_text)
    if is_yaml_syntax:
        fix_hint = "请打开文件检查 YAML 缩进、冒号、引号是否正确，尤其是列表和键值对的格式。"
        desc = (
            f"「{label}」（编号 {ref_id}）的文件无法按配置格式解析，通常是 YAML 语法写错了（比如缩进不对、漏了冒号）。"
        )
    else:
        fix_hint = "请打开文件检查必填字段是否完整、取值是否符合规范，参考同类型的其他配置文件。"
        desc = f"「{label}」（编号 {ref_id}）的文件格式不对，缺少必要字段或字段取值不符合要求。"

    return {
        "severity": "blocker",
        "title": f"{label}文件内容格式有误",
        "description": desc,
        "fix_hint": fix_hint,
        "message": f"{file_type} 文件解析失败: {raw_text}",
        "title_key": "inspection.issues.load.parseError.title",
        "description_key": "inspection.issues.load.parseError.description",
        "fix_hint_key": "inspection.issues.load.parseError.fixHint",
        "message_params": {"resourceLabel": label, "refId": ref_id},
    }


def template_expansion_error(instance_id: str, raw_exception: BaseException) -> dict:
    """模板展开失败。

    Args:
        instance_id: 模板实例 ID
        raw_exception: 原始异常

    Returns:
        LoadingError 友好字段 dict
    """
    return {
        "severity": "blocker",
        "title": "模板无法正常展开",
        "description": f"画布上的模板（编号 {instance_id}）在展开成具体规则时出错了。可能是模板参数没填全，或模板定义本身有问题。",
        "fix_hint": "请检查该模板的参数是否完整、引用的列/表是否存在，必要时删除该模板重新创建。",
        "message": f"模板实例 '{instance_id}' 展开失败: {raw_exception}",
        "title_key": "inspection.issues.load.templateExpansion.title",
        "description_key": "inspection.issues.load.templateExpansion.description",
        "fix_hint_key": "inspection.issues.load.templateExpansion.fixHint",
        "message_params": {"instanceId": instance_id},
    }


def _looks_like_yaml_error(exc: BaseException, text: str) -> bool:
    """判断异常是否为 YAML 语法错误（而非字段校验错误）。"""
    # yaml.YAMLError 及其子类
    if exc.__class__.__module__.startswith("yaml"):
        return True
    # 文本特征：YAML 错误通常含 "while parsing"/"mapping"/"expected"/"found character" 等
    lowered = text.lower()
    yaml_markers = (
        "while parsing",
        "mapping values are not allowed",
        "could not determine a constructor",
        "found character that cannot start",
        "expected '<document start>'",
        "while scanning",
    )
    return any(m in lowered for m in yaml_markers)
