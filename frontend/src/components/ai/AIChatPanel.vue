<template>
  <div class="ai-chat-panel">
    <!-- 顶部工具栏 -->
    <div class="chat-header">
      <span class="chat-title">{{ t('aiChat.title') }}</span>
      <div class="chat-actions">
        <button class="header-btn" @click="handleClear" :title="t('aiChat.clear')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="chat-messages" ref="messagesRef">
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <p class="empty-text">{{ t('aiChat.emptyMessages') }}</p>
      </div>

      <div v-for="msg in messages" :key="msg.id" class="chat-message" :class="msg.role">
        <div class="message-avatar">
          <span v-if="msg.role === 'user'">U</span>
          <span v-else>AI</span>
        </div>
        <div class="message-body">
          <div v-if="msg.role === 'user'" class="message-content user-content">{{ msg.content }}</div>
          <div v-else class="message-content ai-content" v-html="renderMarkdown(msg.content)"></div>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

      <!-- Loading 指示器 -->
      <div v-if="loading" class="chat-message assistant">
        <div class="message-avatar">AI</div>
        <div class="message-body">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
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
        rows="3"
      ></textarea>
      <button class="send-btn" @click="handleSend" :disabled="!inputText.trim() || loading">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
  import MarkdownIt from 'markdown-it'
  import DOMPurify from 'dompurify'

  const { t } = useI18n()
  const aiChatStore = useAiChatStore()

  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
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

  const inputText = ref('')
  const inputRef = ref<HTMLTextAreaElement | null>(null)
  const messagesRef = ref<HTMLDivElement | null>(null)

  const renderMarkdown = (content: string): string => {
    return DOMPurify.sanitize(md.render(content || ''))
  }

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const scrollToBottom = () => {
    nextTick(() => {
      if (messagesRef.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    })
  }

  watch(() => messages.value.length, scrollToBottom)
  watch(loading, scrollToBottom)

  const handleSend = async () => {
    const text = inputText.value.trim()
    if (!text || loading.value) return
    inputText.value = ''
    await aiChatStore.sendMessage(text)
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
