<!--
  @file JsonSchemaNode.vue
  @description JSON Schema 节点主组件，展示 JSON 结构定义

  功能概述：
  - 显示和编辑 JSON 数据的表结构定义（树形嵌套）
  - 处理与 JsonSourcePreview 节点的连接（含数据源切换下拉）
  - 提供字段的增删改操作（含 object/array 的子字段添加）
  - 头部支持：表名编辑、智能填充、保存（带状态反馈）、关闭
  - 执行 JSON Schema 校验并写回列级错误（打通 row-error 视觉闭环）
  - 列滚动出可视区时通过虚拟锚点保持连接线视觉连续性

  Props：
  - id: string — 节点的唯一标识符
  - data: JsonSchemaNodeData — 节点的业务数据
  - selected: boolean — 节点是否被选中

  Emits：
  - save: 保存节点数据事件
  - remove-node: 移除节点事件
  - dataChanged: 数据变更事件
  - column-add: 列添加事件
  - column-update: 列更新事件
  - column-delete: 列删除事件
  - constraint-create: 创建约束事件
  - source-connect: 源连接事件
-->
<template>
  <div
    class="json-schema-node"
    :class="nodeClasses"
    :style="{ width: width ? `${width}px` : undefined }"
    :data-node-id="props.id"
    @keydown="handleKeydown"
    @drop="handlePatternDrop"
    @dragover="handlePatternDragOver"
    @dragleave="isDragOver = false"
  >
    <!--
      左侧目标连接点（Handle）
      用于接收来自 JsonSourcePreview 节点的数据源连接
    -->
    <Handle
      id="target-left"
      type="target"
      :position="Position.Left"
      class="target-handle"
      :title="t('customNodes.jsonSchemaNode.dragForDataSource')"
    />

    <!--
      右侧主输出连接点（Handle）
      用于数据流输出到 Transform、Regex 等下游节点
    -->
    <Handle
      id="schema-output"
      type="source"
      :position="Position.Right"
      class="output-handle"
      :title="t('customNodes.jsonSchemaNode.dragToTransform')"
    />

    <!-- 数据源连接状态徽标 -->
    <div
      class="source-status-badge"
      :class="{ 'is-connected': hasSourceConnection }"
      :title="
        hasSourceConnection
          ? t('customNodes.jsonSchemaNode.sourceConnected')
          : t('customNodes.jsonSchemaNode.dragToConnect')
      "
    >
      <span v-if="hasSourceConnection" class="status-icon connected">●</span>
      <span v-else class="status-icon disconnected">○</span>
    </div>

    <!-- 头部：表名、数据源信息、智能填充、保存、关闭 -->
    <JsonSchemaNodeHeader
      :table-name="schemaData.tableName"
      :source-file="schemaData.sourceFile ?? null"
      :is-editing-title="isEditingTitle"
      :is-saving="isSaving"
      :save-success="saveSuccess"
      :save-error="saveError"
      :save-state="schemaData.saveState"
      @start-edit="isEditingTitle = true"
      @confirm-edit="handleTableNameConfirm"
      @cancel-edit="isEditingTitle = false"
      @save="handleSave"
      @smart-fill="handleSmartFillClick"
      @close="handleClose"
      @source-info-click="handleSourceInfoClick"
    />

    <!-- 列标题栏 -->
    <div class="columns-header">
      <span class="col-h-expand"></span>
      <span class="col-h-name">{{ t('customNodes.jsonSchemaNode.columnsHeader.field') }}</span>
      <span class="col-h-path">{{ t('customNodes.jsonSchemaNode.columnsHeader.pathShort') }}</span>
      <span class="col-h-type">{{ t('customNodes.jsonSchemaNode.columnsHeader.type') }}</span>
      <span class="col-h-constraints"></span>
      <span class="col-h-actions"></span>
    </div>

    <!-- 树形内容（含滚动区与虚拟锚点层） -->
    <div class="columns-section-wrapper">
      <JsonSchemaTree
        ref="treeRef"
        :columns="schemaData.columns"
        :scroll-ref="columnsSectionRef"
        @update="handleColumnsUpdate"
        @scroll="handleColumnsScroll"
        @add-child="handleAddChildField"
        @hover-error="hoveredErrorColumn = $event"
        @unhover-error="hoveredErrorColumn = null"
      />

      <!-- 虚拟锚点层：列滚动出可视区时显示，保持连接线视觉连续 -->
      <div class="virtual-anchor-layer" v-show="hasScrolledOutColumns">
        <Handle
          id="virtual-anchor-top"
          type="source"
          :position="Position.Right"
          class="virtual-anchor virtual-anchor-top"
          :title="t('customNodes.jsonSchemaNode.virtualAnchor.top')"
        />
        <Handle
          id="virtual-anchor-bottom"
          type="source"
          :position="Position.Right"
          class="virtual-anchor virtual-anchor-bottom"
          :title="t('customNodes.jsonSchemaNode.virtualAnchor.bottom')"
        />
      </div>
    </div>

    <!-- 底部 -->
    <div class="node-footer">
      <button class="btn-add" @click="handleAddRootField">
        <span class="plus-icon">+</span>
        <span>{{ t('customNodes.jsonSchemaNode.addField') }}</span>
      </button>
    </div>

    <!-- 调整大小句柄 -->
    <div
      class="resize-handle"
      @mousedown.stop.prevent="startResize"
      :title="t('customNodes.sourcePreviewNode.resizeHandle')"
    ></div>

    <!-- Pattern 绑定提示层 -->
    <div v-if="isDragOver" class="binding-overlay">
      <div class="binding-prompt">
        <span class="prompt-text">{{
          t('customNodes.jsonSchemaNode.actions.dropPatternToBind')
        }}</span>
      </div>
    </div>

    <!-- 数据源切换下拉菜单 -->
    <JsonSchemaNodeDataSourceDropdown
      :show="showSourceDropdown"
      :position="sourceDropdownPosition"
      :current-source="{
        sourceName: schemaData.sourceFile ?? '',
      }"
      :data-source-tree="dataSourceTree"
      @select="handleDataSourceSelect"
      @close="closeSourceDropdown"
    />

    <!-- 错误详情弹窗（鼠标悬停在有错误的字段名上时显示） -->
    <JsonSchemaNodeErrorPopover
      :show="!!hoveredErrorColumn && hasErrors(hoveredErrorColumn)"
      :errors="getColumnErrors(hoveredErrorColumn || '')"
      :position="getErrorPopoverPosition(hoveredErrorColumn || '')"
    />

    <!-- 关闭确认对话框 -->
    <JsonSchemaNodeCloseConfirm
      :show="showCloseConfirm"
      @save="saveAndClose"
      @discard="confirmCloseWithoutSave"
      @cancel="cancelClose"
    />
  </div>
