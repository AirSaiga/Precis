"""Chat mini-agent 专用工具模块

5 个工具构成"查-改-验"核心闭环：
- ReadProjectTool:    读取项目概览(查)
- ReadTableTool:      读取表数据样本(查)
- ApplyActionsTool:   执行配置修改(改)
- ValidateTableTool:  执行数据校验(验)
- ReadCanvasTool:     读取画布上实际显示的节点快照(查)
    区别于 read_project 读项目配置文件——解决"配置里有但画布上没有"的同步鸿沟

这些工具与 generation 路径的工具集完全独立：
- 面向"增量改现有项目"场景，而非"从零生成完整配置"
- 不依赖 ConfigGenerationService，仅依赖确认存在的公共后端入口
- 通过 asyncio.to_thread 包装同步入口，避免阻塞事件循环
"""

from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyActionsTool
from app.shared.services.ai.agent.chat_tools.read_canvas import ReadCanvasTool
from app.shared.services.ai.agent.chat_tools.read_project import ReadProjectTool
from app.shared.services.ai.agent.chat_tools.read_table import ReadTableTool
from app.shared.services.ai.agent.chat_tools.validate_table import ValidateTableTool

__all__ = [
    "ApplyActionsTool",
    "ReadCanvasTool",
    "ReadProjectTool",
    "ReadTableTool",
    "ValidateTableTool",
]
