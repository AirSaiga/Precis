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
    <!-- 顶部工具栏：模式切换 -->
    <header class="agent-layout-header">
      <ModeToggle />
    </header>

    <!-- 双栏主体：对话 + 画布 -->
    <div class="agent-layout-body">
      <!-- 左侧：AI 对话面板（复用现有 AIChatPanel，去掉 Sidebar 尺寸约束）。
           hideEmptyState：Agent 模式由画布侧统一引导，避免左侧空状态与画布空状态重复 -->
      <section class="agent-chat-pane">
        <AIChatPanel hide-empty-state />
      </section>

      <!-- 分隔线（视觉边界，不可拖拽调宽——Agent 模式固定 45/55 比例） -->
      <div class="agent-pane-divider"></div>

      <!-- 右侧：实时生长的画布 -->
      <section class="agent-canvas-pane">
        <NodeCanvas />
        <!-- 空画布引导覆盖层：仅有 projectRoot（或完全空）时显示，
             指引用户在左侧描述需求；NodeCanvas 渲染在其下，覆盖层绝对定位居中悬浮。
             pointer-events:none 容器 + auto 仅作用于按钮，避免遮挡画布交互。 -->
        <div v-if="!hasContentNodes" class="agent-canvas-empty">
          <div class="agent-canvas-empty-icon">
            <svg
              width="56"
              height="56"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2L9.5 9.5L2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z"></path>
            </svg>
          </div>
          <p class="agent-canvas-empty-title">{{ t('aiChat.emptyCanvas.title') }}</p>
          <p class="agent-canvas-empty-hint">{{ t('aiChat.emptyCanvas.hint') }}</p>
          <div class="agent-canvas-empty-prompts">
            <button
              v-for="prompt in emptyPrompts"
              :key="prompt"
              type="button"
              class="agent-canvas-empty-prompt"
              @click="handleEmptyPrompt(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- 全局 Overlay 挂载点（与 IDE 布局保持一致，确保弹窗/抽屉可用） -->
    <AppOverlayHost />

    <!-- 状态栏 -->
    <AppStatusBar />
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AIChatPanel from '@/components/ai/AIChatPanel.vue'
  import NodeCanvas from '@/components/canvas/NodeCanvas.vue'
  import AppStatusBar from '@/components/layout/AppStatusBar.vue'
  import AppOverlayHost from '@/components/layout/AppOverlayHost.vue'
  import ModeToggle from '@/components/layout/ModeToggle.vue'
  import { useGraphStore } from '@/stores/graphStore'
  import { useAiChatStore } from '@/stores/aiChatStore'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const aiChatStore = useAiChatStore()

  /**
   * 画布是否有"内容节点"：排除 projectRoot（项目加载即创建的根节点）。
   * 仅当无 Schema/约束/正则等实质节点时，显示空画布引导覆盖层。
   */
  const hasContentNodes = computed(() => graphStore.nodes.some((n) => n.type !== 'projectRoot'))

  /** 空画布引导的建议 prompt（可执行引导，点击即发送给 AI） */
  const emptyPrompts = computed(() => [
    t('aiChat.emptyCanvas.prompt1'),
    t('aiChat.emptyCanvas.prompt2'),
  ])

  /** 点击建议 prompt：直接发送给 AI，符合 Agent 模式"全自动驱动"理念 */
  const handleEmptyPrompt = (prompt: string) => {
    void aiChatStore.sendMessage(prompt)
  }
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

  /* 顶部工具栏：容纳 ModeToggle */
  .agent-layout-header {
    flex-shrink: 0;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--ui-space-md);
    background: var(--ui-bg-nav-primary);
    border-bottom: 1px solid var(--ui-border-subtle);
    z-index: 30;
  }

  /* 双栏主体：对话 45% + 画布 55%，flex-basis 支持过渡动画 */
  .agent-layout-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  /* 聊天面板占 35%：Agent 模式画布是主舞台（实时生长），聊天仅为输入区，
     收窄聊天面板让画布获得更大展示空间（55% → 65%）。 */
  .agent-chat-pane {
    flex: 0 0 35%;
    display: flex;
    flex-direction: column;
    min-width: 300px;
    overflow: hidden;
    /* 复用 AIChatPanel.vue，外层容器负责边界与尺寸 */
    background: var(--ui-bg-base);
    transition: flex-basis var(--ui-transition-normal);
  }

  /* 静态分隔线：Agent 模式不提供拖拽调宽（比例固定） */
  .agent-pane-divider {
    flex: 0 0 1px;
    background: var(--ui-border-subtle);
  }

  .agent-canvas-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: var(--ui-bg-canvas);
    transition: flex var(--ui-transition-normal);
  }

  /* 空画布引导覆盖层：绝对定位居中悬浮于 NodeCanvas 之上 */
  .agent-canvas-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--ui-space-sm);
    text-align: center;
    pointer-events: none; /* 容器不拦截，仅按钮可点 */
    z-index: 10;
  }

  .agent-canvas-empty-icon {
    color: var(--ui-text-tertiary);
    opacity: 0.4;
    margin-bottom: var(--ui-space-sm);
  }

  .agent-canvas-empty-title {
    margin: 0;
    font-size: var(--ui-font-size-lg);
    font-weight: 600;
    color: var(--ui-text-secondary);
  }

  .agent-canvas-empty-hint {
    margin: 0;
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-tertiary);
    max-width: 320px;
    line-height: 1.5;
  }

  .agent-canvas-empty-prompts {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-xs);
    margin-top: var(--ui-space-md);
  }

  /* 建议按钮：恢复事件接收（容器已 pointer-events:none） */
  .agent-canvas-empty-prompt {
    pointer-events: auto;
    padding: var(--ui-space-xs) var(--ui-space-md);
    border: 1px solid var(--ui-border-subtle);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-elevated);
    color: var(--ui-text-secondary);
    font-size: var(--ui-font-size-sm);
    cursor: pointer;
    transition:
      border-color var(--ui-transition-fast),
      color var(--ui-transition-fast);
  }

  .agent-canvas-empty-prompt:hover {
    border-color: var(--ui-accent);
    color: var(--ui-text-primary);
  }

  @media (max-width: 768px) {
    /* 窄屏下对话面板收窄到 300px，让画布保留更多空间 */
    .agent-chat-pane {
      flex-basis: 300px;
    }
  }
</style>
