# backend/app/cli/shared_services/__init__.py
"""
@fileoverview CLI/TUI 共享薄壳层（Layer 2）

功能概述:
- 收敛 CLI 与 TUI 共用的非核心业务逻辑，确保「改一处即可」
- 三个子模块：project_ops（项目操作）、config_ops（配置操作）、generation_ops（生成/迁移落盘）

架构设计:
- 本包只含纯逻辑与文件 IO，不含任何 UI/交互
- CLI 的 execute() 与 TUI 的 service 都从这里 import，不再复制业务规则
- 核心业务逻辑仍在 app.shared.*（Layer 1），本层只收口「不该复制但不属于核心」的薄壳

接口契约（P0b 冻结，P1/P3/P5 直接 import 不修改）:
    project_ops:     load_history / add_to_history / find_manifest /
                     load_manifest_config / resolve_project_label / open_project / OpenResult
    config_ops:      find_config_file / get_by_dotpath / set_by_dotpath /
                     parse_config_value / list_config_files / load_config_content /
                     check_yaml_syntax / ConfigFileInfo / YamlCheckResult
    generation_ops:  apply_generated_config / scan_data_files / SUPPORTED_EXTENSIONS
"""

from __future__ import annotations

from app.cli.shared_services import config_ops, generation_ops, project_ops

__all__ = ["config_ops", "generation_ops", "project_ops"]
