<!--
  @file App.vue
  @description Precis 应用根组件

  职责（拆分后）：
  - 提供应用整体布局框架（ActivityBar + Sidebar + Canvas + Inspector）
  - 编排子组件和 composables
  - 保留少量全局事件处理和初始化逻辑

  已拆分出去的职责：
  - 布局状态与拖拽调宽 → useAppLayout composable
  - 状态栏 → AppStatusBar 组件
  - 全局 Overlay → AppOverlayHost 组件
  - 启动引导（项目路径、键盘快捷键） → useAppBootstrap composable

  布局结构（从左到右）：
  ┌──────┬──────────┬───┬───────────────────────┬───┬──────────┬────────┐
  │ Act. │ Sidebar  │ ↕ │  Tab Bar              │ ↕ │ Inspector│  AI    │
  │ Bar  │ (资源库) │   │  ┌──────────────────┐ │   │  Panel   │ Chat   │
  │ 64px │ 可拖拽宽 │   │  │   NodeCanvas     │ │   │ 可拖拽宽 │ Drawer │
  │      │          │   │  └──────────────────┘ │   │          │        │
  └──────┴──────────┴───┴───────────────────────┴───┴──────────┴────────┘
-->

<template>
  <div class="app-layout" :class="{ 'is-resizing': layout.isLayoutTransitionDisabled.value }">
    <!-- Level 1: Activity Bar (导航条) -->
    <aside
      class="activity-bar"
      :style="{ width: layout.activityBarCollapsed.value ? '0px' : '64px' }"
    >
      <AssetLibraryNav />
    </aside>

    <!-- Level 2: Dynamic Sidebar (侧边面板) -->
    <div
      class="sidebar-panel-container"
      :style="{
        width: layout.sidebarCollapsed.value ? '0px' : layout.sidebarWidth.value + 'px',
        marginLeft: layout.activityBarCollapsed.value ? '-64px' : '0px',
      }"
    >
      <AssetLibrary
        :current-view="currentView"
        @dragstart="handleDragStart"
        @dragend="handleDragEnd"
      />
    </div>

    <!-- 左侧面板拖拽调宽分隔条 -->
    <div
      v-if="!layout.sidebarCollapsed.value"
      class="panel-resize-divider left-resize-divider"
      :class="{ 'is-dragging': layout.isDraggingSidebar.value }"
      @mousedown="(e) => layout.handleMouseDown('sidebar', e)"
    ></div>

    <!-- Level 3: Tabbed Canvas Area (标签式画布区域) -->
    <div class="canvas-tabbed-container" :style="layout.canvasStyle.value">
      <!-- Tab 导航栏 -->
      <div class="tab-bar">
        <div class="tab-list">
          <div
            v-for="(workspace, idx) in canvasStore.workspaces"
            :key="workspace.id"
            class="tab-item"
            :class="{ active: canvasStore.activeWorkspaceId === workspace.id }"
            @click="canvasStore.setActiveWorkspace(workspace.id, graphStore)"
            @dblclick.stop="startRename(workspace)"
          >
            <span class="tab-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </span>
            <!-- 内联重命名输入框：v-if 保证同一时刻最多只有一个渲染 -->
            <input
              v-if="renamingTabId === workspace.id"
              id="tab-rename-input"
              v-model="renameValue"
              class="tab-rename-input"
              @keydown.enter="confirmRename"
              @keydown.escape="cancelRename"
              @blur="confirmRename"
              @click.stop
            />
            <!-- 默认标题：优先显示用户自定义标题，回退到 "工作区 N" 格式 -->
            <span v-else class="tab-title">{{
              workspace.title ||
              t('canvas.workspaceWithIndex', {
                name: t('canvas.workspace'),
                index: workspace.index ?? idx + 1,
              })
            }}</span>
            <span v-if="workspace.hasUnsavedChanges" class="tab-dirty">●</span>
            <!-- 仅多工作区时显示关闭按钮，防止最后一个工作区被关闭导致空白 -->
            <button
              v-if="canvasStore.workspaces.length > 1"
              class="tab-close ui-icon-btn ui-icon-btn--sm ui-icon-btn--danger"
              type="button"
              @click.stop="canvasStore.closeWorkspace(workspace.id, graphStore)"
            >
              ×
            </button>
          </div>
          <button
            class="tab-add ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
            type="button"
            @click="canvasStore.createNewWorkspace(graphStore)"
            title="新建画布工作区"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- 画布容器 -->
      <div class="canvas-area">
        <NodeCanvas />
      </div>
    </div>

    <!-- 右侧面板拖拽调宽分隔条 -->
    <div
      v-if="!layout.rightCollapsed.value"
      class="panel-resize-divider right-resize-divider"
      :class="{ 'is-dragging': layout.isDraggingRight.value }"
      @mousedown="(e) => layout.handleMouseDown('right', e)"
    ></div>

    <!-- 左侧Sidebar Panel切换按钮 -->
    <div class="panel-toggle left-toggle" :style="layout.leftToggleStyle.value">
      <button class="toggle-btn" type="button" @click="layout.toggleSidebar">
        <span class="arrow" :class="{ 'rotate-180': !layout.sidebarCollapsed.value }"> ▶ </span>
      </button>
    </div>

    <!-- 右侧面板切换按钮 -->
    <div class="panel-toggle right-toggle" :style="layout.rightToggleStyle.value">
      <button class="toggle-btn" type="button" @click="layout.toggleRightPanel">
        <span class="arrow" :class="{ 'rotate-180': layout.rightCollapsed.value }"> ▶ </span>
      </button>
    </div>

    <!-- 右侧面板容器 (属性检查器) -->
    <div class="panel-container right-panel" :style="layout.rightPanelStyle.value">
      <InspectorPanel :collapsed="layout.rightCollapsed.value" />
    </div>

    <!-- AI 侧边栏容器（暂时隐藏，使用侧边栏 AI 助手面板替代） -->
    <!-- <AIChatDrawer class="ai-chat-panel" /> -->

    <!-- 全局 Overlay 挂载点 -->
    <AppOverlayHost />

    <!-- 状态栏 -->
    <AppStatusBar @open-project-management="() => overlayHostRef?.openProjectManagement?.()" />

    <!-- AI 悬浮按钮（暂时隐藏） -->
    <!--
    <button
      v-if="!aiChatStore.drawerVisible"
      class="ai-chat-fab ui-icon-btn ui-icon-btn--lg"
      type="button"
      @click="aiChatStore.openDrawer"
      :title="t('aiChat.fabTitle')"
      :style="layout.aiChatFabStyle.value"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
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
    </button>
    -->

    <!-- 拖拽 Ghost：跟随鼠标的资源拖拽预览 -->
    <DragGhost
      v-if="resourceDragStore.isDragging && resourceDragStore.payload"
      :payload="resourceDragStore.payload"
      :mouse-position="mousePosition"
    />
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'

  import { logger } from '@/core/utils/logger'
  import AssetLibraryNav from '@/components/layout/AssetLibraryNav.vue'
  import AssetLibrary from '@/components/layout/AssetLibrary.vue'
  import InspectorPanel from '@/components/layout/InspectorPanel.vue'
  import NodeCanvas from '@/components/canvas/NodeCanvas.vue'
  import DragGhost from '@/components/canvas/DragGhost.vue'
  // import AIChatDrawer from '@/components/common/AIChatDrawer.vue'
  import AppStatusBar from '@/components/layout/AppStatusBar.vue'
  import AppOverlayHost from '@/components/layout/AppOverlayHost.vue'

  import { useAppLayout } from '@/composables/useAppLayout'
  import { useAppBootstrap } from '@/composables/useAppBootstrap'
  import { useTheme } from '@/composables/useTheme'

  import { useCanvasStore, type Workspace } from '@/stores/canvasStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { useResourceDragStore, type ResourceDragPayload } from '@/stores/resourceDragStore'
  // import { useAiChatStore } from '@/stores/aiChatStore'

  const { t } = useI18n()

  // --- Composable 初始化 ---
  // useAppLayout: 管理侧边栏/检查器宽度、拖拽调宽、面板折叠状态
  const layout = useAppLayout()
  // useAppBootstrap: 应用启动引导（项目路径恢复、工作区初始化、键盘快捷键）
  // 返回 bootstrap（onMounted 调用）和 cleanup（onUnmounted 调用）
  const { bootstrap, cleanup } = useAppBootstrap()
  // useTheme: 初始化主题系统（CSS 变量切换）
  useTheme()

  // --- 局部状态 ---

  /** 资源库当前视图模式 */
  const currentView = ref<'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data'>('toolbox')

  /** 拖拽 Ghost 的鼠标位置，实时跟随光标更新 */
  const mousePosition = ref({ x: 0, y: 0 })

  // --- Store 实例 ---
  const canvasStore = useCanvasStore()
  const graphStore = useGraphStore()
  const resourceDragStore = useResourceDragStore()
  // const aiChatStore = useAiChatStore()

  /** OverlayHost 组件引用，用于外部触发弹窗（如状态栏的"打开项目管理"） */
  const overlayHostRef = ref<InstanceType<typeof AppOverlayHost> | null>(null)

  // --- 工作区 Tab 内联重命名 ---

  /** 当前正在重命名的 Tab ID，null 表示未在重命名状态 */
  const renamingTabId = ref<string | null>(null)

  /** 重命名输入框的绑定值 */
  const renameValue = ref('')

  /**
   * 进入内联重命名模式
   *
   * 双击 Tab 标题触发。设置 renamingTabId 后，v-if 切换渲染 input 元素，
   * nextTick 确保 DOM 更新完成后再 focus + select。
   *
   * 使用 document.getElementById 而非模板 ref，
   * 因为 input 在 v-for 内部，Vue 3 的 ref 收集会转为数组类型导致兼容问题。
   */
  const startRename = (workspace: Workspace) => {
    renamingTabId.value = workspace.id
    renameValue.value = workspace.title
    nextTick(() => {
      const input = document.getElementById('tab-rename-input') as HTMLInputElement | null
      if (input) {
        input.focus()
        input.select()
      }
    })
  }

  /**
   * 确认重命名（Enter 键 / 失焦触发）
   *
   * 空白标题视为无效输入，静默忽略（不修改标题也不弹 prompt）。
   * 将 renamingTabId 置 null 退出编辑模式，v-if 切换回 span 显示。
   */
  const confirmRename = () => {
    if (!renamingTabId.value) return
    const trimmed = renameValue.value.trim()
    if (trimmed) {
      canvasStore.renameWorkspace(renamingTabId.value, trimmed)
    }
    renamingTabId.value = null
  }

  /** 取消重命名（Esc 键触发），丢弃输入恢复原标题 */
  const cancelRename = () => {
    renamingTabId.value = null
  }

  // --- 资源拖拽事件 ---

  /** 资源库拖拽开始：将拖拽载荷写入 resourceDragStore，激活 DragGhost 显示 */
  const handleDragStart = (payload: ResourceDragPayload) => {
    resourceDragStore.startDrag(payload)
    logger.debug('🔄 App收到资源拖拽开始事件:', payload)
  }

  /** 资源库拖拽结束：清除拖拽状态，隐藏 DragGhost */
  const handleDragEnd = () => {
    resourceDragStore.endDrag()
    logger.debug('🔄 App收到资源拖拽结束事件')
  }

  // --- 全局自定义事件 ---

  /**
   * 资源库视图切换事件（由 AssetLibraryNav 通过 window.dispatchEvent 触发）
   *
   * 切换 'project' / 'data' 视图，并自动展开侧边栏（如果已折叠）
   */
  const handleViewChange = (event: CustomEvent) => {
    const { view } = event.detail
    currentView.value = view
    if (layout.sidebarCollapsed.value) {
      layout.sidebarCollapsed.value = false
    }
  }

  /**
   * 项目关闭事件（由 ProjectManagementModal 触发）
   *
   * 遍历所有工作区，移除 projectRoot 节点及其关联的边。
   * 保留其他类型的节点（schema、constraint 等），因为用户可能重新打开项目。
   */
  const handleProjectClosed = () => {
    canvasStore.workspaces.forEach((workspace) => {
      if (workspace.nodes) {
        workspace.nodes = workspace.nodes.filter((node: any) => node.type !== 'projectRoot')
      }
      if (workspace.edges) {
        workspace.edges = workspace.edges.filter((edge: any) => {
          const sourceNode = workspace.nodes?.find((n: any) => n.id === edge.source)
          const targetNode = workspace.nodes?.find((n: any) => n.id === edge.target)
          return sourceNode?.type !== 'projectRoot' && targetNode?.type !== 'projectRoot'
        })
      }
    })
  }

  // --- 全局鼠标/窗口事件 ---

  /**
   * 鼠标移动事件：同时服务于面板拖拽调宽和资源拖拽定位
   *
   * - layout.handleMouseMove: 处理侧边栏/检查器的拖拽调宽
   * - mousePosition 更新: 驱动 DragGhost 组件跟随光标
   */
  const handleMouseMove = (evt: MouseEvent) => {
    layout.handleMouseMove(evt)
    if (!resourceDragStore.isDragging) return
    mousePosition.value = { x: evt.clientX, y: evt.clientY }
  }

  /** 窗口 resize 事件：通知 layout 重新计算面板约束（最小/最大宽度） */
  const handleResize = () => {
    layout.handleResize()
  }

  // --- 生命周期 ---

  /**
   * 应用挂载：执行启动引导并注册全局事件监听
   *
   * 事件监听使用 window.addEventListener（而非 EventBus），
   * 因为触发源是深层子组件或 Electron 主进程，需要跨组件层级通信。
   */
  onMounted(async () => {
    try {
      await bootstrap()

      window.addEventListener('viewchange', handleViewChange as EventListener)
      window.addEventListener('project-closed', handleProjectClosed as EventListener)
      window.addEventListener('mousemove', handleMouseMove as EventListener)
      window.addEventListener('resize', handleResize)
    } catch (error) {
      logger.error('初始化工作区失败:', error)
    }
  })

  /** 应用卸载：清理键盘快捷键、拖拽状态和全局事件监听，防止内存泄漏 */
  onUnmounted(() => {
    window.removeEventListener('viewchange', handleViewChange as EventListener)
    window.removeEventListener('project-closed', handleProjectClosed as EventListener)
    window.removeEventListener('mousemove', handleMouseMove as EventListener)
    window.removeEventListener('resize', handleResize)
    cleanup()
  })
</script>

<style scoped src="./App.styles.css"></style>
