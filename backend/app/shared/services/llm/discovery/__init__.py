"""@fileoverview LLM 服务发现模块入口

功能概述:
- 导出本地 LLM 服务扫描相关类（ServiceScanner、DiscoveredService）
- 供 API 层调用以自动发现本地运行的 AI 服务

架构设计:
- 聚合导出 scanner.py 中的公共类和全局实例
- 通过 __all__ 控制对外暴露的接口

输入示例:
    from app.shared.services.llm.discovery import scanner, DiscoveredService

输出示例:
    services = await scanner.scan()
"""

from .scanner import DiscoveredService, ServiceScanner, scanner

__all__ = ["ServiceScanner", "DiscoveredService", "scanner"]
