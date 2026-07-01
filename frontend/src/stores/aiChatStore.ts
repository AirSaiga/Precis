/**
 * @file aiChatStore.ts
 * @description AI 聊天状态管理
 *
 * 职责：
 * - AI 助手对话框的聊天记录管理
 * - 上下文节点（用户选中的画布节点）管理
 * - 消息发送与 AI 响应处理
 * - 前端指令解析与执行（如自动创建约束）
 *
 * 数据流：
 * 用户发送消息 → addUserMessage → sendMessage（POST /ai/chat）
 * → AI 返回回复 + frontend_instructions → addAssistantMessage + processFrontendInstructions
 */

import { logger } from '@/core/utils/logger'
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { useI18n } from 'vue-i18n'
import { type AgentMeta, type ChatHistoryMessage } from '../core/services/httpClient'
import { createSSEClient, type SSEClient } from '@/core/services/sseClient'
import {
  useStreamingMessage,
  type StreamingMessage,
} from '@/composables/shared/useStreamingMessage'
import { processFrontendInstructions } from '@/services/aiChatInstructionService'
import { toastError } from '@/core/toast'
import { useProjectStore } from '@/stores/projectStore'

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
 * @property selectedNodes - 用户选中的画布节点列表
 */
export interface ChatContext {
  hasContext: boolean
  selectedNodes: ContextNode[]
}

/**
 * 约束规格参数（约束指令的 spec 部分）
 */
export interface ConstraintSpec {
  type: string
  targetNodeId: string
  tableName: string
  targetColumn: string
  targetColumnId?: string
  constraintId: string
  isInline?: boolean
  params?: Record<string, unknown>
}

/**
 * Schema 规格参数（Schema 指令的 spec 部分）
 */
export interface SchemaColumnSpec {
  name: string
  type: string
  id?: string
  constraints?: Record<string, unknown>
}

export interface SchemaSpec {
  name: string
  schemaId?: string
  columns?: Array<SchemaColumnSpec>
  constraints?: Array<Record<string, unknown>>
  source?: Record<string, unknown>
  action?: 'add' | 'update' | 'delete'
}

/**
 * Regex 规格参数（Regex 指令的 spec 部分）
 */
export interface RegexSpec {
  name: string
  regexId?: string
  pattern?: string
  matchMode?: 'full' | 'partial' | 'extract'
  caseSensitive?: boolean
  targetNodeId?: string
  targetColumn?: string
  description?: string
}

/**
 * Transform 规格参数（Transform 指令的 spec 部分）
 */
export interface TransformSpec {
  transformId?: string
  type: string
  description?: string
  inputFromNode?: string
  inputColumn?: string
  params?: Record<string, unknown>
  outputColumns?: string[]
}

/**
 * Settings 规格参数（项目设置指令的 spec 部分）
 */
export interface SettingsSpec {
  category: 'validation' | 'fileProcessing' | 'scriptSecurity'
  settings: Record<string, unknown>
}

/**
 * AI 返回的前端指令，用于自动创建/修改画布节点或项目配置
 *
 * @property actionType - 指令动作类型
 * @property constraintSpec - 约束规格参数（兼容旧字段名）
 */
export interface FrontendInstruction {
  actionType: string
  constraintSpec: ConstraintSpec
  schemaSpec?: SchemaSpec
  regexSpec?: RegexSpec
  transformSpec?: TransformSpec
  settingsSpec?: SettingsSpec
}

/**
 * 流式画布生长去重：从终态全量指令中剔除已通过 frontend_instruction 事件实时应用的指令。
 *
 * 后端 completed 事件携带全量 frontend_instructions 作为兜底（含流式期间已逐条发送的 +
 * dry-result 阶段的兜底产物）。流式期间已应用的指令若再次执行会重复创建画布节点（如约束），
 * 因此需按内容去重。
 *
 * 去重键：以序列化文本（stable stringify）作为身份标识。stable stringify 通过预排序对象键，
 * 使键顺序不同但内容相同的指令视为相等。序列化失败（含循环引用）的指令直接保留（不去重），
 * 以安全兜底——宁可重复应用一条，也不误删未执行的指令。
 *
 * @param all - 终态全量指令（completed/cancelled 携带）
 * @param streamed - 流式期间已实时应用的指令（来自 frontend_instruction 事件）
 * @returns 待执行的"新增"指令（流式期间未处理过的）
 */
export function dedupeStreamedInstructions(
  all: FrontendInstruction[],
  streamed: unknown[]
): FrontendInstruction[] {
  if (streamed.length === 0) return [...all]
  const streamedKeys = new Set<string>()
  for (const s of streamed) {
    const key = stableStringify(s)
    if (key !== null) streamedKeys.add(key)
  }
  const result: FrontendInstruction[] = []
  for (const inst of all) {
    const key = stableStringify(inst)
    // 流式指令集合为空（全部序列化失败）或本条无法序列化时，保留本条（安全兜底）
    if (key === null || streamedKeys.size === 0) {
      result.push(inst)
      continue
    }
    if (!streamedKeys.has(key)) {
      result.push(inst)
    }
  }
  return result
}

