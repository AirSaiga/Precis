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
  <!-- Web 模式下显示项目选择器 -->
  <ProjectSelector v-if="showProjectSelector" @project-opened="handleProjectOpened" />

  <!-- IDE/Agent 布局切换：out-in 淡入淡出过渡，旧布局先淡出再淡入新布局，
       避免两布局在 flex 容器中重叠导致的尺寸抖动。after-enter 后触发画布重 fitView，
       消除 NodeCanvas 重挂载导致的视口跳变。 -->
  <Transition v-else name="layout-fade" mode="out-in" @after-enter="onLayoutEntered">
    <!-- Agent 模式：AI 对话 + 画布双栏布局（隐藏工具箱） -->
    <AgentLayout v-if="appModeStore.isAgentMode" />

    <!-- IDE 模式：主应用布局（ActivityBar + Sidebar + Canvas + Inspector） -->
    <div
      v-else
      class="app-layout"
      :class="{ 'is-resizing': layout.isLayoutTransitionDisabled.value }"
    >
      <!-- 顶部模式切换浮层（绝对定位居中，悬浮于 tab-bar 之上，避免破坏四栏 flex 布局） -->
      <div class="app-mode-toggle-floating">
        <ModeToggle />
      </div>

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
              :title="t('canvas.newWorkspace')"
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
      <AppStatusBar />

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
  </Transition>

  <!-- 崩溃反馈弹窗:独立于 app-layout(v-else 分支)渲染,
       确保任何界面状态(含项目选择阶段)都能弹出全局崩溃反馈 -->
  <CrashFeedbackModal />
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'

  import { logger } from '@/core/utils/logger'
  import { eventBus } from '@/core/eventBus'
  import { appApi } from '@/core/capabilities/appApi'
  import { fitView } from '@/services/canvas/vueFlowApi'
  import { FITVIEW_DURATION_MS } from '@/services/canvas/animationDurations'
  import AssetLibraryNav from '@/components/layout/AssetLibraryNav.vue'
  import AssetLibrary from '@/components/layout/AssetLibrary.vue'
  import InspectorPanel from '@/components/layout/InspectorPanel.vue'
  import AgentLayout from '@/components/layout/AgentLayout.vue'
  import ModeToggle from '@/components/layout/ModeToggle.vue'
  import NodeCanvas from '@/components/canvas/NodeCanvas.vue'
  import DragGhost from '@/components/canvas/DragGhost.vue'
  // import AIChatDrawer from '@/components/common/AIChatDrawer.vue'
  import AppStatusBar from '@/components/layout/AppStatusBar.vue'
  import AppOverlayHost from '@/components/layout/AppOverlayHost.vue'
  import ProjectSelector from '@/components/project/ProjectSelector.vue'
  import CrashFeedbackModal from '@/components/shared/CrashFeedbackModal.vue'

  import { useAppLayout } from '@/composables/useAppLayout'
  import { useAppBootstrap } from '@/composables/useAppBootstrap'
  import { useTheme } from '@/composables/useTheme'

  import { useCanvasStore, type Workspace } from '@/stores/canvasStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { useAppModeStore } from '@/stores/appModeStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useResourceDragStore, type ResourceDragPayload } from '@/stores/resourceDragStore'
  import { useFeedbackStore } from '@/stores/feedbackStore'
  // import { useAiChatStore } from '@/stores/aiChatStore'

  const { t } = useI18n()

  // --- Store 实例 ---
  const canvasStore = useCanvasStore()
  const graphStore = useGraphStore()
  const appModeStore = useAppModeStore()
  const projectStore = useProjectStore()
  const resourceDragStore = useResourceDragStore()
  const feedbackStore = useFeedbackStore()

  // --- Composable 初始化 ---
  // useAppLayout: 管理侧边栏/检查器宽度、拖拽调宽、面板折叠状态
  const layout = useAppLayout()
  // useAppBootstrap: 应用启动引导（项目路径恢复、工作区初始化、键盘快捷键）
  // 返回 bootstrap（onMounted 调用）和 cleanup（onUnmounted 调用）
  const { bootstrap, cleanup, continueBootstrapAfterProject } = useAppBootstrap()
  // useTheme: 初始化主题系统（CSS 变量切换）
  useTheme()

  // --- 首启/无项目状态 ---
  // 当没有已激活的项目时显示 ProjectSelector；Electron 下若未保存最近项目，
  // 也需要让用户选择项目，避免空画布触发大量失败请求
  const showProjectSelector = ref(!projectStore.isProjectActive)

  // --- 局部状态 ---

  /** 资源库当前视图模式 */
  const currentView = ref<'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data'>(
    'toolbox'
  )

  /** 拖拽 Ghost 的鼠标位置，实时跟随光标更新 */
  const mousePosition = ref({ x: 0, y: 0 })
  // const aiChatStore = useAiChatStore()

  // --- Web 模式：项目选择处理 ---

  /**
   * 用户通过 ProjectSelector 选择项目后的处理。
   * 关闭选择器，继续执行后续引导流程。
   */
  const handleProjectOpened = async (path: string) => {
    try {
      showProjectSelector.value = false
      localStorage.setItem('lastProjectPath', path)
      await continueBootstrapAfterProject(path)
      // Web 模式下 onMounted 因显示 ProjectSelector 而提前 return，未注册全局监听；
      // 项目打开后才具备画布交互环境，需在此补注册，避免 viewchange 等事件无人监听。
      registerGlobalListeners()
    } catch (error) {
      logger.error('[App] Web 模式项目加载失败:', error)
      showProjectSelector.value = true
    }
  }

  /**
   * 布局过渡完成回调（IDE ↔ Agent 切换的 <Transition @after-enter>）。
   *
   * 切换布局时 NodeCanvas 会重挂载，Vue Flow 视口（pan/zoom）随之重置为默认值。
   * 此处在过渡动画结束后、新布局的 NodeCanvas 已就绪时，调用 vueFlowApi.fitView
   * 让画布重新自适应内容，消除重挂载导致的视口跳变（节点偏出视野）。
   * 用 vueFlowApi 桥接（而非 useVueFlow），因为本回调在 store 上下文外执行。
   */
  const onLayoutEntered = () => {
    nextTick(() => {
      try {
        fitView({ padding: 0.2, duration: FITVIEW_DURATION_MS })
      } catch (e) {
        // vueFlowApi 未初始化（如尚无画布实例）时静默忽略，不影响切换
        logger.debug('[App] 布局过渡后 fitView 跳过（画布未就绪）:', e)
      }
    })
  }

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
  const confirmRename = async () => {
    if (!renamingTabId.value) return
    const trimmed = renameValue.value.trim()
    if (trimmed) {
      await canvasStore.renameWorkspace(renamingTabId.value, trimmed)
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
  const handleViewChange = (detail: { view: string }) => {
    currentView.value = detail.view as typeof currentView.value
    if (layout.sidebarCollapsed.value) {
      layout.sidebarCollapsed.value = false
    }
  }

  /**
   * 项目关闭事件（由 ProjectManagementModal 触发）
   *
   * 遍历所有工作区，移除 projectRoot 节点及其关联的边。
   * 活跃工作区走 graphStore.deleteNodes 增量删除路径；
   * 其他工作区快照由 canvasStore 内部过滤，避免业务层直接赋值 workspace.nodes。
   * 保留其他类型的节点（schema、constraint 等），因为用户可能重新打开项目。
   */
  const handleProjectClosed = () => {
    canvasStore.removeNodesFromAllWorkspaces((node) => node.type === 'projectRoot', graphStore)
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
  /**
   * 处理项目关闭事件
   * - 清理所有工作区中的 projectRoot 节点及关联边
   * - Web 模式下关闭项目后返回项目选择页
   */
  const handleProjectClosedEvent = () => {
    handleProjectClosed()
    if (!appApi.canRestoreRecentProject) {
      showProjectSelector.value = true
    }
  }

  /** 注册全局事件监听 */
  const registerGlobalListeners = () => {
    window.addEventListener('mousemove', handleMouseMove as EventListener)
    window.addEventListener('resize', handleResize)
    eventBus.on('viewchange', handleViewChange)
    eventBus.on('project-closed', handleProjectClosedEvent)
  }

  /** 移除全局事件监听 */
  const removeGlobalListeners = () => {
    eventBus.off('viewchange', handleViewChange)
    eventBus.off('project-closed', handleProjectClosedEvent)
    window.removeEventListener('mousemove', handleMouseMove as EventListener)
    window.removeEventListener('resize', handleResize)
  }

  onMounted(async () => {
    try {
      // 启动时补弹上次渲染进程崩溃的待处理记录(Electron 特有)
      // 放在 bootstrap 之前,确保即使 bootstrap 出错崩溃补弹仍有机会展示
      void feedbackStore.loadPendingFromMain()

      await bootstrap()

      // 无论 Electron 还是 Web，只要没有激活项目就显示 ProjectSelector
      if (!projectStore.isProjectActive) {
        showProjectSelector.value = true
        return
      }
      showProjectSelector.value = false

      registerGlobalListeners()
    } catch (error) {
      logger.error('初始化工作区失败:', error)
    }
  })

  /** 应用卸载：清理键盘快捷键、拖拽状态和全局事件监听，防止内存泄漏 */
  onUnmounted(() => {
    // 应用关闭前，将当前画布快照写入磁盘
    canvasStore.saveCurrentCanvasData(graphStore.nodes, graphStore.edges)
    canvasStore.syncWorkspacesToBackend()

    removeGlobalListeners()
    cleanup()
  })
</script>

<style scoped src="./App.styles.css"></style>
