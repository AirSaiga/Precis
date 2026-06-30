<template>
  <div class="ai-chat-panel">
    <!-- 顶部工具栏 -->
    <div class="chat-header">
      <span class="chat-title">{{ t('aiChat.title') }}</span>
      <div class="chat-actions">
        <button class="header-btn" @click="handleClear" :title="t('aiChat.clear')">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="3 6 5 6 21 6"></polyline>
            <path
              d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            ></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="chat-messages" ref="messagesRef" @scroll="handleScroll">
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="empty-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            opacity="0.3"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <p class="empty-text">{{ t('aiChat.emptyMessages') }}</p>
        <div class="empty-prompts">
          <button
            v-for="prompt in suggestedPrompts"
            :key="prompt"
            class="empty-prompt-btn"
            @click="useSuggestedPrompt(prompt)"
          >
            {{ prompt }}
          </button>
        </div>
      </div>

      <div v-for="msg in messages" :key="msg.id" class="chat-message" :class="msg.role">
        <div class="message-avatar" :class="msg.role">
          <svg
            v-if="msg.role === 'assistant'"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L9.5 9.5L2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z"></path>
          </svg>
          <span v-else>U</span>
        </div>
        <div class="message-body">
          <!-- 工具轨迹折叠卡（仅有步骤时显示） -->
          <ToolTrailCard
            v-if="msg.role === 'assistant' && hasTrailSteps(msg)"
            :steps="getTrailSteps(msg)"
            :status="getTrailStatus(msg)"
            :completed-turns="getCompletedTurns(msg)"
          />
          <!-- apply_actions 改动确认卡（两阶段确认） -->
          <ApplyConfirmCard
            v-if="msg.role === 'assistant' && msg.streaming?.pendingApply"
            :apply="msg.streaming.pendingApply"
            :on-decide="handleApplyDecide"
          />
          <div v-if="msg.role === 'user'" class="message-content user-content">
            {{ msg.content }}
          </div>
          <div
            v-else-if="displayContent(msg) || !isStreaming(msg)"
            class="message-content ai-content"
            :class="{ 'is-streaming': isStreaming(msg) }"
            v-html="renderMarkdown(displayContent(msg))"
          ></div>
          <!-- 流式光标：内联在内容末尾，紧跟文字 -->
          <span v-if="isStreaming(msg)" class="streaming-cursor"></span>
          <!-- 复制按钮：悬停消息时显示 -->
          <button
            class="message-copy-btn"
            :title="t('aiChat.copy')"
            @click="copyMessage(displayContent(msg), msg.id)"
          >
            <svg
              v-if="copiedId !== msg.id"
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

      <!-- Loading 指示器：仅在非流式等待时显示（流式消息本身已带光标） -->
      <div v-if="loading && !hasStreamingMessage" class="chat-message assistant">
        <div class="message-avatar">AI</div>
        <div class="message-body">
          <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>

    <!-- 上下文标签 -->
    <div v-if="contextNodes.length > 0" class="context-tags">
      <span class="context-label">{{ t('aiChat.contextLabel') }}:</span>
      <span v-for="node in contextNodes" :key="node.id" class="context-tag">
        {{ node.label || node.type }}
        <button class="tag-remove" @click="removeContext(node.id)">&times;</button>
      </span>
    </div>

    <!-- 输入区 -->
    <div class="chat-input-area">
      <textarea
        ref="inputRef"
        v-model="inputText"
        :placeholder="t('aiChat.inputPlaceholder')"
        @keydown="handleKeydown"
        @input="autoResize"
        rows="1"
        :disabled="loading"
      ></textarea>
      <button v-if="loading" class="cancel-btn" :title="t('aiChat.cancel')" @click="handleCancel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2"></rect>
        </svg>
      </button>
      <button v-else class="send-btn" @click="handleSend" :disabled="!inputText.trim() || loading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, nextTick, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useAiChatStore } from '@/stores/aiChatStore'
  import type { ChatMessage } from '@/stores/aiChatStore'
  import type { ToolStep } from '@/composables/shared/useStreamingMessage'
  import { useMessageCopy } from '@/composables/useMessageCopy'
  import MarkdownIt from 'markdown-it'
  import DOMPurify from 'dompurify'
  import hljs from 'highlight.js/lib/core'
  // 按需注册常用语言（避免全量引入增大体积）
  import javascript from 'highlight.js/lib/languages/javascript'
  import python from 'highlight.js/lib/languages/python'
  import sql from 'highlight.js/lib/languages/sql'
  import yaml from 'highlight.js/lib/languages/yaml'
  import json from 'highlight.js/lib/languages/json'
  import bash from 'highlight.js/lib/languages/bash'
  import ToolTrailCard from './ToolTrailCard.vue'
  import ApplyConfirmCard from './ApplyConfirmCard.vue'

  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('python', python)
  hljs.registerLanguage('sql', sql)
  hljs.registerLanguage('yaml', yaml)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('bash', bash)

  const { t } = useI18n()
  const aiChatStore = useAiChatStore()

  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight(str: string, lang: string): string {
      // 代码语法高亮：尝试用 highlight.js，失败则转义返回
      const language = lang && hljs.getLanguage(lang) ? lang : ''
      if (language) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language }).value}</code></pre>`
        } catch {
          // fall through to default
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
    },
  })

  // 覆盖链接渲染规则，过滤危险协议（javascript:/data:/vbscript:）
  const defaultLinkRender =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options)
    }

  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const token = tokens[idx]
    if (!token) return self.renderToken(tokens, idx, options)
    const href = token.attrGet('href')
    if (href && /^(javascript|data|vbscript):/i.test(href.trim())) {
      token.attrSet('href', '#')
    }
    token.attrSet('rel', 'noopener noreferrer')
    token.attrSet('target', '_blank')
    return defaultLinkRender(tokens, idx, options, env, self)
  }

  const messages = computed(() => aiChatStore.messages)
  const loading = computed(() => aiChatStore.loading)
  const contextNodes = computed(() => aiChatStore.contextNodes)
  /** 是否存在正在流式输出的 AI 消息（此时由光标指示进度，不再额外显示 typing-indicator） */
  const hasStreamingMessage = computed(() =>
    messages.value.some((msg) => msg.role === 'assistant' && msg.streaming?.isStreaming)
  )

  const inputText = ref('')
  const inputRef = ref<HTMLTextAreaElement | null>(null)
  const messagesRef = ref<HTMLDivElement | null>(null)
  // 当前已复制的消息 ID（用于按钮图标切换反馈）
  const { copiedId, copyMessage } = useMessageCopy()

  const renderMarkdown = (content: string): string => {
    return DOMPurify.sanitize(md.render(content || ''))
  }

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // 滚动锁定：用户在底部附近时自动滚，上滚查看历史时不强制拉回
  const isNearBottom = ref(true)

  const handleScroll = () => {
    if (messagesRef.value) {
      const { scrollTop, scrollHeight, clientHeight } = messagesRef.value
      // 距底 < 100px 视为"在底部附近"
      isNearBottom.value = scrollHeight - scrollTop - clientHeight < 100
    }
  }

  const scrollToBottom = () => {
    nextTick(() => {
      if (messagesRef.value && isNearBottom.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    })
  }

  watch(() => messages.value.length, scrollToBottom)
  watch(loading, scrollToBottom)

  // textarea 自适应高度（1-6 行）
  const autoResize = () => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto'
      inputRef.value.style.height = `${Math.min(inputRef.value.scrollHeight, 144)}px`
    }
  }

  // 示例 prompt 快捷按钮
  const suggestedPrompts = [
    t('aiChat.suggestion1'),
    t('aiChat.suggestion2'),
    t('aiChat.suggestion3'),
  ]
  const useSuggestedPrompt = (prompt: string) => {
    inputText.value = prompt
    autoResize()
    inputRef.value?.focus()
  }

  const handleSend = async () => {
    const text = inputText.value.trim()
    if (!text || loading.value) return
    inputText.value = ''
    // 重置 textarea 高度
    if (inputRef.value) inputRef.value.style.height = 'auto'
    await aiChatStore.sendMessage(text)
  }

  /** 取消当前流式对话（软取消） */
  const handleCancel = () => {
    void aiChatStore.cancelSendMessage()
  }

  /** 处理 apply_actions 确认/拒绝决策 */
  const handleApplyDecide = async (decision: 'confirm' | 'reject') => {
    await aiChatStore.confirmApply(decision)
  }

  /** 消息是否正在流式输出 */
  const isStreaming = (msg: ChatMessage): boolean => {
    return !!msg.streaming?.isStreaming
  }

  /** 获取消息用于展示的内容：流式中优先读取 streaming.content，完成后用 msg.content */
  const displayContent = (msg: ChatMessage): string => {
    return msg.streaming?.content ?? msg.content
  }

  /** 消息是否有工具轨迹步骤可展示 */
  const hasTrailSteps = (msg: ChatMessage): boolean => {
    // 流式中或已有轨迹（含取消态）都展示
    if (msg.streaming && msg.streaming.toolSteps.length > 0) return true
    if (msg.streaming && msg.streaming.status === 'cancelled') return true
    // 已完成的消息看 agentMeta.tool_steps
    if (!msg.streaming && msg.agentMeta && msg.agentMeta.tool_steps.length > 0) return true
    return false
  }

  /** 获取消息的工具轨迹步骤 */
  const getTrailSteps = (msg: ChatMessage): ToolStep[] => {
    if (msg.streaming) {
      return msg.streaming.toolSteps
    }
    // 已完成：从 agentMeta 转换
    if (msg.agentMeta?.tool_steps) {
      return msg.agentMeta.tool_steps.map((s) => ({
        tool: s.tool,
        label: s.label,
        turn: s.turn,
        actionCount: s.action_count,
        status: 'success' as const,
      }))
    }
    return []
  }

  /** 获取轨迹卡的状态 */
  const getTrailStatus = (msg: ChatMessage): 'streaming' | 'completed' | 'cancelled' | 'error' => {
    if (msg.streaming) return msg.streaming.status
    return 'completed'
  }

  /** 获取取消时的已执行轮次 */
  const getCompletedTurns = (msg: ChatMessage): number => {
    return msg.streaming?.completedTurns ?? 0
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    aiChatStore.clearMessages()
    aiChatStore.clearContext()
  }

  const removeContext = (nodeId: string) => {
    aiChatStore.removeContextNode(nodeId)
  }
</script>

<style scoped src="./AIChatPanel.styles.css"></style>
