"""@fileoverview 路径白名单配置管理模块

功能概述:
- 管理允许访问的目录列表，支持配置文件扩展
- 提供新旧格式白名单解析和路径范围检查
"""

import logging
import os
from typing import Any

import yaml

logger = logging.getLogger(__name__)


def _get_whitelist_search_paths() -> list[str]:
    """
    返回白名单配置的候选搜索目录。

    设计说明:
    - 兼容旧实现中基于当前工作目录和用户主目录的查找方式
    - 补充 backend 根目录与仓库根目录，匹配 README 和 `.gitignore` 中
      `.precis/.precis-allowed-paths` 的约定
    - 去重后保持顺序，优先使用更贴近当前项目的目录
    """
    current_file = os.path.abspath(__file__)
    backend_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(current_file)))))
    )
    repo_root = os.path.dirname(backend_root)

    candidates = [
        backend_root,
        os.path.join(backend_root, ".precis"),
        repo_root,
        os.path.join(repo_root, ".precis"),
        os.getcwd(),
        os.path.join(os.getcwd(), ".precis"),
        os.path.expanduser("~"),
    ]

    deduped_paths: list[str] = []
    seen: set[str] = set()
    for path in candidates:
        normalized = os.path.normpath(path)
        if normalized not in seen:
            deduped_paths.append(normalized)
            seen.add(normalized)

    return deduped_paths


def get_allowed_directories() -> list[str]:
    """
    @methoddesc 获取所有允许访问的目录列表

    该函数返回一个包含所有允许访问目录的列表。
    默认包含用户主目录及常见子目录，也可通过配置文件扩展。

    默认允许的目录：
        - 用户主目录 (~)
        - ~/Documents (文档目录)
        - ~/Downloads (下载目录)
        - ~/Desktop (桌面目录)

    配置文件扩展：
        - 额外允许的路径从 .precis-allowed-paths 文件加载

    返回:
        允许访问的目录路径列表（绝对路径）

    使用示例：
        >>> allowed = get_allowed_directories()
        >>> for directory in allowed:
        ...     print(f"允许访问: {directory}")
    """
    allowed_dirs = []

    home_dir = os.path.expanduser("~")
    allowed_dirs.append(home_dir)

    documents_dir = os.path.join(home_dir, "Documents")
    if os.path.exists(documents_dir):
        allowed_dirs.append(documents_dir)

    downloads_dir = os.path.join(home_dir, "Downloads")
    if os.path.exists(downloads_dir):
        allowed_dirs.append(downloads_dir)

    desktop_dir = os.path.join(home_dir, "Desktop")
    if os.path.exists(desktop_dir):
        allowed_dirs.append(desktop_dir)

    allowed_dirs.extend(load_allowed_paths_from_config())

    return allowed_dirs


def load_allowed_paths_from_config() -> list[str]:
    """
    @methoddesc 从配置文件加载额外的允许路径

    该函数会在多个可能的位置查找配置文件：
        1. 项目根目录（模块向上查找）
        2. 当前工作目录
        3. 用户主目录

    配置文件格式（v2.0 - YAML）：
        version: "2.0"
        default_policy: readonly
        paths:
          - path: /data/projects
            policy: admin
            description: 项目数据目录
          - path: /data/shared
            policy: readonly

    返回:
        从配置文件加载的允许路径列表
    """
    config_file_name = ".precis-allowed-paths"

    search_paths = _get_whitelist_search_paths()
    logger.info(f"[WHITELIST-LOAD] 搜索路径列表: {search_paths}")

    allowed_paths = []

    for search_path in search_paths:
        config_path = os.path.join(search_path, config_file_name)
        logger.info(f"[WHITELIST-LOAD] 检查配置文件: {config_path}")

        if os.path.isfile(config_path):
            logger.info(f"[WHITELIST-LOAD] ✅ 找到配置文件: {config_path}")
            try:
                with open(config_path, encoding="utf-8") as f:
                    content = f.read().strip()
                
                logger.info(f"[WHITELIST-LOAD] 配置文件内容前100字符: {content[:100]}")

                if not content:
                    logger.info(f"[WHITELIST-LOAD] 配置文件为空")
                    break

                # 解析 v2.0 YAML 格式配置文件
                try:
                    data = yaml.safe_load(content)
                    if not isinstance(data, dict):
                        logger.error(f"[WHITELIST-LOAD] 配置文件格式错误：根节点必须是 YAML 字典")
                        break
                    
                    version = data.get("version", "")
                    if version != "2.0":
                        logger.error(f"[WHITELIST-LOAD] 不支持的配置版本: {version}，仅支持 v2.0")
                        break
                    
                    logger.info(f"[WHITELIST-LOAD] 使用 v2.0 格式解析")
                    allowed_paths = _parse_new_format(content)
                    
                except yaml.YAMLError as e:
                    logger.error(f"[WHITELIST-LOAD] YAML 解析失败: {e}")
                    break
                
                logger.info(f"[WHITELIST-LOAD] 解析结果: {allowed_paths}")

            except Exception:
                logger.exception("读取白名单配置文件失败")

            break
        else:
            logger.info(f"[WHITELIST-LOAD] ❌ 文件不存在")

    if not allowed_paths:
        logger.info(f"[WHITELIST-LOAD] ️ 未找到任何配置文件或解析失败")
    
    return allowed_paths


