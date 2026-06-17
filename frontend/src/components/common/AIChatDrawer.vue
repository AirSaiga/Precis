<!--
  @file AIChatDrawer.vue
  @description AI 助手聊天抽屉组件

  功能职责：
  - 提供侧边滑出的 AI 聊天交互界面
  - 展示用户与 AI 助手的消息对话记录
  - 支持上下文节点标签的展示与管理（可移除已选节点）
  - 处理用户输入、消息发送及加载状态展示

  关键特性：
  - 基于 Pinia Store 管理聊天状态（drawerVisible、messages、loading、contextNodes）
  - 消息自动滚动到底部
  - 空消息时的占位提示
  - Enter 键快捷发送

  无外部 Props / Emits，状态完全由内部 AI Chat Store 驱动。
-->
<template>
  <!-- 抽屉主体 - 作为布局的一部分，不再需要遮罩层 -->
  <div v-if="store.drawerVisible" class="ai-chat-drawer" :class="{ 'drawer-closing': isClosing }">
    <!-- 抽屉头部 -->
    <div class="drawer-header">
      <div class="header-title">
        <svg
          class="header-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 2v2"></path>
          <path d="M12 20v2"></path>
          <path d="m4.93 4.93 1.41 1.41"></path>
          <path d="m17.66 17.66 1.41 1.41"></path>
          <path d="M2 12h2"></path>
          <path d="M20 12h2"></path>
          <path d="m6.34 17.66-1.41 1.41"></path>
          <path d="m19.07 4.93-1.41 1.41"></path>
          <circle cx="12" cy="12" r="4"></circle>
        </svg>
        <span>{{ t('aiChat.title') }}</span>
      </div>
      <div class="header-actions">
        <label class="agent-mode-toggle">
          <input v-model="store.agentMode" type="checkbox" />
          <span>{{ t('aiChat.agentMode') }}</span>
        </label>
        <button class="close-btn" @click="handleClose">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="messages-container" ref="messagesContainer">
      <div v-if="store.messages.length === 0" class="empty-state">
        <svg
          class="empty-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <div class="empty-text">{{ t('aiChat.emptyMessages') }}</div>
      </div>
      <div
        v-for="message in store.messages"
        :key="message.id"
        class="message"
        :class="message.role"
      >
        <div class="message-avatar">
          <svg
            v-if="message.role === 'user'"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 2v2"></path>
            <path d="M12 20v2"></path>
            <path d="m4.93 4.93 1.41 1.41"></path>
            <path d="m17.66 17.66 1.41 1.41"></path>
            <path d="M2 12h2"></path>
            <path d="M20 12h2"></path>
            <path d="m6.34 17.66-1.41 1.41"></path>
            <path d="m19.07 4.93-1.41 1.41"></path>
            <circle cx="12" cy="12" r="4"></circle>
          </svg>
        </div>
        <div class="message-content">
          <div class="message-text">{{ message.content }}</div>
          <!-- 复制按钮：悬停消息时显示 -->
          <button
            class="message-copy-btn"
            :title="t('aiChat.copy')"
            @click="copyMessage(message.content, message.id)"
          >
            <svg
              v-if="copiedId !== message.id"
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
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
              width="13"
              height="13"
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
          <!-- Agent 工具调用轨迹（仅 agent 模式且存在步骤时显示） -->
          <div
            v-if="message.role === 'assistant' && message.agentMeta && message.agentMeta.tool_steps.length > 0"
            class="agent-trail"
          >
            <span class="agent-trail-label">🔧 {{ message.agentMeta.tool_steps.length }} 步</span>
            <span
              v-for="(step, idx) in message.agentMeta.tool_steps"
              :key="idx"
              class="agent-trail-chip"
              :title="`${step.tool}${step.action_count ? ' · ' + step.action_count + ' 个动作' : ''}`"
            >
              {{ step.label }}{{ step.action_count ? `(${step.action_count})` : '' }}
            </span>
          </div>
          <div class="message-time">{{ formatTime(message.timestamp) }}</div>
        </div>
      </div>
      <div v-if="store.loading" class="message assistant loading">
        <div class="message-avatar">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 2v2"></path>
            <path d="M12 20v2"></path>
            <path d="m4.93 4.93 1.41 1.41"></path>
            <path d="m17.66 17.66 1.41 1.41"></path>
            <path d="M2 12h2"></path>
            <path d="M20 12h2"></path>
            <path d="m6.34 17.66-1.41 1.41"></path>
            <path d="m19.07 4.93-1.41 1.41"></path>
            <circle cx="12" cy="12" r="4"></circle>
          </svg>
        </div>
        <div class="message-content">
          <div class="loading-indicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 上下文标签区 -->
    <div v-if="store.contextNodes.length > 0" class="context-tags">
      <div class="context-label">{{ t('aiChat.contextLabel') }}</div>
      <div class="tags-list">
        <div v-for="node in store.contextNodes" :key="node.id" class="context-tag">
          <span class="tag-icon">🏷️</span>
          <span class="tag-text">{{ node.label || node.type }}</span>
          <button class="tag-remove" @click="store.removeContextNode(node.id)">
            <svg
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-container">
      <textarea
        v-model="inputText"
        class="message-input"
        :placeholder="t('aiChat.inputPlaceholder')"
        @keydown.enter.exact.prevent="handleSend"
        rows="2"
      ></textarea>
      <button class="send-btn" :disabled="!inputText.trim() || store.loading" @click="handleSend">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file AIChatDrawer.vue
   * @description AI 助手聊天抽屉组件
   *
   * 功能职责：
   * - 提供右下角悬浮按钮触发抽屉展开
   * - 显示聊天消息记录
   * - 展示上下文节点标签
   * - 处理用户输入和消息发送
   */

  import { ref, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useAiChatStore } from '../../stores/aiChatStore'
  import { useMessageCopy } from '@/composables/useMessageCopy'

  const { t } = useI18n()
  const store = useAiChatStore()

  const inputText = ref('')
  const messagesContainer = ref<HTMLElement | null>(null)
  const isClosing = ref(false)
  // 当前已复制的消息 ID（用于按钮图标切换反馈）
  const { copiedId, copyMessage } = useMessageCopy()

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const handleSend = async () => {
    const text = inputText.value.trim()
    if (!text || store.loading) return

    inputText.value = ''
    await store.sendMessage(text)

    await nextTick()
    scrollToBottom()
  }

  const scrollToBottom = () => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  }

  const handleClose = () => {
    isClosing.value = true
    setTimeout(() => {
      store.closeDrawer()
      isClosing.value = false
    }, 200)
  }

  watch(
    () => store.messages.length,
    () => {
      nextTick(() => {
        scrollToBottom()
      })
    }
  )
</script>

<style scoped src="./AIChatDrawer.styles.css"></style>
