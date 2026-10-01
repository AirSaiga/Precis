<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<!--
  @file App.vue
  @description Precis 应用根组件

  职责（拆分后）：
  - 提供应用整体布局框架（ActivityBar + Sidebar + Canvas + Inspector）
  - 编排子组件和 composables
  - 专注模式（Focus Mode）视图状态编排：进入时快照布局并折叠活动栏/检查器，
    退出时恢复快照——单一布局 + 状态驱动显隐，NodeCanvas / AIChatPanel 不重挂载
  - 保留少量全局事件处理和初始化逻辑

  已拆分出去的职责：
  - 布局状态与拖拽调宽 → useAppLayout composable
  - 状态栏 → AppStatusBar 组件
  - 全局 Overlay → AppOverlayHost 组件
  - 启动引导（项目路径、键盘快捷键） → useAppBootstrap composable

  布局结构（从左到右，专注模式为状态驱动的显隐变体而非独立布局树）：
  ┌──────┬──────────┬───┬───────────────────────┬───┬──────────┐
  │ Act. │ Sidebar  │ ↕ │  Tab Bar              │ ↕ │ Inspector│
  │ Bar  │ (资源库/ │   │  ┌──────────────────┐ │   │          │
  │ 64px │ AI 对话) │   │  │   NodeCanvas     │ │   │          │
  │      │ 可拖拽宽 │   │  └──────────────────┘ │   │          │
  └──────┴──────────┴───┴───────────────────────┴───┴──────────┘
  专注模式：活动栏/检查器折叠，Sidebar 固定为 AI 对话视图（约 35% 视口宽）。
-->

<template>
  <!-- 单一应用布局：专注模式是视图状态（focusModeStore.isFocusMode）而非独立布局树，
       布局状态驱动显隐，NodeCanvas 与 AIChatPanel 均不重挂载，无切换竞态。
       无激活项目时同样渲染本布局（空画布），项目打开/新建统一走画布内的项目
       管理弹窗（状态栏入口 / Ctrl+Shift+P）。 -->
  <div
    class="app-layout"
    :class="{
      'is-resizing': layout.isLayoutTransitionDisabled.value,
      'is-focus-mode': focusModeStore.isFocusMode,
    }"
  >
    <!-- Level 1: Activity Bar (导航条) -->
    <aside
      class="activity-bar"
      :style="{ width: layout.activityBarCollapsed.value ? '0px' : '64px' }"
    >
      <AssetLibraryNav />
    </aside>

    <!-- Level 2: Dynamic Sidebar (侧边面板) -->
    <!-- 注意：活动栏折叠（专注模式）时侧栏从 x=0 起排——不要加负 margin"补位"，
           否则侧栏左缘被推出视口外（内容裁剪）、flex 总宽不闭合（画布右缘露底色竖条） -->
    <div
      class="sidebar-panel-container"
      :style="{ width: layout.sidebarCollapsed.value ? '0px' : layout.sidebarWidth.value + 'px' }"
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
              <AppIcon name="x" :size="14" />
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

        <!-- 专注模式切换按钮：tab 栏右端内联（margin-left:auto 顶到最右），
               普通/专注两种模式下位置固定——曾用浮层居中方案，悬浮遮挡 tab 且
               随宽度变化漂移，故改为内联（VS Code 式视图操作位） -->
        <FocusModeToggle />
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

  <!-- 崩溃反馈弹窗:独立于 app-layout 渲染,
       确保任何界面状态(含项目选择阶段)都能弹出全局崩溃反馈 -->
  <CrashFeedbackModal />
</template>

