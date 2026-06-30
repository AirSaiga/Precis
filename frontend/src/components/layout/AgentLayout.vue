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
           空状态引导回归聊天面板内部（输入发生处），避免悬在画布中央位置尴尬 -->
      <section class="agent-chat-pane">
        <AIChatPanel />
      </section>

      <!-- 分隔线（视觉边界，不可拖拽调宽——Agent 模式固定 45/55 比例） -->
      <div class="agent-pane-divider"></div>

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
  import AIChatPanel from '@/components/ai/AIChatPanel.vue'
  import NodeCanvas from '@/components/canvas/NodeCanvas.vue'
  import AppStatusBar from '@/components/layout/AppStatusBar.vue'
  import AppOverlayHost from '@/components/layout/AppOverlayHost.vue'
  import ModeToggle from '@/components/layout/ModeToggle.vue'
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

  @media (max-width: 768px) {
    /* 窄屏下对话面板收窄到 300px，让画布保留更多空间 */
    .agent-chat-pane {
      flex-basis: 300px;
    }
  }
</style>
