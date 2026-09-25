/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @file aiChatStore.ts
 * @description AI 聊天状态管理
 *
 * 职责：
 * - AI 助手对话框的聊天记录管理
 * - 上下文节点（用户选中的画布节点）管理
 * - 消息发送与 AI 响应处理
 * - 画布同步：frontend_instruction 变更集信封（v2）入对账队列，磁盘重读重建画布
 *
 * 数据流：
 * 用户发送消息 → addUserMessage → sendMessage（POST /ai/chat/stream SSE）
 * → AI 写盘后逐条 frontend_instruction 信封入 canvasReconcile 队列（画布实时生长）
 * → completed 快照作为权威全量列表整批重放（重复由 planFromChangeSet 末见去重 +
 *    队列 pending coalescing 收敛，重复执行幂等于磁盘）
 * → 队列排空后聚合结果写入 canvasSync 摘要 + 刷新 workspaces 快照
 */

import { logger } from '@/core/utils/logger'
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { useI18n } from 'vue-i18n'
import { type AgentMeta, type ChatHistoryMessage } from '../core/services/httpClient'
import { getApiToken, hasApiToken } from '@/core/services/apiToken'
import { createSSEClient, type SSEClient } from '@/core/services/sseClient'
import {
  useStreamingMessage,
  type StreamingMessage,
} from '@/composables/shared/useStreamingMessage'
import {
  processFrontendInstructions,
  parseChangeSetEnvelope,
  type ChangeSetEnvelope,
  type ReconcileOutcome,
} from '@/services/aiChatInstructionService'
import { aggregateReconcileOutcomes } from '@/services/canvasReconcile/executor'
import { toastError } from '@/core/toast'
import { useProjectStore } from '@/stores/projectStore'
import { useGraphStore } from '@/stores/graphStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { serializeCanvasForAI } from '@/utils/ai/serializeCanvasForAI'
import type { AskResponseBody } from '@/components/ai/AskUserCard.vue'

/**
 * 聊天消息结构，用于 UI 渲染
 *
 * @property id - 消息唯一标识（UUID）
 * @property role - 消息发送者角色：user 为用户，assistant 为 AI
 * @property content - 消息文本内容
 * @property timestamp - 消息创建时间（ISO 8601 格式）
 * @property agentMeta - Agent 模式执行元数据（仅 agent 模式的 assistant 消息可能携带）
 * @property streaming - 流式状态（仅流式进行中的 assistant 消息携带，完成后为 null）
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  /** Agent 模式执行元数据（仅 agent 模式的 assistant 消息可能携带） */
  agentMeta?: AgentMeta | null
  /** 流式状态引用（流式中由 UI 实时读取，完成后置 null） */
  streaming?: StreamingMessage | null
}

/**
 * 上下文节点，记录用户选中的画布节点信息，随消息一起发送给 AI
 *
 * @property id - 画布节点唯一标识
 * @property type - 节点类型（如 schema、constraint 等）
 * @property data - 节点原始数据对象
 * @property label - 节点显示标签（可选）
 */
export interface ContextNode {
  id: string
  type: string
  data: Record<string, unknown>
  label?: string
}

/**
 * 发送给后端的聊天上下文
 *
 * @property hasContext - 是否有选中的上下文节点
 * @property selectedNodes - 用户右键选中的画布节点列表
 * @property canvasNodes - 画布全部业务节点快照（供 read_canvas 工具查询画布真实状态）
 */
export interface ChatContext {
  hasContext: boolean
  selectedNodes: ContextNode[]
  canvasNodes?: ContextNode[]
}

/**
 * AI 聊天 Store 工厂函数
 *
 * 使用 Pinia Setup Store 模式，提供 AI 聊天相关的完整状态管理。
 * 包含抽屉控制、上下文节点管理、消息收发及画布对账（v2 变更集）触发。
 */
