<!--
  @file NodeCanvas.vue
  @description 节点画布组件 - 核心画布容器，负责节点渲染与交互
-->

<template>
  <!--
    ========================================
    节点画布模板区域
    ========================================
    整个画布由以下几个主要区域组成：
    1. VueFlow 画布区域 - 核心节点渲染区域
    2. 启动覆盖层 - 项目未加载时显示
    3. 创建项目对话框 - 新建项目时使用
    4. 正则连接对话框 - 连接正则节点时使用
  -->
  <div class="canvas-wrapper" ref="flowWrapper">
    <!--
      VueFlow 画布组件
      - v-model:nodes: 双向绑定节点数据
      - v-model:edges: 双向绑定连接线数据
      - node-types: 自定义节点类型映射
      - edge-types: 自定义连接线类型
      - 各种事件监听：节点点击、连接、拖拽等
    -->
    <VueFlow
      v-model:nodes="store.nodes"
      v-model:edges="store.edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :default-edge-options="{
        type: 'smoothstep',
        animated: true,
        style: { strokeWidth: 2 },
        interactionWidth: 12,
      }"
      :is-valid-connection="validateConnection"
      @node-click="onNodeClick"
      @pane-context-menu.prevent="handlePaneContextMenu"
      @connect-start="onConnectStartFromDispatcher"
      @connect-end="onConnectEndFromDispatcher"
      @connect="onConnectFromDispatcher"
      @drop="onCanvasDrop"
      @dragover="onCanvasDragOver"
      @schema-node-save="handleNodeSave"
      @dragstart="handleNodeDragStart"
      @dragend="handleNodeDragEnd"
      :default-viewport="{ zoom: 0.8 }"
      class="theme-default"
      :selection-mode="SelectionMode.Partial"
      :select-nodes-on-drag="true"
      :zoom-on-pinch="true"
      :min-zoom="0.2"
      :max-zoom="2"
    >
      <!-- 背景网格组件 -->
      <Background
        :variant="BackgroundVariant.Dots"
        pattern-color="var(--ui-grid-color)"
        :gap="32"
        :size="2"
      />
      <!-- 控制面板：缩放、适应屏幕等按钮 -->
      <Controls />
      <!-- 缩略图导航：显示画布整体预览 -->
      <MiniMap />
    </VueFlow>

    <div
      v-if="nodeOrganizer.showGroups.value && zoneGroups.length > 0"
      class="zone-groups-overlay-host"
    >
      <ZoneGroupsOverlay
        :groups="zoneGroups"
        :viewport="viewport"
        @toggle-collapse="nodeOrganizer.toggleGroupCollapse"
        @close="nodeOrganizer.toggleShowGroups"
        @drag-end="nodeOrganizer.dragGroup"
      />
    </div>

    <CanvasControls />

    <ProjectCreateDialog ref="projectCreateDialogRef" />

    <RegexConnectionDialog
      :visible="showRegexConnectionDialog"
      :pending-connection="pendingRegexConnection"
      @close="showRegexConnectionDialog = false"
      @validate-directly="handleRegexValidateDirectly"
      @edit-regex="handleRegexEdit"
    />

    <TransformContextMenu
      :visible="showTransformMenu"
      :position="menuScreenPos"
      :flow-position="menuFlowPos"
      @select="handleNodeSelect"
      @close="handleTransformMenuClose"
    />
  </div>
</template>