<script setup lang="ts">
  import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'

  import { logger } from '@/core/utils/logger'
  import { eventBus } from '@/core/eventBus'
  import { appApi } from '@/core/capabilities/appApi'
  import AssetLibraryNav from '@/components/layout/AssetLibraryNav.vue'
  import AssetLibrary from '@/components/layout/AssetLibrary.vue'
  import InspectorPanel from '@/components/layout/InspectorPanel.vue'
  import FocusModeToggle from '@/components/layout/FocusModeToggle.vue'
  import NodeCanvas from '@/components/canvas/NodeCanvas.vue'
  import DragGhost from '@/components/canvas/DragGhost.vue'
  import AppStatusBar from '@/components/layout/AppStatusBar.vue'
  import AppOverlayHost from '@/components/layout/AppOverlayHost.vue'
  import CrashFeedbackModal from '@/components/shared/CrashFeedbackModal.vue'

  import { useAppLayout } from '@/composables/useAppLayout'
  import { useAppBootstrap } from '@/composables/useAppBootstrap'
  import { useTheme } from '@/composables/useTheme'
  import { fitView } from '@/services/canvas/vueFlowApi'
  import { FITVIEW_DURATION_MS } from '@/services/canvas/animationDurations'
  import { SAFE_FITVIEW_PADDING } from '@/features/node-layout-organizer/constants'

  import { useCanvasStore, type Workspace } from '@/stores/canvasStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { useFocusModeStore } from '@/stores/focusModeStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useResourceDragStore, type ResourceDragPayload } from '@/stores/resourceDragStore'
  import { useFeedbackStore } from '@/stores/feedbackStore'
  // import { useAiChatStore } from '@/stores/aiChatStore'

  const { t } = useI18n()

  // --- Store 实例 ---
  const canvasStore = useCanvasStore()
  const graphStore = useGraphStore()
  const focusModeStore = useFocusModeStore()
  const projectStore = useProjectStore()
  const resourceDragStore = useResourceDragStore()
  const feedbackStore = useFeedbackStore()

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
  const currentView = ref<'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data'>(
    'toolbox'
  )

  /** 拖拽 Ghost 的鼠标位置，实时跟随光标更新 */
  const mousePosition = ref({ x: 0, y: 0 })
  // const aiChatStore = useAiChatStore()

  /**
   * 专注模式编排：进入时快照布局五字段，退出时从快照逐项恢复。
   *
   * 编排放 App.vue（而非 store）的原因：layout 实例与 currentView 都在
   * App.vue 作用域，focusModeStore 只做纯状态容器。进入时折叠活动栏与
   * 检查器、展开侧栏为 AI 对话视图并把宽度设为约 35% 视口宽（右侧画布
   * 占余下 65%）；退出时按快照恢复原布局后清空快照。
   */
  /** 专注模式布局过渡时长余量：面板宽度/折叠过渡为 0.2s ease，等过渡结束后再取景 */
  const FOCUS_LAYOUT_TRANSITION_MS = 240
  /** 待执行的布局后取景定时器（进入/退出共用，快速连续切换时只保留最后一次） */
  let focusFitViewTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 布局几何变化后重新取景（进入/退出专注模式共用）。
   *
   * 无条件 fitView（不判 canvasViewportStore.isCustomized）：专注切换改变了
   * 画布可视区几何（起点右移、宽度变化），用户自定义的 pan/zoom 对应的是
   * 切换前的可视区，保留它反而会让内容偏在旧位置（节点挤左上、大片空白）。
   * 留白沿用 SAFE_FITVIEW_PADDING（与重构前 IDE/Agent 布局切换的取景策略一致）。
   */
  const refitCanvasAfterLayoutSettled = () => {
    if (focusFitViewTimer !== null) clearTimeout(focusFitViewTimer)
    focusFitViewTimer = setTimeout(() => {
      focusFitViewTimer = null
      try {
        fitView({ padding: { ...SAFE_FITVIEW_PADDING }, duration: FITVIEW_DURATION_MS })
      } catch (e) {
        // vueFlowApi 未初始化（如尚无画布实例）时静默忽略，不影响切换
        logger.debug('[App] 专注模式切换后 fitView 跳过（画布未就绪）:', e)
      }
    }, FOCUS_LAYOUT_TRANSITION_MS)
  }

  watch(
    () => focusModeStore.isFocusMode,
    (active) => {
      if (active) {
        focusModeStore.snapshot = {
          activityBarCollapsed: layout.activityBarCollapsed.value,
          sidebarCollapsed: layout.sidebarCollapsed.value,
          rightCollapsed: layout.rightCollapsed.value,
          sidebarWidth: layout.sidebarWidth.value,
          currentView: currentView.value,
        }
        layout.activityBarCollapsed.value = true
        layout.rightCollapsed.value = true
        layout.sidebarCollapsed.value = false
        currentView.value = 'ai-chat'
        layout.sidebarWidth.value = Math.round(layout.viewportWidth.value * 0.35)
      } else {
        const snap = focusModeStore.snapshot
        if (snap) {
          layout.activityBarCollapsed.value = snap.activityBarCollapsed
          layout.sidebarCollapsed.value = snap.sidebarCollapsed
          layout.rightCollapsed.value = snap.rightCollapsed
          layout.sidebarWidth.value = snap.sidebarWidth
          currentView.value = snap.currentView
        }
        focusModeStore.snapshot = null
      }
      // 布局状态生效后等宽度过渡结束再重新取景（进入、退出都需要）
      refitCanvasAfterLayoutSettled()
    }
  )

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
   * 资源库视图切换事件（由 AssetLibraryNav 等通过 eventBus.emit('viewchange') 触发）
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
   * - 关闭后留在空画布（与 Electron 行为一致），用户可经项目管理弹窗打开其他项目
   */
  const handleProjectClosedEvent = () => {
    handleProjectClosed()
  }

  /**
   * 项目路径失效处理（项目已被移动/删除，后端返回"项目配置路径不存在"404）。
   * httpClient 响应拦截器检测到该 404 后已清除 localStorage 并广播此事件；
   * 这里补齐运行时清理：移除 projectRoot、清空 store 与 Electron 最近项目记录。
   * 清理后留在空画布，等待用户经项目管理弹窗重新打开项目。
   */
  const handleProjectPathInvalid = () => {
    logger.warn('[App] 项目路径已失效，清理项目状态')
    handleProjectClosed()
    projectStore.clearProject()
    void appApi.saveRecentProject({ configPath: '', dataPath: '' }).catch(() => undefined)
  }

  /**
   * 展开右侧属性检查器面板（校验错误 L2 列级定位前发出 expand-inspector-panel）。
   * 仅折叠时展开，已展开不动（避免把用户手动折叠的面板强行拉开之外的副作用）。
   */
  const handleExpandInspectorPanel = () => {
    if (layout.rightCollapsed.value) {
      layout.toggleRightPanel()
    }
  }

  /** 注册全局事件监听 */
  const registerGlobalListeners = () => {
    window.addEventListener('mousemove', handleMouseMove as EventListener)
    window.addEventListener('resize', handleResize)
    eventBus.on('viewchange', handleViewChange)
    eventBus.on('project-closed', handleProjectClosedEvent)
    eventBus.on('expand-inspector-panel', handleExpandInspectorPanel)
  }

  /** 移除全局事件监听 */
  const removeGlobalListeners = () => {
    eventBus.off('viewchange', handleViewChange)
    eventBus.off('project-closed', handleProjectClosedEvent)
    eventBus.off('project-path-invalid', handleProjectPathInvalid)
    eventBus.off('expand-inspector-panel', handleExpandInspectorPanel)
    window.removeEventListener('mousemove', handleMouseMove as EventListener)
    window.removeEventListener('resize', handleResize)
  }

  onMounted(async () => {
    try {
      // 全局监听必须先于 bootstrap 注册：bootstrap 中的耗时步骤（如配置实体水合）
      // 期间用户已可点击活动栏视图/等待快捷键，若等 bootstrap 完成才注册，
      // 该窗口期内的事件（viewchange 等）会永久丢失（2026-09-04 CI E2E 实证：
      // 水合 42 实体期间点击"项目资源"，Nav 本地视图已切而 App 层收不到事件，
      // 侧栏永不切换）。各处理器均为纯状态操作，不依赖项目，提前注册安全。
      // 项目路径失效监听同理（启动请求即可能发现死路径）。
      eventBus.on('project-path-invalid', handleProjectPathInvalid)
      registerGlobalListeners()

      // 启动时补弹上次渲染进程崩溃的待处理记录(Electron 特有)
      // 放在 bootstrap 之前,确保即使 bootstrap 出错崩溃补弹仍有机会展示
      void feedbackStore.loadPendingFromMain()

      await bootstrap()
    } catch (error) {
      logger.error('初始化工作区失败:', error)
    }
  })

  /** 应用卸载：清理键盘快捷键、拖拽状态和全局事件监听，防止内存泄漏 */
  onUnmounted(() => {
    // 取消未触发的专注模式取景定时器，避免卸载后仍操作画布
    if (focusFitViewTimer !== null) {
      clearTimeout(focusFitViewTimer)
      focusFitViewTimer = null
    }

    // 应用关闭前，将当前画布快照写入磁盘
    canvasStore.saveCurrentCanvasData(graphStore.nodes, graphStore.edges)
    canvasStore.syncWorkspacesToBackend()

    removeGlobalListeners()
    cleanup()
  })
</script>

<style scoped src="./App.styles.css"></style>
