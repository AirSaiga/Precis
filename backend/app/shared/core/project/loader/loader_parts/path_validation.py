"""
@fileoverview 路径验证模块

功能概述:
- 验证文件路径是否在项目目录内
- 防止目录遍历攻击 (path traversal attack)
- 确保安全访问文件系统

架构设计:
- 路径解析: 使用 Path.resolve() 获取绝对路径
- 范围检查: 确保解析后的路径以项目根目录开头

输入示例:
    project_root = Path("/path/to/project")
    file_path = Path("/path/to/project/schemas/users.yaml")
    ref_name = "Schema 'users'"

输出示例:
    # 验证通过: 返回 None (无返回值)
    validate_path_inside_project(project_root, file_path, ref_name)
    # 结果: 通过验证，函数正常返回

    # 验证失败: 抛出 ValueError
    validate_path_inside_project(
        Path("/path/to/project"),
        Path("/path/to/project/../etc/passwd"),
        "文件"
    )
    # 结果: 抛出 ValueError("文件路径 '/path/to/project/../etc/passwd' 超出项目根目录范围")

原理说明:
    为什么需要路径验证?
    - 防止用户通过路径穿越 (如 ../../../etc/passwd) 访问项目外的敏感文件
    - 确保所有文件操作都在项目目录内

    验证逻辑:
    1. 解析 file_path 和 project_root 为绝对路径
    2. 检查 file_path 是否以 project_root 开头
    3. 特殊处理: file_path == project_root 允许 (项目根目录本身)

    可能的攻击方式:
    - /path/to/project/../../../etc/passwd
    - /path/to/project/./../etc/passwd
    - /path/to/project/./schemas/../../../etc/passwd

    防御机制:
    - resolve() 会解析 . 和 ..，将路径转换为标准形式
    - 然后检查是否在项目目录范围内
"""

from __future__ import annotations

from pathlib import Path


def validate_path_inside_project(project_root: Path, file_path: Path, ref_name: str = "文件") -> None:
    """@methoddesc 验证文件路径是否在项目目录内

    验证目标:
    - 确保 file_path 不会超出 project_root 范围
    - 防止目录遍历攻击

    输入示例:
        # 合法路径
        project_root = Path("/path/to/project")
        file_path = Path("/path/to/project/schemas/users.yaml")
        ref_name = "Schema 'users'"

        # 非法路径 - 目录遍历
        project_root = Path("/path/to/project")
        file_path = Path("/path/to/project/../other_project/data.yaml")
        ref_name = "数据文件"

    输出示例 (合法):
        # 返回 None，验证通过
        None

    输出示例 (非法):
        # 抛出 ValueError
        ValueError: "数据文件路径 '/path/to/project/../other_project/data.yaml' 超出项目根目录范围"

    异常情况:
        - ValueError: 路径超出项目范围
        - ValueError: 路径无效 (如包含非法字符)
    """
    try:
        # 将传入的路径解析为绝对路径（自动处理 . 和 ..）
        resolved = file_path.resolve()
        project_resolved = project_root.resolve()
        resolved_str = str(resolved)
        project_resolved_str = str(project_resolved)

        # 检查解析后的路径是否以项目根目录开头
        # 允许文件路径等于项目根目录本身（特殊情况）
        if not resolved_str.startswith(project_resolved_str + str(Path("/"))) and resolved_str != project_resolved_str:
            raise ValueError(f"{ref_name}路径 '{file_path}' 超出项目根目录范围")
    except ValueError:
        # 重新抛出 ValueError，保持原始错误信息
        raise
    except Exception as e:
        # 捕获其他异常（如路径格式错误），包装为 ValueError 抛出
        raise ValueError(f"{ref_name}路径 '{file_path}' 无效: {e}")