</template>

<script setup lang="ts">
  /**
   * @file JsonSchemaNode.vue
   * @description JSON Schema 节点组件 - JSON 数据结构定义的可视化组件
   *
   * 重构要点（对齐 SchemaNode 的接线方式）：
   * - 改用 useJsonSchemaNode 聚合器，统一拿到 sourceManager / saving / events 等全部能力
   * - 头部 / 数据源下拉 / 错误 popover / 关闭确认 全部改用既有的子组件（消除死代码）
   * - 新增智能填充、保存按钮接线、数据源切换、虚拟锚点、列级错误写回
   */
  import { ref, onMounted, onBeforeUnmount } from 'vue'
  import { logger } from '@/core/utils/logger'
  import { eventBus } from '@/core/eventBus'
  import { useI18n } from 'vue-i18n'
  import { Handle, Position, useVueFlow } from '@vue-flow/core'
  import type { JsonSchemaNodeData, JsonSchemaColumn } from '@/types/graph'
  // 聚合器：一次拿到所有 JSON Schema 节点能力（数据/源管理/校验/UI/交互/缩放/保存/拖拽/事件）
  import { useJsonSchemaNode } from '@/composables/nodes/json'
  // 虚拟锚点（直接从 schema 复用，不移动文件——最小改动原则）
  import { useVirtualAnchorEdges } from '@/composables/nodes/schema/useVirtualAnchorEdges'
  import { useGraphStore } from '@/stores/graphStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  // 数据源预览创建（与 SchemaNode 同款工具）
  import { usePreviewCreation } from '@/composables/nodes/sourcePreview/usePreviewCreation'
  import type { ExternalDataSource, SourceMode } from '@/types/datasource'
  import { findJsonSchemaColumnById } from '@/utils/nodes/json/columnFinder'
  // 子组件
  import JsonSchemaTree from './JsonSchemaTree.vue'
  import JsonSchemaNodeHeader from './components/JsonSchemaNodeHeader.vue'
  import JsonSchemaNodeDataSourceDropdown from './components/JsonSchemaNodeDataSourceDropdown.vue'
  import JsonSchemaNodeErrorPopover from './components/JsonSchemaNodeErrorPopover.vue'
  import JsonSchemaNodeCloseConfirm from './components/JsonSchemaNodeCloseConfirm.vue'

  import '@/components/nodes/json/JsonSchemaNode.styles.css'

  // ==================== Props 定义 ====================
  const props = defineProps<{
    /** 节点的唯一标识符 */
    id: string
    /** 节点的业务数据 */
    data: JsonSchemaNodeData
    /** 节点是否被选中 */
    selected?: boolean
  }>()

  // ==================== Emits 定义 ====================
  import type { ConstraintCreateData } from '@/composables/nodes/json/useJsonSchemaInteractions'
  const emit = defineEmits<{
    /** 保存节点数据事件 */
    save: [data: JsonSchemaNodeData]
    /** 移除节点事件 */
    'remove-node': [nodeId: string]
    /** 数据变更事件 */
    dataChanged: [data: JsonSchemaNodeData]
    /** 列添加事件 */
    'column-add': []
    /** 列更新事件 */
    'column-update': [data: { columnId: string; updates: Partial<JsonSchemaColumn> }]
    /** 列删除事件 */
    'column-delete': [columnId: string]
    /** 创建约束事件 */
    'constraint-create': [data: ConstraintCreateData]
    /** 源连接事件 */
    'source-connect': [data: { sourceNodeId: string; targetNodeId: string }]
  }>()

  // ==================== 初始化 ====================
  const { t } = useI18n()
  const store = useGraphStore()
  const { addEdges, updateNodeInternals } = useVueFlow()
  const { showConfirm } = useGlobalConfirm()
  const { createSourcePreviewNode } = usePreviewCreation()

  // ==================== Composables 初始化（聚合器一次拿全） ====================
  const {
    // 数据管理
    schemaData,
    updateColumn,
    deleteColumn: deleteColumnFromData,
    batchUpdateColumns,
    expandAll,
    collapseAll,
    // 数据源管理
    hasSourceConnection,
    connectedSourceNode,
    connectToSource,
    showSmartFillDialog,
    autoGenerateColumns,
    // 校验
    validateAllColumns,
    // UI
    nodeClasses,
    hoveredErrorColumn,
    showSourceDropdown,
    sourceDropdownPosition,
    dataSourceTree,
    columnsSectionRef,
    hasScrolledOutColumns,
    scrollVersion,
    getScrolledOutColumnsBySide,
    getErrorPopoverPosition,
    handleSourceInfoClick,
    closeSourceDropdown,
    handleColumnsScroll,
    // 交互
    handleKeydown,
    watchSourceConnection,
    cleanup,
    handleColumnOutputConnect,
    createTableRelation,
    watchConnectionChanges,
    initKnownEdgeIds,
    // 缩放
    width,
    startResize,
    // 保存
    isSaving,
    saveSuccess,
    saveError,
    showCloseConfirm,
    handleSave,
    handleClose: handleCloseFromSaving,
    saveAndClose,
    confirmCloseWithoutSave,
    cancelClose,
    handlePatternDragOver,
    handlePatternDrop,
  } = useJsonSchemaNode(props, emit)

  // 虚拟锚点：复用 Schema 的机制，handle 前缀 'source-right-' 与本树已一致
  const { watchVirtualAnchorState } = useVirtualAnchorEdges()

  // ==================== 计算属性 ====================
  const isDragOver = ref(false)
  const isEditingTitle = ref(false)
  const treeRef = ref<InstanceType<typeof JsonSchemaTree> | null>(null)

  // ==================== 事件处理函数 ====================

  /**
   * 处理列数据更新（来自 JsonSchemaTree 的 @update）
   */
  const handleColumnsUpdate = (newColumns: JsonSchemaColumn[]) => {
    batchUpdateColumns(newColumns)
  }

  /**
   * 添加根级字段
   *
   * 注意：必须通过 batchUpdateColumns（直接改 schemaData + notifyDataChanged）
   * 而非 useNodeColumnEditing.addColumn。因为 schemaData 是 useSchemaDataBase 创建的
   * 一次性快照副本（reactive(structuredClone(props.data))），而 addColumn 的
   * updateColumns 只调 store.updateNodeData，不同步 schemaData 快照，会导致
   * 绑定 schemaData.columns 的 JsonSchemaTree 渲染层看不到新字段。
   */
  const handleAddRootField = () => {
    const seq = schemaData.columns.length + 1
    const newCol: JsonSchemaColumn = {
      id: crypto.randomUUID(),
      columnName: `field_${seq}`,
      jsonPath: `$.field_${seq}`,
      dataType: 'string' as const,
      nullable: true,
      isExpanded: true,
    }
    batchUpdateColumns([...schemaData.columns, newCol])
    emit('column-add')
  }

  /**
   * 添加子字段（object/array 列的嵌套子字段）
   * 由 JsonSchemaNodeColumnRow 在 object/array 列上触发 @addChild 冒泡到此
   * 同样走 batchUpdateColumns 路径，递归插入到父列的 children 并展开父列
   */
  const handleAddChildField = (parentId: string) => {
    const parent = findJsonSchemaColumnById(schemaData.columns, parentId)?.column
    if (!parent) return
    const baseName = `field_1`
    const newPath = `${parent.jsonPath}.${baseName}`
    const newCol: JsonSchemaColumn = {
      id: crypto.randomUUID(),
      columnName: baseName,
      jsonPath: newPath,
      dataType: 'string' as const,
      nullable: true,
      isExpanded: true,
    }
    // 递归插入子列到目标父列的 children，并展开父列
    const insertChild = (columns: JsonSchemaColumn[]): JsonSchemaColumn[] =>
      columns.map((c) => {
        if (c.id === parentId) {
          return {
            ...c,
            isExpanded: true,
            children: [...(c.children || []), newCol],
          }
        }
        return c.children ? { ...c, children: insertChild(c.children) } : c
      })
    batchUpdateColumns(insertChild(schemaData.columns))
    emit('column-add')
  }

  /**
   * 表名编辑确认
   */
  const handleTableNameConfirm = (newName: string) => {
    isEditingTitle.value = false
    store.updateNodeData(props.id, { ...props.data, tableName: newName })
  }

  /**
   * 删除节点（走 saving 的关闭确认流程）
   */
  const handleClose = () => {
    handleCloseFromSaving()
  }

  /**
   * 智能填充按钮点击处理
   * - 已连接数据源：弹出智能填充对话框，确认后自动生成列定义
   * - 未连接数据源：弹出警告提示
   */
  const handleSmartFillClick = async () => {
    const sourceNode = connectedSourceNode.value

    if (sourceNode) {
      await showSmartFillDialog(sourceNode)
      // 智能填充对话框确认后，触发表结构的自动生成
      autoGenerateColumns(sourceNode)
      return
    }

    // 兜底：通过边查找已连接的 JsonSourcePreview 节点
    const edge = store.edges.find(
      (e) =>
        e.target === props.id &&
        store.nodes.find((n) => n.id === e.source)?.type === 'jsonSourcePreview'
    )
    if (edge) {
      const fallbackNode = store.nodes.find((n) => n.id === edge.source)
      if (fallbackNode) {
        await showSmartFillDialog(fallbackNode)
        autoGenerateColumns(fallbackNode)
        return
      }
    }

    await showConfirm({
      title: t('customNodes.jsonSchemaNode.source.notConnected'),
      message: t('customNodes.jsonSchemaNode.source.smartFillWarning'),
      confirmText: t('common.confirm'),
      type: 'warning',
    })
  }

  /**
   * 数据源切换：从下拉选择一个外部数据源
   * 流程（与 SchemaNode.connectToDataSource 对齐）：
   * 1. 断开当前连接的旧 source 节点边
   * 2. 创建新的 JsonSourcePreview 节点
   * 3. 创建边连接
   * 4. 调用 connectToSource(sourceNodeId) 触发元数据更新 + 智能填充
   */
  const handleDataSourceSelect = async (dataSource: ExternalDataSource) => {
    logger.debug('🔄 [JsonSchemaNode] 切换数据源:', dataSource.name)
    try {
      // 1. 断开旧 source 连接
      const existingSourceEdge = store.edges.find(
        (edge) =>
          edge.target === props.id &&
          store.nodes.find((n) => n.id === edge.source)?.type === 'jsonSourcePreview'
      )
      if (existingSourceEdge) {
        store.deleteConnection(existingSourceEdge.id)
      }

      // 2. 创建新 source 预览节点
      const schemaNode = store.nodes.find((n) => n.id === props.id)
      if (!schemaNode) {
        logger.error('❌ 未找到 JSON Schema 节点')
        return
      }
      const sourceNodePosition = {
        x: schemaNode.position.x - 450,
        y: schemaNode.position.y,
      }
      const meta = {
        fileId: dataSource.fileId,
        fileName: dataSource.name,
        name: dataSource.name,
        fileType: 'json' as const,
        sourceType: 'json' as const,
        sourceName: dataSource.name,
        sourceMode: (dataSource.sourceMode as SourceMode) || 'localfile',
        localPath: dataSource.localPath,
      }
      const newNode = await createSourcePreviewNode(meta, sourceNodePosition)
      if (!newNode) {
        logger.error('❌ 创建 JSON source 节点失败')
        return
      }
      const sourceNodeId = newNode.id

      // 3. 创建边连接（延时等待节点渲染）
      setTimeout(() => {
        try {
          const newEdge = {
            id: `edge-${Date.now()}`,
            source: sourceNodeId,
            target: props.id,
            sourceHandle: `${sourceNodeId}-output`,
            targetHandle: 'target-left',
            type: 'smoothstep',
            animated: true,
            style: { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 },
            label: 'Data Source',
          }
          addEdges([newEdge])
          updateNodeInternals([sourceNodeId, props.id])
        } catch (err) {
          logger.error('❌ 创建边连接失败:', err)
        }
      }, 1000)

      // 4. 触发元数据更新 + 智能填充
      setTimeout(() => {
        connectToSource(sourceNodeId)
      }, 300)

      logger.debug('✅ [JsonSchemaNode] 数据源切换完成')
    } catch (error) {
      logger.error('❌ [JsonSchemaNode] 切换数据源失败:', error)
    }
    closeSourceDropdown()
  }

  /**
   * 获取列的校验错误列表
   */
  const getColumnErrors = (columnId: string): string[] => {
    const col = findJsonSchemaColumnById(schemaData.columns, columnId)?.column
    return col?.validationErrors || []
  }

  /**
   * 检查列是否有错误
   */
  const hasErrors = (columnId: string): boolean => getColumnErrors(columnId).length > 0

  /**
   * 执行 JSON Schema 校验并写回列级错误（打通 row-error 视觉闭环）
   * - 合并本地校验（validateAllColumns：JSONPath 格式、数据类型有效性）
   * - 结果写回 column.validationErrors，驱动 JsonSchemaNodeColumnRow 的红框/⚠️ 图标
   *
   * 注意：validateColumn 会把子列错误合并到父列结果的 errors 数组里，
   * 但每条错误的 error.columnId 仍指向子列自身。因此这里按 error.columnId
   * 而非 result.columnId 来分组，确保嵌套子列也能正确点亮红框。
   */
  const runValidation = () => {
    logger.debug('🔄 [JsonSchemaNode] 开始校验，nodeId:', props.id)

    // 收集每列的本地校验错误，按错误自身的 columnId 分组（而非结果包装器的 columnId）
    const { results } = validateAllColumns()
    const errorsByColumnId = new Map<string, string[]>()
    for (const result of results) {
      for (const err of result.errors) {
        // 优先用错误自身的 columnId（子列）；若缺失则回退到结果 columnId（父列）
        const key = err.columnId || result.columnId
        if (!errorsByColumnId.has(key)) errorsByColumnId.set(key, [])
        errorsByColumnId.get(key)!.push(err.message)
      }
    }

    // 递归写回 validationErrors（含子列）
    const writeBack = (columns: JsonSchemaColumn[]): JsonSchemaColumn[] =>
      columns.map((c) => ({
        ...c,
        validationErrors: errorsByColumnId.get(c.id) ?? [],
        children: c.children ? writeBack(c.children) : undefined,
      }))

    const updatedColumns = writeBack(schemaData.columns)
    store.updateNodeData(props.id, { ...props.data, columns: updatedColumns })

    return { valid: results.every((r) => r.errorCount === 0), results }
  }

  /**
   * 监听 validate-json-schema 自定义事件
   */
  const handleValidateJsonSchema = (detail: { nodeId: string }) => {
    if (detail.nodeId === props.id) {
      runValidation()
    }
  }

  // ==================== 生命周期 ====================
  onMounted(() => {
    // 空列时初始化一个默认列（对齐 SchemaNode 行为）
    // 必须走 batchUpdateColumns（直接改 schemaData + notifyDataChanged），
    // 不能走 addColumn（它只改 store 不同步 schemaData 快照，会导致渲染层看不到）
    if (!schemaData.columns || schemaData.columns.length === 0) {
      const initialCol: JsonSchemaColumn = {
        id: crypto.randomUUID(),
        columnName: 'field_1',
        jsonPath: '$.field_1',
        dataType: 'string' as const,
        nullable: true,
        isExpanded: true,
      }
      batchUpdateColumns([initialCol])
    }

    eventBus.on('validate-json-schema', handleValidateJsonSchema)
    watchSourceConnection()
    initKnownEdgeIds()
    watchConnectionChanges()

    // 启动虚拟锚点状态监听（列滚动出可视区时自动更新代理边）
    watchVirtualAnchorState(
      props.id,
      () => hasScrolledOutColumns.value,
      getScrolledOutColumnsBySide,
      () => scrollVersion.value
    )
  })

  onBeforeUnmount(() => {
    eventBus.off('validate-json-schema', handleValidateJsonSchema)
    cleanup()
  })

  // ==================== 暴露方法 ====================
  defineExpose({
    runValidation,
    validateAllColumns,
    hasSourceConnection,
    schemaData,
    updateColumn,
    deleteColumn: deleteColumnFromData,
    handleAddRootField,
    handleClose,
    handleColumnOutputConnect,
    createTableRelation,
    expandAll,
    collapseAll,
  })
</script>
