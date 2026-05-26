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
import { sendAiChatMessage, type ChatHistoryMessage } from '../core/services/httpClient'
import { toastError } from '@/core/toast'
import { processFrontendInstructions } from '@/services/aiChatInstructionService'

/**
 * 聊天消息结构，用于 UI 渲染
 *
 * @property id - 消息唯一标识（UUID）
 * @property role - 消息发送者角色：user 为用户，assistant 为 AI
 * @property content - 消息文本内容
 * @property timestamp - 消息创建时间（ISO 8601 格式）
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
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
 * AI 返回的前端指令，用于自动创建约束等画布操作
 *
 * @property actionType - 指令动作类型（如 createConstraint）
 * @property constraintSpec - 约束规格参数
 * @property constraintSpec.type - 约束类型（如 NotNull、Unique 等）
 * @property constraintSpec.targetNodeId - 目标 Schema 节点 ID
 * @property constraintSpec.tableName - 目标表名
 * @property constraintSpec.targetColumn - 目标列名
 * @property constraintSpec.constraintId - 约束唯一标识
 * @property constraintSpec.isInline - 是否为内嵌约束（可选）
 */
export interface FrontendInstruction {
  actionType: string
  constraintSpec: {
    type: string
    targetNodeId: string
    tableName: string
    targetColumn: string
    constraintId: string
    isInline?: boolean
  }
}

/**
 * AI 聊天 Store 工厂函数
 *
 * 使用 Pinia Setup Store 模式，提供 AI 聊天相关的完整状态管理。
 * 包含抽屉控制、上下文节点管理、消息收发及前端指令处理。
 */
export const useAiChatStore = defineStore('aiChat', () => {
  const { t } = useI18n()

  // --- 核心状态 ---
  /** 抽屉（侧边面板）是否可见 */
  const drawerVisible = ref(false)
  /** 聊天消息列表 */
  const messages = ref<ChatMessage[]>([])
  /** 用户选中的画布节点，作为 AI 对话的上下文 */
  const contextNodes = ref<ContextNode[]>([])
  /** 是否正在等待 AI 响应 */
  const loading = ref(false)

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
    messages.value.push(message)
    return message
  }

  /**
   * 添加 AI 助手消息到聊天列表
   *
   * @param content - AI 回复的文本内容
   * @returns 新创建的消息对象
   */
  function addAssistantMessage(content: string) {
    const message: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
    }
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
   * 发送消息给 AI 并处理响应
   *
   * 完整流程：添加用户消息 → 发送请求 → 添加 AI 回复 → 执行前端指令。
   * 空消息或正在加载时忽略请求。
   *
   * @param content - 用户输入的消息文本
   */
  async function sendMessage(content: string) {
    if (!content.trim() || loading.value) return

    addUserMessage(content)
    loading.value = true

    try {
      const context: ChatContext = {
        hasContext: hasContext.value,
        selectedNodes: contextNodes.value,
      }

      const history = buildChatHistory()
      const response = await sendAiChatMessage(content, context, history)

      if (response.status === 'error') {
        addAssistantMessage(response.reply)
        if (response.error) {
          toastError(response.error)
        }
      } else {
        addAssistantMessage(response.reply)

        const instructions =
          response.frontend_instructions && response.frontend_instructions.length > 0
            ? response.frontend_instructions
            : response.actions || []

        if (instructions.length > 0) {
          await processFrontendInstructions(instructions as FrontendInstruction[])
        }
      }
    } catch (error) {
      logger.error('AI Chat error:', error)
      addAssistantMessage(t('aiChat.errorMessage'))
    } finally {
      loading.value = false
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
  }
})