def _parse_new_format(content: str) -> list[str]:
    """
    @methoddesc 解析新格式（YAML v2.0）白名单配置文件

    新格式使用 YAML 结构，包含 version、default_policy 和 paths 字段。
    如果 YAML 解析失败或版本号不匹配，自动降级为旧格式解析。

    参数:
        content: 配置文件原始文本内容

    返回:
        解析后的允许路径列表
    """
    try:
        # 安全加载 YAML 内容
        data = yaml.safe_load(content)
        # 如果解析结果不是字典，说明不是有效的 v2.0 格式，降级处理
        if not data or not isinstance(data, dict):
            return _parse_old_format(content)

        # 检查版本号，非 2.0 版本也降级为旧格式
        version = data.get("version", "1.0")
        if version != "2.0":
            return _parse_old_format(content)

        paths_data = data.get("paths", [])
        allowed_paths = []

        # 遍历 paths 列表，支持字符串和字典两种条目格式
        for entry in paths_data:
            if isinstance(entry, str):
                # 纯字符串形式的路径
                path = os.path.normpath(entry)
            elif isinstance(entry, dict):
                # 字典形式，提取 path 字段
                path = os.path.normpath(entry.get("path", ""))
            else:
                # 忽略不支持的条目类型
                continue

            # 只保留非空且存在的路径
            if path and os.path.exists(path):
                allowed_paths.append(path)

        return allowed_paths

    # YAML 语法错误时自动降级为旧格式解析，保证鲁棒性
    except yaml.YAMLError:
        return _parse_old_format(content)


def is_path_in_allowed_directories(file_path: str, must_exist: bool = True) -> bool:
    """
    @methoddesc 检查文件路径是否在允许访问的目录范围内

    该函数是路径安全检查的核心，确保用户只能访问白名单目录中的文件。
    使用路径前缀匹配，确保不能通过符号链接等方式绕过限制。

    参数:
        file_path: 待检查的文件路径
        must_exist: 是否要求文件必须存在。默认为 True（读场景）。
                    若为 False，文件不存在时返回 True（写场景，文件将在验证后创建）。

    返回:
        是否在允许的目录范围内，返回 True 表示允许访问

    检查逻辑：
        1. 如果 must_exist=True 且文件不存在，拒绝访问
        2. 解析文件的真实路径（处理符号链接）
        3. 与所有允许目录进行比较
        4. 使用路径前缀匹配，确保目录边界正确

    边界处理：
        - /home/user/data 允许访问 /home/user/data
        - /home/user/data 允许访问 /home/user/data/file.csv
        - /home/user/data 不允许访问 /home/user_data（需要 /home/user_data/）

    使用示例：
        >>> if is_path_in_allowed_directories("/home/user/data/test.csv"):
        ...     print("允许访问")
    """
    try:
        # 【调试日志】查看传入的文件路径
        logger.info(f"[WHITELIST] 检查路径: {file_path}")
        logger.info(f"[WHITELIST] 文件是否存在: {os.path.exists(file_path)}")
        
        if not os.path.exists(file_path):
            if must_exist:
                logger.info(f"[WHITELIST] 文件不存在，拒绝访问")
                return False
            return True

        resolved_path = os.path.realpath(file_path)
        logger.info(f"[WHITELIST] 解析后的路径: {resolved_path}")

        allowed_dirs = get_allowed_directories()
        logger.info(f"[WHITELIST] 允许的目录列表: {allowed_dirs}")

        for allowed_dir in allowed_dirs:
            allowed_resolved = os.path.realpath(allowed_dir)
            logger.info(f"[WHITELIST] 检查白名单项: {allowed_dir} -> {allowed_resolved}")

            if resolved_path.startswith(allowed_resolved + os.sep) or resolved_path == allowed_resolved:
                logger.info(f"[WHITELIST] ✅ 路径匹配成功: {allowed_dir}")
                return True
            else:
                logger.info(f"[WHITELIST] ❌ 路径不匹配")

        logger.info(f"[WHITELIST] ❌ 所有白名单项都不匹配")
        return False

    except (ValueError, OSError):
        return False


def load_whitelist_config() -> dict[str, Any]:
    """
    @methoddesc 加载完整的白名单配置（包含权限信息）

    在多个候选目录中查找 .precis-allowed-paths 文件，返回完整的配置字典。
    支持自动识别旧格式并转换为新格式的返回结构。

    返回:
        包含 version、default_policy、paths 等字段的字典。
        如果未找到配置文件，返回默认空配置 {"version": "1.0", "paths": []}

    返回结构示例（新格式）：
        {
            "version": "2.0",
            "default_policy": "readonly",
            "paths": [
                {"path": "/data/projects", "policy": "admin", "description": "项目数据目录"}
            ]
        }
    """
    config_file_name = ".precis-allowed-paths"

    # 候选搜索路径：项目根目录、当前工作目录、用户主目录
    search_paths = _get_whitelist_search_paths()

    for search_path in search_paths:
        config_path = os.path.join(search_path, config_file_name)

        # 只在文件存在时尝试读取
        if os.path.isfile(config_path):
            try:
                with open(config_path, encoding="utf-8") as f:
                    content = f.read().strip()

                # 空文件视为空配置
                if not content:
                    return {"version": "1.0", "paths": []}

                # 以 # 开头或不含 version 字段的多行文本，判定为旧格式
                if content.startswith("#") or (not content.startswith("version") and "\n" in content):
                    paths = _parse_old_format(content)
                    # 将旧格式转换为统一的字典结构，默认权限为 readonly
                    return {
                        "version": "1.0",
                        "default_policy": "readonly",
                        "paths": [{"path": p, "policy": "readonly"} for p in paths],
                    }
                else:
                    # 尝试解析为 YAML 新格式
                    data = yaml.safe_load(content)
                    if data and isinstance(data, dict):
                        return data

            except Exception:
                # 记录异常并继续，避免单点配置错误导致服务不可用
                logger.exception("加载白名单配置失败")

    # 未找到任何配置文件时返回默认空配置
    return {"version": "1.0", "paths": []}
