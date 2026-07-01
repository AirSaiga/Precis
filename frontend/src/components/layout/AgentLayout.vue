<!--
  @file AgentLayout.vue
  @description Agent 模式主布局

  Agent 模式下隐藏 ActivityBar / Sidebar / Inspector 工具箱，
  改为「对话 + 画布」的双栏布局（画布为主舞台）：
  - 左侧 35%：AI 对话面板（复用 AIChatPanel.vue，AI 全自动驱动画布）
  - 右侧 65%：实时生长的画布（NodeCanvas，随 AI 指令逐条生长）

  与 IDE 布局的切换过渡由父级 App.vue 控制（flex-basis/width/opacity 的 CSS transition）。
  顶部 ModeToggle 始终可见，确保随时可切回 IDE 模式。

  布局结构：
  ┌──────────────────────────────────────────────────────────────┐
  │                       ModeToggle（顶部）                       │
  ├───────────────────────┬──────────────────────────────────────┤
  │  AI 对话面板 (35%)     │  画布 (65%)                          │
  │  · 消息列表            │  · NodeCanvas（实时生长）             │
  │  · 输入框              │                                      │
  └───────────────────────┴──────────────────────────────────────┘
-->

<template>
  <div class="agent-layout">
    <!-- 顶部工具栏：模式切换 + 语言/设置 -->
    <header class="agent-layout-header">
      <ModeToggle />
      <div class="header-actions">
        <!-- 语言切换按钮 -->
        <button
          class="header-btn"
          type="button"
          @click="toggleLanguage"
          :title="
            currentLang === 'zh-CN'
              ? t('navigation.languageSwitch.enUS')
              : t('navigation.languageSwitch.zhCN')
          "
        >
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
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path
              d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
            ></path>
          </svg>
          <span class="header-btn-label">{{ currentLang === 'zh-CN' ? '中' : 'EN' }}</span>
        </button>
        <!-- 设置按钮 -->
        <button
          class="header-btn"
          type="button"
          @click="handleSettingsClick"
          :title="t('assetLibrary.activityBar.settings')"
        >
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
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            ></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
      </div>
    </header>

    <!-- Agent 状态条 -->
    <AgentStatusBar :streaming="currentStreaming" :loading="aiChatStore.loading" />

    <!-- 双栏主体：对话 + 画布 -->
    <div class="agent-layout-body">
      <!-- 左侧：AI 对话面板（复用现有 AIChatPanel，去掉 Sidebar 尺寸约束）。
           空状态引导回归聊天面板内部（输入发生处），避免悬在画布中央位置尴尬 -->
      <section class="agent-chat-pane" :style="{ flex: `0 0 ${chatPaneWidth}px` }">
        <AIChatPanel />
      </section>

      <!-- 可拖拽分隔线 -->
      <div
        class="agent-pane-splitter"
        :class="{ 'is-dragging': isDragging }"
        @mousedown="handleMouseDown"
      >
        <div class="splitter-handle" />
      </div>

      <!-- 右侧：实时生长的画布。空状态时不在此处显示引导——
           引导回到聊天面板内（输入发生处），避免悬在画布中央位置尴尬。 -->
      <section class="agent-canvas-pane">
        <NodeCanvas />
      </section>
    </div>

    <!-- 全局 Overlay 挂载点（与 IDE 布局保持一致，确保弹窗/抽屉可用） -->
    <AppOverlayHost />

    <!-- 状态栏 -->
    <AppStatusBar />
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { eventBus } from '@/core/eventBus'
  import { useAiChatStore } from '@/stores/aiChatStore'
  import { useLanguageToggle } from '@/composables/shared'
  import AIChatPanel from '@/components/ai/AIChatPanel.vue'
  import NodeCanvas from '@/components/canvas/NodeCanvas.vue'
  import AppStatusBar from '@/components/layout/AppStatusBar.vue'
  import AppOverlayHost from '@/components/layout/AppOverlayHost.vue'
  import ModeToggle from '@/components/layout/ModeToggle.vue'
  import AgentStatusBar from '@/components/ai/AgentStatusBar.vue'

  const { t } = useI18n()
  const aiChatStore = useAiChatStore()
  const { currentLang, toggleLanguage } = useLanguageToggle()

  const CHAT_PANE_WIDTH_KEY = 'agentChatPaneWidth'
  const MIN_CHAT_WIDTH = 280
  const MAX_CHAT_RATIO = 0.5
  const DEFAULT_RATIO = 0.35

  /** 聊天面板宽度（px） */
  const chatPaneWidth = ref(0)
  /** 是否正在拖拽 */
  const isDragging = ref(false)
  /** 视口宽度 */
  const viewportWidth = ref(window.innerWidth)

  /** 打开设置面板 */
  function handleSettingsClick(): void {
    eventBus.emit('open-settings')
  }

  /** 获取当前流式消息（从最后一条 assistant 消息） */
  const currentStreaming = computed(() => {
    const messages = aiChatStore.messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg && msg.role === 'assistant' && msg.streaming) {
        return msg.streaming
      }
    }
    return null
  })

  /** 从 localStorage 恢复宽度，无则使用默认比例。
   *  持久化值超出当前窗口约束时 clamp 而非丢弃,保留用户偏好的相对宽度。 */
  function restoreWidth(): void {
    const stored = localStorage.getItem(CHAT_PANE_WIDTH_KEY)
    const maxWidth = viewportWidth.value * MAX_CHAT_RATIO
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed) && parsed >= MIN_CHAT_WIDTH) {
        // 超过当前窗口上限时 clamp 到上限,而非 fallback 到默认比例
        chatPaneWidth.value = Math.min(parsed, Math.floor(maxWidth))
        return
      }
    }
    chatPaneWidth.value = Math.floor(viewportWidth.value * DEFAULT_RATIO)
  }

  /** 持久化宽度到 localStorage */
  function persistWidth(): void {
    localStorage.setItem(CHAT_PANE_WIDTH_KEY, String(chatPaneWidth.value))
  }

  /** 鼠标按下：开始拖拽 */
  function handleMouseDown(event: MouseEvent): void {
    event.preventDefault()
    isDragging.value = true
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // RAF 批处理:mousemove 高频触发,合并为每帧一次写入,避免拖拽卡顿(参考 useAppLayout.ts)
  let pendingWidth: number | null = null
  let rafId: number | null = null

  function flushPendingUpdates(): void {
    rafId = null
    if (pendingWidth !== null) {
      chatPaneWidth.value = pendingWidth
      pendingWidth = null
    }
  }

  /** 鼠标移动：clamp 到 [min, max] 并用 RAF 批处理写入 */
  function handleMouseMove(event: MouseEvent): void {
    const maxWidth = viewportWidth.value * MAX_CHAT_RATIO
    // clamp 而非门控冻结:越界时钳到边界值,符合主流拖拽分隔线预期
    const clamped = Math.min(Math.max(event.clientX, MIN_CHAT_WIDTH), Math.floor(maxWidth))
    pendingWidth = clamped
    if (rafId === null) {
      rafId = requestAnimationFrame(flushPendingUpdates)
    }
  }

  /** 鼠标抬起：结束拖拽 */
  function handleMouseUp(): void {
    isDragging.value = false
    // 立即 flush 残留的 pending 宽度,确保最终位置写入并持久化
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (pendingWidth !== null) {
      chatPaneWidth.value = pendingWidth
      pendingWidth = null
    }
    persistWidth()
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  /** 窗口 resize：重新计算约束 */
  function handleResize(): void {
    viewportWidth.value = window.innerWidth
    const maxWidth = viewportWidth.value * MAX_CHAT_RATIO
    if (chatPaneWidth.value > maxWidth) {
      chatPaneWidth.value = Math.floor(maxWidth)
      persistWidth()
    }
  }

  onMounted(() => {
    restoreWidth()
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    window.removeEventListener('resize', handleResize)
  })
</script>

<style scoped>
  .agent-layout {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--ui-bg-canvas);
    position: relative;
  }

  /* 顶部工具栏：模式切换 + 语言/设置 */
  .agent-layout-header {
    flex-shrink: 0;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--ui-space-md);
    background: var(--ui-bg-nav-primary);
    border-bottom: 1px solid var(--ui-border-subtle);
    z-index: 30;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--ui-space-xs);
  }
  .header-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-secondary);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    font-size: var(--ui-font-size-xs);
  }
  .header-btn:hover {
    background: var(--ui-bg-hover);
    color: var(--ui-text-primary);
  }
  .header-btn-label {
    font-weight: var(--ui-font-weight-medium);
  }

  /* 双栏主体：对话 + 画布 */
  .agent-layout-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  /* 聊天面板：宽度由 JS 动态控制 */
  .agent-chat-pane {
    display: flex;
    flex-direction: column;
    min-width: 280px;
    overflow: hidden;
    background: var(--ui-bg-base);
  }

  /* 可拖拽分隔线 */
  .agent-pane-splitter {
    flex: 0 0 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
    background: var(--ui-bg-base);
    border-left: 1px solid var(--ui-border-subtle);
    border-right: 1px solid var(--ui-border-subtle);
    transition: background 0.15s;
  }
  .agent-pane-splitter:hover,
  .agent-pane-splitter.is-dragging {
    background: var(--ui-bg-hover);
  }
  .splitter-handle {
    width: 4px;
    height: 36px;
    border-radius: 2px;
    background: var(--ui-border);
    transition: background 0.15s;
  }
  .agent-pane-splitter:hover .splitter-handle,
  .agent-pane-splitter.is-dragging .splitter-handle {
    background: var(--ui-accent);
  }

  .agent-canvas-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: var(--ui-bg-canvas);
  }

  @media (max-width: 768px) {
    /* 窄屏下对话面板收窄到 280px */
    .agent-chat-pane {
      flex: 0 0 280px !important;
    }
  }
</style>