export const useAiChatStore = defineStore('aiChat', () => {
  const { t } = useI18n()
  const projectStore = useProjectStore()
  // 延迟取 graphStore：sendMessage 时按需读取最新画布快照，避免循环依赖与初始化时序问题
  const getGraphStore = () => useGraphStore()

  // --- 核心状态 ---
  /** 抽屉（侧边面板）是否可见 */
  const drawerVisible = ref(false)
  /** 聊天消息列表 */
  const messages = ref<ChatMessage[]>([])
  /** 用户选中的画布节点，作为 AI 对话的上下文 */
  const contextNodes = ref<ContextNode[]>([])
  /** 是否正在等待 AI 响应 */
  const loading = ref(false)
  /** 是否启用 Agent 深度模式 */
  const agentMode = ref(true)
  /**
   * 输入框草稿（未发送的文本）。
   *
   * 提升到 store 层：AIChatPanel 在 IDE ↔ Agent 模式切换时会被销毁重建，
   * 局部 ref 的 inputText 会丢失。提升后跨重建保留，用户切换模式不会丢失未发送内容。
   */
  const draftInput = ref('')
  /** 当前流式会话的 SSE 客户端（用于取消） */
  let currentSSEClient: SSEClient | null = null
  /** 当前流式任务的 job_id（started 事件捕获，供 confirm 端点使用） */
  const currentStreamingJobId = ref<string>('')
  /**
   * 飞行中的 frontend_instruction Promise 集合。
   *
   * 流式指令以 fire-and-forget 方式执行（不阻塞 SSE 事件循环），但模式切换前需等待
   * 所有飞行指令落定，避免它们在 NodeCanvas 重建窗口期命中已销毁的 vueFlowApi 单例。
   * 详见 appModeStore.setMode 的 awaitPendingInstructions 调用。
   */
  const pendingInstructionPromises = new Set<Promise<unknown>>()

  // --- 计算属性 ---
  /** 是否有选中的上下文节点 */
  const hasContext = computed(() => contextNodes.value.length > 0)

  // --- Actions: 抽屉控制 ---

  /** 打开 AI 聊天抽屉 */
  function openDrawer() {
    drawerVisible.value = true
  }

  /** 关闭 AI 聊天抽屉 */
  function closeDrawer() {
    // 流式进行中关闭抽屉时，先取消发送（abort SSE + 通知后端停止），避免僵尸后端 + loading 锁死
    if (loading.value) {
      void cancelSendMessage()
    }
    drawerVisible.value = false
  }

  /** 切换 AI 聊天抽屉的可见性 */
  function toggleDrawer() {
    drawerVisible.value = !drawerVisible.value
  }

  // --- Actions: 上下文管理 ---

  /**
   * 添加上下文节点（将用户在画布上选中的节点添加到 AI 对话上下文）
   *
   * 已存在的节点不会重复添加。
   *
   * @param node - 画布节点信息
   */
  function addContextNode(node: ContextNode) {
    const exists = contextNodes.value.some((n) => n.id === node.id)
    if (!exists) {
      // [safe-push] contextNodes 是独立的响应式数组，非 Vue Flow 节点/边
      contextNodes.value.push(node)
    }
  }

  /** 移除指定上下文节点 @param nodeId - 要移除的节点 ID */
  function removeContextNode(nodeId: string) {
    const index = contextNodes.value.findIndex((n) => n.id === nodeId)
    if (index !== -1) {
      contextNodes.value.splice(index, 1)
    }
  }

  /** 清空所有上下文节点 */
  function clearContext() {
    contextNodes.value = []
  }

  // --- Actions: 消息管理 ---

  /**
   * 添加用户消息到聊天列表（自动生成唯一 ID 和时间戳）
   *
   * @param content - 消息文本内容
   * @returns 新创建的消息对象
   */
  function addUserMessage(content: string) {
    const message: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }
    // [safe-push] messages 是独立的响应式数组，非 Vue Flow 节点/边
    messages.value.push(message)
    return message
  }

  /**
   * 添加 AI 助手消息到聊天列表
   *
   * @param content - AI 回复的文本内容
   * @param agentMeta - Agent 模式执行元数据（可选，用于展示工具轨迹）
   * @returns 新创建的消息对象
   */
  function addAssistantMessage(content: string, agentMeta?: AgentMeta | null) {
    const message: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      agentMeta: agentMeta ?? undefined,
    }
    // [safe-push] messages 是独立的响应式数组，非 Vue Flow 节点/边
    messages.value.push(message)
    return message
  }

  /** 清空所有聊天消息 */
  function clearMessages() {
    messages.value = []
  }

  // --- Actions: 发送消息 ---

  /**
   * 构建发送给后端的聊天历史
   *
   * 截取最近 20 条消息，控制 token 消耗避免上下文过长。
   *
   * @returns 精简后的聊天历史消息列表
   */
  function buildChatHistory(): ChatHistoryMessage[] {
    const recentMessages = messages.value.slice(-20)
    return recentMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))
  }

  /**
   * 发送消息给 AI 并处理响应（流式 SSE 版本）
   *
   * 完整流程：添加用户消息 → 创建 placeholder assistant 消息（流式状态）
   * → SSE 连接 /ai/chat/stream → 事件实时更新消息 content/轨迹
   * → completed/cancelled/error 终止处理 frontend_instructions（画布双写）。
   * 空消息或正在加载时忽略请求。
   *
   * @param content - 用户输入的消息文本
   */
  async function sendMessage(content: string) {
    if (!content.trim() || loading.value) return

    addUserMessage(content)
    loading.value = true

    // 在 push placeholder 之前构建 history，避免空 assistant 占位消息 + 用户消息双发污染 prompt
    const history = buildChatHistory()

    // 创建流式状态机 + placeholder assistant 消息（UI 实时读取 streaming 字段）
    const { message: streamingMsg, handleEvent, start } = useStreamingMessage()
    start()
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      agentMeta: null,
      streaming: streamingMsg,
    }
    // [safe-push] messages 是独立的响应式数组，非 Vue Flow 节点/边
    messages.value.push(assistantMessage)

    // 创建 SSE 客户端
    const sseClient = createSSEClient()
    currentSSEClient = sseClient

    // 本消息的变更集对账账本：outcome Promise 聚合出 canvasSync 摘要。
    // 注意不做消息级 seen-set 去重——completed 快照是权威全量列表，重复条目由
    // planFromChangeSet（instructionId 末见去重）与队列 pending coalescing 收敛，
    // 其余重复执行的代价是幂等磁盘重读（终态恒等于磁盘，自愈流式丢帧）
    const reconcileOutcomePromises: Promise<ReconcileOutcome>[] = []
    /** 信封入队（飞行追踪 + 结果聚合） */
    const enqueueEnvelopes = (envelopes: ChangeSetEnvelope[]) => {
      if (envelopes.length === 0) return
      const outcomeP = processFrontendInstructions(envelopes)
      if (!outcomeP) return
      reconcileOutcomePromises.push(outcomeP)
      // 追踪飞行 Promise：模式切换前 awaitPendingInstructions 会等待它们落定，
      // 避免对账操作在 NodeCanvas 重建窗口期命中已销毁的 vueFlowApi 单例
      pendingInstructionPromises.add(outcomeP)
      outcomeP.finally(() => pendingInstructionPromises.delete(outcomeP))
    }

    /**
     * 对账队列排空后的收尾（正常终态与 SSE 异常兜底两路共用）：
     * 聚合本消息全部批次结果 → canvasSync 摘要（有失败时 toast）→ 刷新 workspaces 快照。
     */
    const finalizeCanvasSync = async (): Promise<void> => {
      if (reconcileOutcomePromises.length === 0) return
      try {
        const outcomes = await Promise.all(reconcileOutcomePromises)
        const agg = aggregateReconcileOutcomes(outcomes)
        if (agg.touchedEntityIds.length === 0 && agg.failed.length === 0) return

        streamingMsg.canvasSync = {
          added: agg.added,
          updated: agg.updated,
          removed: agg.removed,
          failed: agg.failed.map((f) => ({ entityId: f.entityId, error: f.error })),
        }
        if (agg.failed.length > 0) {
          // 配置已写盘、画布同步失败——明确告知终态与恢复手段（重载项目以磁盘为准）
          toastError(t('aiChat.canvasSyncFailedMessage'), t('aiChat.canvasSyncFailedTitle'))
        }
        // 快照一致性：把对账后的画布写回当前 Tab 快照并同步后端，
        // 保证重载/切 Tab 不会回退到对账前的状态
        try {
          const graphStore = getGraphStore()
          const canvasStore = useCanvasStore()
          canvasStore.saveCurrentCanvasData(graphStore.nodes, graphStore.edges)
          await canvasStore.syncWorkspacesToBackend()
        } catch (e) {
          logger.warn('[AI Chat] 对账后工作区快照刷新失败（不影响画布本身）:', e)
        }
      } catch (e) {
        logger.warn('[AI Chat] 对账结果汇总失败:', e)
      }
    }

    try {
      const body = {
        message: content,
        context: {
          hasContext: hasContext.value,
          selectedNodes: contextNodes.value,
          // Agent 模式下携带画布全量业务节点快照，供 read_canvas 工具查询画布真实状态。
          // 非 agent 模式无需画布状态，传空数组以省流量。
          canvasNodes: agentMode.value ? serializeCanvasForAI(getGraphStore().nodes) : [],
        },
        history: history,
        agent_mode: agentMode.value,
      }

      const configPath = projectStore.currentPaths?.configPath
      await sseClient.connect(
        '/ai/chat/stream',
        body,
        {
          onEvent: (event, _id, data) => {
            // 捕获 job_id 供 confirm 端点使用
            if (
              event === 'started' &&
              data &&
              typeof (data as Record<string, unknown>).job_id === 'string'
            ) {
              currentStreamingJobId.value = (data as Record<string, unknown>).job_id as string
            }
            // 流式画布生长：apply_actions 落盘后逐条收到 frontend_instruction 信封，
            // 解析入对账队列（磁盘重读幂等重建，队列内 fitView 相机跟随新节点）
            if (event === 'frontend_instruction' && data) {
              const raw = (data as Record<string, unknown>).instruction
              const envelope = parseChangeSetEnvelope(raw)
              if (envelope) {
                enqueueEnvelopes([envelope])
              } else {
                logger.warn('[AI Chat] frontend_instruction 非法信封，已丢弃:', raw)
              }
            }
            handleEvent(event, _id, data)
          },
          onError: (err) => {
            logger.error('SSE 错误:', err)
            // 将后端错误映射为用户友好的 i18n 消息。
            // 后端 detail 已中文化（2026-09 文案治理），旧英文串匹配会失效：
            // 改为按 sseClient 附带的状态码 + 中文化 detail 的关键词判定
            const errWithStatus = err as Error & { status?: number }
            const msg = errWithStatus.message || ''
            // "尚未设置默认的 AI 模型…"、"未找到对应的 AI 模型配置…"、"尚未指定要使用的 AI 模型…" 均含"AI 模型"
            const isNoProvider = msg.includes('AI 模型')
            const isNotFound =
              !isNoProvider && (errWithStatus.status === 404 || msg.includes('404'))
            const userMessage = isNoProvider
              ? t('aiChat.noProviderConfigured')
              : isNotFound
                ? t('aiChat.serviceUnavailable')
                : msg || t('aiChat.errorMessage')
            // 将错误信息写入流式状态，connect 返回后由最终化逻辑处理
            streamingMsg.status = 'error'
            streamingMsg.errorMessage = userMessage
            streamingMsg.isStreaming = false
            // 显示 toast 提示用户
            toastError(userMessage)
          },
          onClose: () => {
            // SSE 流正常关闭（含终止事件）
          },
        },
        {
          headers: configPath ? { 'X-Project-Config-Path': configPath } : undefined,
          // 聊天流禁用自动重连：流断开即结束，避免幽灵后台任务 + 重发完整 body 等同重开对话
          noReconnect: true,
        }
      )

      // 流结束后，根据 streaming 状态最终化消息内容（streaming 引用最后才解除，
      // 中间的 canvasSync 摘要先落 streamingMsg 再迁入 agentMeta）
      if (streamingMsg.status === 'error') {
        // 错误时保留已累积的部分内容（如果有），追加错误提示而非覆盖
        const partialContent = streamingMsg.content || ''
        const errorMsg = streamingMsg.errorMessage || t('aiChat.errorMessage')
        assistantMessage.content = partialContent
          ? `${partialContent}\n\n⚠️ _${errorMsg}_`
          : errorMsg
      } else if (streamingMsg.status === 'cancelled') {
        // 软取消：content 保留已生成的部分，添加取消提示
        const cancelledSuffix = `\n\n_(${t('aiChat.trailCancelledNote', { turns: streamingMsg.completedTurns })})_`
        assistantMessage.content = (streamingMsg.content || '') + cancelledSuffix
      } else {
        // completed 或其他：用 streaming 累积的内容
        assistantMessage.content = streamingMsg.content
      }

      // 终态快照兜底：completed/cancelled 携带全量 frontend_instructions 信封
      //（流式丢失补漏；error/cancelled 也尝试处理已收到的信封）。
      // 快照是权威全量列表，直接整批入队——重复条目由 planFromChangeSet 的
      // instructionId 末见去重与队列 pending coalescing 收敛，重复执行幂等
      //（磁盘重读，终态自愈）；非法形状与流式路径同口径记 warn 后丢弃。
      const result = streamingMsg.result
      if (Array.isArray(result?.frontend_instructions)) {
        const envelopes: ChangeSetEnvelope[] = []
        for (const raw of result.frontend_instructions) {
          const envelope = parseChangeSetEnvelope(raw)
          if (envelope) {
            envelopes.push(envelope)
          } else {
            logger.warn(
              '[AI Chat] completed 快照中的非法指令形状（应为 v2 变更集信封），已丢弃:',
              raw
            )
          }
        }
        enqueueEnvelopes(envelopes)
      }

      // 队列排空：等待本消息全部对账批次落定，聚合结果写入 canvasSync 摘要
      await finalizeCanvasSync()

      // 填充 agentMeta（轨迹展示 + 对账摘要持久化）——error/cancelled 也填充
      //（iterations 从 result 取，无则 0）
      assistantMessage.agentMeta = {
        iterations: result?.iterations ?? 0,
        tool_steps: streamingMsg.toolSteps.map((s) => ({
          tool: s.tool,
          label: s.label,
          turn: s.turn,
          action_count: s.actionCount,
          status: s.status,
          error: s.error,
        })),
        canvas_sync: streamingMsg.canvasSync,
      }

      // 摘要已迁入 agentMeta，解除流式引用（UI 转读 agentMeta）
      assistantMessage.streaming = null
    } catch (error) {
      logger.error('AI Chat SSE error:', error)
      if (!streamingMsg.content) {
        assistantMessage.content = t('aiChat.errorMessage')
      }
      // SSE 异常终态：飞行中的对账批次同样汇总并把 canvasSync 摘要迁入 agentMeta，
      // 之后才解除流式引用——保证 CanvasSyncCard 不消失、也不停在永久的空态。
      // 带 3s 超时兜底：批次理论上必然落定（逐条捕获异常），但异常路径不该为
      // 可能卡住的批次无限挂起 sendMessage（超时后后台汇总继续，摘要容缺）
      await Promise.race([
        finalizeCanvasSync(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ])
      assistantMessage.agentMeta = {
        iterations: streamingMsg.result?.iterations ?? 0,
        tool_steps: streamingMsg.toolSteps.map((s) => ({
          tool: s.tool,
          label: s.label,
          turn: s.turn,
          action_count: s.actionCount,
          status: s.status,
          error: s.error,
        })),
        canvas_sync: streamingMsg.canvasSync,
      }
      assistantMessage.streaming = null
    } finally {
      loading.value = false
      currentSSEClient = null
      currentStreamingJobId.value = ''
    }
  }

  /**
   * 确认或拒绝挂起的 apply_actions 改动（两阶段确认）。
   *
   * @param decision - "confirm" 确认落盘 或 "reject" 拒绝不写
   */
  async function confirmApply(decision: 'confirm' | 'reject') {
    // jobId 优先从 store ref 取（started 事件写入），兜底从最近 streaming 消息取
    let jobId = currentStreamingJobId.value
    if (!jobId) {
      // 从最近一条 assistant 消息的 streaming 状态兜底
      const lastStreamingMsg = [...messages.value]
        .reverse()
        .find((m) => m.role === 'assistant' && m.streaming)
      jobId = lastStreamingMsg?.streaming?.jobId ?? ''
    }
    if (!jobId) {
      logger.warn('confirmApply: 无当前 job_id（started 事件可能丢失）')
      toastError(t('aiChat.sessionErrorRetry'))
      return
    }
    // 从最近 streaming 消息取 apply_id（每次 apply 独立，定位具体待确认项）
    const lastStreamingMsg = [...messages.value]
      .reverse()
      .find((m) => m.role === 'assistant' && m.streaming)
    const applyId = lastStreamingMsg?.streaming?.pendingApply?.applyId
    let response: Response
    try {
      const baseUrl = (await import('@/core/services/httpClient')).getApiBaseUrl()
      response = await fetch(`${baseUrl}/api/latest/ai/chat/${jobId}/confirm`, {
        method: 'POST',
        // 裸 fetch 不经 httpClient 拦截器，须自带 token 头（打包模式 null Origin
        // 的 CORS 预检凭据，缺失会被后端拒绝）
        headers: {
          'Content-Type': 'application/json',
          ...(hasApiToken() ? { 'X-Precis-Auth': getApiToken() } : {}),
        },
        body: JSON.stringify({ decision, ...(applyId ? { apply_id: applyId } : {}) }),
      })
    } catch (error) {
      // 网络层失败（断网/后端不可达）：toast 提示；确认卡片不清理本地状态，
      // pendingApply 仍在（只由 apply_confirmed/apply_rejected SSE 事件清除），
      // 用户可直接重试
      logger.error('确认 apply_actions 失败:', error)
      toastError(t('aiChat.confirmSendFailed'))
      return
    }
    // HTTP 失败（404/500 等）：后端未收到决策，确认卡片不会收到转态事件；
    // toast 提示并保持卡片可重试（此前非 2xx 被当成功，卡片干等超时）
    if (!response.ok) {
      logger.error(`确认 apply_actions HTTP 失败: ${response.status}`)
      toastError(t('aiChat.confirmSendFailed'))
    }
  }

  /**
   * 回答 agent 的 ask_user 提问。
   *
   * POST /respond 把用户回答回传后端，resolve InteractionController 唤醒挂起的 ask_user 协程。
   * 不在此清 pendingAsk——等 user_responded SSE 事件来清（与 confirmApply 一致，保证后端确认后才转态）。
   */
  async function respondToAsk(askId: string, response: AskResponseBody) {
    // jobId 优先从 store ref 取，兜底从最近 streaming 消息取
    let jobId = currentStreamingJobId.value
    if (!jobId) {
      const lastStreamingMsg = [...messages.value]
        .reverse()
        .find((m) => m.role === 'assistant' && m.streaming)
      jobId = lastStreamingMsg?.streaming?.jobId ?? ''
    }
    if (!jobId) {
      logger.warn('respondToAsk: 无当前 job_id（started 事件可能丢失）')
      return
    }
    let resp: Response
    try {
      const baseUrl = (await import('@/core/services/httpClient')).getApiBaseUrl()
      resp = await fetch(`${baseUrl}/api/latest/ai/chat/${jobId}/respond`, {
        method: 'POST',
        // 裸 fetch 不经 httpClient 拦截器，须自带 token 头（同 confirmApply）
        headers: {
          'Content-Type': 'application/json',
          ...(hasApiToken() ? { 'X-Precis-Auth': getApiToken() } : {}),
        },
        body: JSON.stringify({ ask_id: askId, response }),
      })
    } catch (error) {
      // 网络层失败：toast 提示；pendingAsk 不清理（由 user_responded SSE 事件清除），
      // 问答卡保持可重试
      logger.error('回答 ask_user 失败:', error)
      toastError(t('aiChat.respondSendFailed'))
      return
    }
    // HTTP 失败：后端未收到回答，卡片不会转态；toast 提示并保持可重试
    if (!resp.ok) {
      logger.error(`回答 ask_user HTTP 失败: ${resp.status}`)
      toastError(t('aiChat.respondSendFailed'))
    }
  }

  /**
   * 取消当前正在进行的流式 AI 对话（软取消）。
   *
   * 先发 cancel 端点通知后端停止（让 executor 在检查点中断），
   * 再 resolve 挂起的 apply 确认门为 reject（避免协程挂起），最后关闭连接。
   * 已落盘的 apply_actions 改动保留，前端轨迹如实显示已执行步数。
   */
  async function cancelSendMessage() {
    if (!currentSSEClient) return
    // jobId 优先从 store ref 取，兜底从 streaming 消息取
    let jobId = currentStreamingJobId.value
    if (!jobId) {
      const lastStreamingMsg = [...messages.value]
        .reverse()
        .find((m) => m.role === 'assistant' && m.streaming)
      jobId = lastStreamingMsg?.streaming?.jobId ?? ''
    }
    try {
      // 先 resolve 挂起的 apply 确认为 reject（若有挂起）
      await confirmApply('reject')
      // ask 的清理由后端 cancel 端点统一处理（pop_by_job_prefix + resolve skipped），
      // 但前端立即清 pendingAsk（job 已终止，不再等 user_responded 事件）
      const lastStreamingMsgForAsk = [...messages.value]
        .reverse()
        .find((m) => m.role === 'assistant' && m.streaming)
      if (lastStreamingMsgForAsk?.streaming) {
        lastStreamingMsgForAsk.streaming.pendingAsk = null
      }
      // 发 cancel 端点通知后端停止（与 generation/migration 行为一致）
      if (jobId) {
        await currentSSEClient.cancel(jobId)
      }
      // 再关闭 SSE 连接
      currentSSEClient.close()
    } catch (error) {
      logger.error('取消 AI 对话失败:', error)
      // 即使取消端点失败，也确保关闭连接
      currentSSEClient.close()
    } finally {
      // 安全兜底：无论 sendMessage 的 SSE promise 是否 settle，取消路径都释放 loading。
      // 否则若 SSE 卡住且组件已卸载，loading 会永久 true 导致输入框永久禁用。
      loading.value = false
    }
  }

  /**
   * 等待所有飞行中的 frontend_instruction 落定。
   *
   * 模式切换（IDE ↔ Agent）前由 appModeStore.setMode 调用，确保 NodeCanvas 重建窗口期
   * 内没有指令在执行（否则会命中已 resetVueFlowApi 置空的 vueFlowApi 单例）。
   *
   * 带 3s 超时兜底：若某指令因异常卡住（如死循环），不永久阻塞模式切换。
   * 带 3s 超时兜底：若某指令因异常卡住（如死循环），不永久阻塞模式切换。
   * 超时后残留指令仍会继续执行，但由 executor 对 VueFlowApiNotInitializedError
   * 的静默降级保护（记 warn 跳过、不计失败），不会崩溃。
   */
  async function awaitPendingInstructions(): Promise<void> {
    if (pendingInstructionPromises.size === 0) return
    const all = [...pendingInstructionPromises]
    await Promise.race([
      Promise.allSettled(all),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
  }

  // --- 导出 ---
  /**
   * Store 对外暴露的响应式状态与操作方法
   *
   * 状态：drawerVisible / messages / contextNodes / loading / hasContext
   * 操作：抽屉控制、上下文管理、消息管理、消息发送
   */
  return {
    drawerVisible,
    messages,
    contextNodes,
    loading,
    agentMode,
    draftInput,
    hasContext,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    addContextNode,
    removeContextNode,
    clearContext,
    addUserMessage,
    addAssistantMessage,
    clearMessages,
    sendMessage,
    cancelSendMessage,
    awaitPendingInstructions,
    confirmApply,
    respondToAsk,
    currentStreamingJobId,
  }
})