/**
 * 稳定序列化：递归排序对象键后 JSON.stringify，使键顺序不影响相等性。
 * 无法序列化（循环引用 / BigInt / 函数 / undefined）时返回 null。
 *
 * 注意：不能用 JSON.stringify(value, keys) 的数组 replacer 形式——它会作为键白名单
 * 递归过滤嵌套对象，破坏深层结构。改为先递归构造"键已排序"的副本，再序列化。
 */
function stableStringify(value: unknown): string | null {
  try {
    return JSON.stringify(sortKeysDeep(value))
  } catch {
    return null
  }
}

/**
 * 递归构造键已排序的副本（深拷贝 + 排序），供稳定序列化使用。
 * 遇到无法 JSON 化的值（undefined / 函数 / symbol / BigInt）会让外层 JSON.stringify 抛错，
 * 由 stableStringify 捕获并返回 null。
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

/**
 * AI 聊天 Store 工厂函数
 *
 * 使用 Pinia Setup Store 模式，提供 AI 聊天相关的完整状态管理。
 * 包含抽屉控制、上下文节点管理、消息收发及前端指令处理。
 */
export const useAiChatStore = defineStore('aiChat', () => {
  const { t } = useI18n()
  const projectStore = useProjectStore()

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
  /** 当前流式会话的 SSE 客户端（用于取消） */
  let currentSSEClient: SSEClient | null = null
  /** 当前流式任务的 job_id（started 事件捕获，供 confirm 端点使用） */
  const currentStreamingJobId = ref<string>('')

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

    try {
      const body = {
        message: content,
        context: {
          hasContext: hasContext.value,
          selectedNodes: contextNodes.value,
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
            // 流式画布生长：apply_actions 落盘后逐条收到 frontend_instruction，
            // 立即执行单条指令（processFrontendInstructions 内部触发 addNodes + 节点级 fitView），
            // 实现 Agent 模式画布实时生长。handleEvent 同时把指令累积到 streamedInstructions，
            // 供 completed 兜底批量路径去重，避免重复应用同一指令。
            if (event === 'frontend_instruction' && data) {
              const instruction = (data as Record<string, unknown>).instruction
              if (instruction) {
                // 异步执行，不阻塞 SSE 事件循环；每条指令独立触发节点级 fitView（相机跟随新节点）
                void processFrontendInstructions([instruction] as FrontendInstruction[]).catch(
                  (e) => logger.error('流式执行 frontend_instruction 失败:', e)
                )
              }
            }
            handleEvent(event, _id, data)
          },
          onError: (err) => {
            logger.error('SSE 错误:', err)
            // 将后端错误映射为用户友好的 i18n 消息
            const msg = err.message || ''
            const isNoProvider =
              msg.includes('No default provider') ||
              msg.includes('no provider') ||
              msg.includes('Provider not found')
            const isNotFound = msg === 'Not Found' || msg.includes('404')
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

      // 流结束后，根据 streaming 状态最终化消息
      assistantMessage.streaming = null

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

      // 处理 frontend_instructions（画布双写）——error/cancelled 也尝试处理已收到的指令。
      // 流式画布生长：已在前端通过 frontend_instruction 事件实时执行的指令会累积在
      // streamedInstructions 中，此处需去重，避免对同一指令二次应用（如重复创建约束节点）。
      // 仅处理流式期间未收到的新增指令（含 dry-result 兜底产物）；去重失败时退化为全量应用。
      const result = streamingMsg.result
      if (result?.frontend_instructions && result.frontend_instructions.length > 0) {
        const allInstructions = result.frontend_instructions as FrontendInstruction[]
        const streamed = streamingMsg.streamedInstructions
        const pending = dedupeStreamedInstructions(allInstructions, streamed)
        if (pending.length > 0) {
          await processFrontendInstructions(pending)
        }
      }

      // 填充 agentMeta（轨迹展示）——error/cancelled 也填充（iterations 从 result 取，无则 0）
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
      }
    } catch (error) {
      logger.error('AI Chat SSE error:', error)
      assistantMessage.streaming = null
      if (!streamingMsg.content) {
        assistantMessage.content = t('aiChat.errorMessage')
      }
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
    try {
      const baseUrl = (await import('@/core/services/httpClient')).getApiBaseUrl()
      await fetch(`${baseUrl}/api/latest/ai/chat/${jobId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
    } catch (error) {
      logger.error('确认 apply_actions 失败:', error)
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
    }
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
    confirmApply,
    currentStreamingJobId,
  }
})