<script setup lang="ts">
  /**
   * @file NodeCanvas.vue
   * @description 节点画布组件 - 数据流程图的核心可视化区域
   *
   * 该组件是整个数据质量治理应用的核心画布，负责：
   * 1. 渲染和管理数据流图中的节点（数据源、Schema、约束规则等）
   * 2. 处理节点之间的连线关系和连接操作
   * 3. 响应用户的拖拽、点击、连接等交互行为
   * 4. 协调数据流从数据源到 Schema 再到约束规则的传递
   * 5. 管理项目的创建和初始化流程
   *
   * 架构说明：
   * - 使用 VueFlow 库作为画布渲染引擎
   * - 使用 Pinia Store（graphStore）管理图数据
   * - 事件驱动：通过自定义事件与外部组件通信
   * - 组合式函数：使用多个 composables 分离关注点
   *
   * 节点类型：
   * - projectRoot: 项目根节点，代表整个项目
   * - schema: Schema节点，代表数据表结构
   * - sourcePreview: 数据源预览节点，显示原始数据
   * - regex: 正则验证规则节点
   * - notNullConstraint: 非空约束
   * - uniqueConstraint: 唯一性约束
   * - foreignKeyConstraint: 外键约束
   * - allowedValuesConstraint: 允许值约束
   * - conditionalConstraint: 条件约束
   * - scriptedConstraint: 脚本约束
   *
   * 组件 Props：
   * - 无外部 Props，所有状态通过 Store 管理
   *
   * 组件 Emits：
   * - 无外部 Emits，所有事件通过 Store 或全局事件处理
   *
   * 依赖的 Composables：
   * - useConnections: 连接处理（数据源、Schema、正则之间的连接）
   * - useCanvasNodeOperations: 画布节点操作（拖拽、放置等）
   * - useCanvasConnectionWatcher: 画布连接监听
   * - useCanvasContextMenu: 画布右键菜单
   * - useCanvasEventSetup: 画布事件设置（生命周期、连接调度）
   * - useNodeTypeRegistry: 节点类型注册
   * - useCanvasProjectDialog: 项目创建对话框
   * - useCanvasViewportSync: 视口同步
   */

  // ========================================
  // Vue 核心导入
  // ========================================
  import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { eventBus } from '@/core/eventBus'
  import { logger } from '@/core/utils/logger'
  import type { TransformTypeV2 } from '@/types/projectV2'
  import type { ConstraintKind } from '@/services/constraints/types'

  // ========================================
  // VueFlow 画布库导入
  // ========================================
  import { VueFlow, useVueFlow, SelectionMode } from '@vue-flow/core'
  import { Background, BackgroundVariant } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { MiniMap } from '@vue-flow/minimap'

  // ========================================
  // Store & Composables 导入
  // ========================================
  import { useGraphStore } from '@/stores/graphStore'
  import { useNodeOrganizer } from '@/features/node-layout-organizer/composables/useNodeOrganizer'
  import { useNodeTypeRegistry } from '@/composables/canvas/useNodeTypeRegistry'
  import { useCanvasConnectionWatcher } from '@/composables/canvas/useCanvasConnectionWatcher'
  import { initVueFlowApi } from '@/services/canvas/vueFlowApi'
  import { FITVIEW_DURATION_MS } from '@/services/canvas/animationDurations'
  import { useCanvasContextMenu } from '@/composables/canvas/useCanvasContextMenu'
  import { useConnections } from '@/composables/nodes/useConnections'
  import { useCanvasNodeOperations } from '@/composables/canvas/useCanvasNodeOperations'
  import { useCanvasProjectDialog } from '@/composables/canvas/useCanvasProjectDialog'
  import { useCanvasViewportSync } from '@/composables/canvas/useCanvasViewportSync'
  import { useCanvasEventSetup } from '@/composables/canvas/useCanvasEventSetup'

  // ========================================
  // 子组件导入
  // ========================================
  import CanvasControls from './CanvasControls.vue'
  import ProjectCreateDialog from './ProjectCreateDialog.vue'
  import RegexConnectionDialog from './RegexConnectionDialog.vue'
  import ZoneGroupsOverlay from '@/features/node-layout-organizer/components/ZoneGroupsOverlay.vue'
  import TransformContextMenu from './TransformContextMenu.vue'

  // ========================================
  // CSS 样式导入
  // ========================================
  import '@vue-flow/controls/dist/style.css'
  import '@vue-flow/minimap/dist/style.css'

  const { nodeTypes, edgeTypes } = useNodeTypeRegistry()
  const store = useGraphStore()
  const nodeOrganizer = useNodeOrganizer()
  const zoneGroups = nodeOrganizer.groups
  const { t } = useI18n()
  const {
    viewport,
    onNodeContextMenu,
    project,
    addNodes,
    addEdges,
    removeNodes,
    removeEdges,
    updateNodeInternals,
    updateEdgeData,
    findEdge,
    findNode,
    updateNodeData,
    updateNode,
    fitView,
  } = useVueFlow()
  initVueFlowApi({
    addNodes,
    addEdges,
    removeNodes,
    removeEdges,
    updateNodeInternals,
    updateEdgeData,
    findEdge,
    findNode,
    updateNodeData,
    updateNode,
    fitView,
  })
  const { validateConnection } = useCanvasConnectionWatcher()
  const flowWrapper = ref<HTMLDivElement | null>(null)
  const { projectCreateDialogRef, handleOpenCreateProjectDialog } = useCanvasProjectDialog()
  const { onNodeClick, handleNodeDragStart, handleNodeDragEnd, onCanvasDragOver, onCanvasDrop } =
    useCanvasNodeOperations(flowWrapper)
  const { setupContextMenu } = useCanvasContextMenu({ onNodeContextMenu, t })
  setupContextMenu()
  useCanvasViewportSync()
  const {
    pendingRegexConnection,
    showRegexConnectionDialog,
    handleRegexValidateDirectly,
    handleRegexEdit,
  } = useConnections()
  const {
    onConnectStartFromDispatcher,
    onConnectFromDispatcher,
    onConnectEndFromDispatcher,
    handleNodeSave,
  } = useCanvasEventSetup({
    onOpenCreateProjectDialog: handleOpenCreateProjectDialog,
  })

  // ========================================
  // Transform 右键菜单
  // ========================================
  const showTransformMenu = ref(false)
  const menuScreenPos = ref({ x: 0, y: 0 })
  const menuFlowPos = ref({ x: 0, y: 0 })

  const handlePaneContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const { clientX, clientY } = event
    menuScreenPos.value = { x: clientX, y: clientY }
    menuFlowPos.value = project({ x: clientX, y: clientY })
    showTransformMenu.value = true
  }

  const handleNodeSelect = (
    kind: 'transform' | 'constraint',
    type: string,
    position: { x: number; y: number }
  ) => {
    if (kind === 'transform') {
      store.createTransformNode(position, type as TransformTypeV2)
    } else {
      store.createConstraintNode(position, type as ConstraintKind)
    }
  }

  const handleTransformMenuClose = () => {
    showTransformMenu.value = false
  }

  // ========================================
  // 配置自检：响应"导入并聚焦"请求
  // ========================================
  // 自检抽屉等画布外组件通过事件总线请求把某资源导入画布并聚焦。
  // 这里负责：算视口中心→导入→等待渲染→fitView+选中。
  // 放在 NodeCanvas 是因为它持有 flowWrapper/project/fitView/store 全套能力。
  const handleInspectionImportAndFocus = async (payload: {
    resourceId: string
    kind: 'schema' | 'constraint' | 'regex' | 'transform'
  }): Promise<void> => {
    const { resourceId, kind } = payload
    // 用容器屏幕矩形算视口中心，再 project 转画布坐标
    let position = { x: 0, y: 0 }
    const el = flowWrapper.value
    if (el) {
      const rect = el.getBoundingClientRect()
      position = project({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      // 偏移一点，避免新节点正中心盖住已有节点
      position = { x: position.x - 120, y: position.y - 60 }
    }
    try {
      const nodeId = await store.importV2ResourceToCanvas(kind, resourceId, position, {
        includeDeps: false,
        moveIfExists: true,
      })
      if (!nodeId) {
        logger.warn('[NodeCanvas] inspection 导入未返回节点 id:', resourceId)
        return
      }
      // 等待 VueFlow 完成节点渲染，再 fitView
      await nextTick()
      store.setSelectedNode(nodeId)
      try {
        fitView({ nodes: [nodeId], padding: 0.3, duration: FITVIEW_DURATION_MS })
      } catch (err) {
        logger.warn('[NodeCanvas] inspection fitView 失败:', err)
      }
    } catch (err) {
      logger.error('[NodeCanvas] inspection 导入失败:', err)
    }
  }

  onMounted(() => {
    eventBus.on('inspection-import-and-focus', handleInspectionImportAndFocus)
  })
  onBeforeUnmount(() => {
    eventBus.off('inspection-import-and-focus', handleInspectionImportAndFocus)
  })
</script>

<style scoped src="./NodeCanvas.styles.css"></style>
