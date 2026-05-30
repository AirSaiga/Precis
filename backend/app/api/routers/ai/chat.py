"""
@fileoverview AI 聊天 API 路由模块

功能概述:
- 提供统一的 AI 聊天接口，支持流式和非流式响应
- 兼容前端 AI Chat 编排器的负载格式
- 提供 OpenAI 兼容的 /chat/completions 端点

架构设计:
- 使用统一的 AI Chat 编排器处理业务逻辑
- 支持通过 X-Project-Config-Path Header 传递项目上下文
- 流式响应使用 SSE 格式返回

输入示例:
    POST /ai/chat
    {
        "message": "分析这个数据文件",
        "context": {"hasContext": false, "selectedNodes": []},
        "history": []
    }

输出示例:
    {
        "status": "success",
        "reply": "分析结果...",
        "actions": [],
        "frontend_instructions": [],
        "error": null
    }
"""

import logging
from typing import Optional

from fastapi import Header, HTTPException
from fastapi.responses import StreamingResponse

from ....shared.services.ai.chat_orchestrator import execute_ai_chat_unified
from ....shared.services.ai.types import ProviderConfig
from ....shared.services.llm.config import loader
from ....shared.services.llm.providers import ChatMessage, ChatRequest, create
from .models import AiChatRequest, AiChatResponse, ChatRequestInput

# 从 router 模块导入 router 实例（与旧代码保持一致）
from .router import router


@router.post("/chat", response_model=AiChatResponse)
async def chat(request: AiChatRequest, x_project_config_path: Optional[str] = Header(None)):
    """
    与前端对齐的 AI 聊天接口

    接收前端特定的负载格式，并使用统一的 AI Chat 编排器来处理。
    先从配置中加载默认 Provider，然后将请求转发给编排器执行。

    Args:
        request: AI 聊天请求，包含消息、上下文和历史记录
        x_project_config_path: 项目配置文件路径（通过 Header 传递，用于编排器上下文）

    Returns:
        包含 AI 回复、状态和前端指令的响应对象
    """
    config = loader.load()

    # 获取默认 provider
    provider_id = config.defaults.get("chat")
    if not provider_id:
        raise HTTPException(400, detail="No default provider configured")

    # 查找 Provider 配置
    provider_cfg = next((p for p in config.providers if p.id == provider_id), None)
    if not provider_cfg:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    # 提取 api_key，兼容 SecretStr
    api_key_val = (
        provider_cfg.api_key.get_secret_value()
        if hasattr(provider_cfg.api_key, "get_secret_value")
        else provider_cfg.api_key
    )

    # 构建 ProviderConfig 给编排器
    provider_config = ProviderConfig(
        id=provider_cfg.id,
        provider=provider_cfg.type,
        api_key=api_key_val,
        base_url=provider_cfg.base_url,
        model=provider_cfg.model,
    )

    # 转换上下文节点（将 Pydantic 模型转为字典）
    context_nodes = [node.model_dump() for node in request.context.selectedNodes]

    # 转换对话历史（将 Pydantic 模型转为简单字典列表）
    history = [{"role": h.role, "content": h.content} for h in (request.history or [])]

    # 调用统一编排器执行 AI 聊天
    try:
        result = await execute_ai_chat_unified(
            message=request.message,
            project_path=x_project_config_path,
            provider_config=provider_config,
            context_nodes=context_nodes,
            history=history,
        )
    except Exception as exc:
        logging.getLogger(__name__).exception("AI chat failed")
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {exc}")

    # 根据编排器结果组装响应
    if not result.success:
        return AiChatResponse(
            status="error", reply=result.reply or "", actions=[], frontend_instructions=[], error=result.error
        )

    return AiChatResponse(
        status="success",
        reply=result.reply,
        actions=result.actions,
        frontend_instructions=result.frontend_instructions,
        error=None,
    )


@router.post("/chat/completions")
async def chat_completions(request: ChatRequestInput):
    """
    OpenAI 兼容的聊天接口

    与 OpenAI API 格式兼容，便于前端使用标准客户端。
    支持流式（SSE）和非流式两种响应模式。

    Args:
        request: OpenAI 兼容格式的聊天请求

    Returns:
        流式模式下返回 SSE 响应，非流式返回 JSON 对象
    """
    config = loader.load()

    provider_id = request.provider_id or config.defaults.get("chat")
    if not provider_id:
        raise HTTPException(400, detail="No provider specified")

    provider_cfg = next((p for p in config.providers if p.id == provider_id), None)
    if not provider_cfg:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    provider = create(provider_cfg)
    # 构建聊天请求对象
    chat_req = ChatRequest(
        messages=[ChatMessage(role=m.role, content=m.content) for m in request.messages],
        model=request.model,
        stream=request.stream,
        temperature=request.temperature,
    )

    if request.stream:
        # 流式响应模式：使用 SSE 格式逐块返回

        async def generate():
            # 发送 SSE 起始事件，标识助手角色
            yield '{"id":"chatcmpl-start","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}\n\n'

            try:
                # 逐块获取流式输出
                async for chunk in provider.chat_stream(chat_req):
                    # 构建 SSE 数据包，格式与 OpenAI 兼容
                    data = {"object": "chat.completion.chunk", "choices": [{"delta": {"content": chunk}}]}
                    import json

                    yield f"data: {json.dumps(data)}\n\n"
            except Exception as exc:
                logging.getLogger(__name__).exception("Chat stream failed")
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"

            # 发送 SSE 结束标记
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    else:
        # 非流式响应模式：直接返回完整结果
        try:
            resp = await provider.chat(chat_req)
        except Exception as exc:
            logging.getLogger(__name__).exception("Chat completion failed")
            raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {exc}")
        return {
            "id": "chatcmpl-local",
            "object": "chat.completion",
            "model": resp.model or provider_cfg.model,
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": resp.content}, "finish_reason": "stop"}
            ],
        }
