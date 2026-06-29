<!--
  @file JsonSchemaNode.vue
  @description JSON Schema 节点主组件，展示 JSON 结构定义

  功能概述：
  - 显示和编辑 JSON 数据的表结构定义
  - 管理 JSON 字段的树形结构（支持嵌套）
  - 处理与 JsonSourcePreview 节点的连接
  - 提供字段的增删改操作
  - 执行 JSON Schema 校验功能

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
  <!--
    ========================================
    JsonSchemaNode 组件 - JSON数据结构定义节点
    ========================================
    组件功能概述：
    1. 显示和编辑 JSON 数据的表结构定义
    2. 管理 JSON 字段的树形结构（支持嵌套）
    3. 处理与 JsonSourcePreview 节点的连接
    4. 提供字段的增删改操作
    5. 执行 JSON Schema 校验功能

    组件结构：
    1. 节点容器 - 最外层容器，处理交互事件
    2. 左侧目标连接点 - 接收来自 JsonSourcePreview 节点的连接
    3. 数据源状态徽标 - 显示是否已连接数据源
    4. 节点头部 - 表名、数据源信息、关闭按钮
    5. 列标题栏 - 显示字段类型、名称、JSONPath
    6. JsonSchemaTree - 树形结构展示字段
    7. 底部添加字段按钮

    重构说明：
    - 使用 Composables 模块组织业务逻辑
    - 样式通过外部 CSS 文件引入
    - 类型定义完整，遵循项目规范
  -->
  <div
    class="json-schema-node"
    :class="nodeClasses"
    :style="{ width: width ? `${width}px` : undefined }"
    :data-node-id="props.id"
    @keydown="handleKeydown"
    @drop="handlePatternDropFromSaving"
    @dragover="handlePatternDragOverFromSaving"
    @dragleave="isDragOver = false"
  >
    <!--
      左侧目标连接点（Handle）
      用于接收来自 JsonSourcePreview 节点的数据源连接
      - type="target": 表示这是目标端，接收连接
      - position="Left": 位于节点左侧
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
      - type="source": 表示这是源端，输出连接
      - position="Right": 位于节点右侧
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

    <!-- 头部 -->
    <div class="node-header">
      <div class="header-left">
        <span class="json-icon">{ }</span>
        <span class="table-name">{{ data.tableName || 'JSON' }}</span>
        <span v-if="data.sourceFile" class="source-tag">{{ data.sourceFile }}</span>
      </div>

      <button class="btn-close" @click="handleClose">×</button>
    </div>

    <!-- 列标题栏 -->
    <div class="columns-header">
      <span class="col-h-expand"></span>
      <span class="col-h-name">{{ t('customNodes.jsonSchemaNode.columnsHeader.field') }}</span>
      <span class="col-h-path">{{ t('customNodes.jsonSchemaNode.columnsHeader.pathShort') }}</span>
      <span class="col-h-type">{{ t('customNodes.jsonSchemaNode.columnsHeader.type') }}</span>
      <span class="col-h-constraints"></span>
      <span class="col-h-actions"></span>
    </div>

    <!-- 树形内容 -->
    <JsonSchemaTree ref="treeRef" :columns="schemaData.columns" @update="handleColumnsUpdate" />

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

    <!-- 关闭确认对话框 -->
    <div v-if="showCloseConfirm" class="close-confirm-overlay" @click.self="cancelClose">
      <div class="close-confirm-dialog">
        <p>{{ t('common.confirmDialog.unsavedChanges') }}</p>
        <div class="close-confirm-actions">
          <button class="btn-confirm-save" @click="saveAndClose">
            {{ t('common.saveAndClose') }}
          </button>
          <button class="btn-confirm-discard" @click="confirmCloseWithoutSave">
            {{ t('common.discard') }}
          </button>
          <button class="btn-confirm-cancel" @click="cancelClose">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  /**
   * @file JsonSchemaNode.vue
   * @description JSON Schema节点组件 - JSON数据结构定义的可视化组件
   *
   * 组件设计理念：
   * - 采用组件化架构，将复杂UI拆分为多个职责单一的子组件
   * - 使用 composables 组织业务逻辑，保持模板清晰
   * - 统一样式通过外部CSS文件引入，便于维护
   * - 支持树形嵌套结构，可处理复杂的JSON Schema
   *
   * 数据流向：
   * 1. props.data 传入节点基础数据
   * 2. schemaData 创建本地副本，通过 composables 管理
   * 3. 通过 composables 处理业务逻辑
   * 4. 更新时同步到 VueFlow store 和 Graph store
   *
   * 组件 Props：
   * - id: 节点的唯一标识符，用于 VueFlow 识别
   * - data: 节点的业务数据，包含 tableName、columns、sourceFile 等
   * - selected: 节点是否被选中状态（用于显示选中样式）
   *
   * 组件 Emits：
   * - save: 保存节点数据事件
   * - delete-column: 删除列事件
   * - add-column: 添加列事件
   * - constraint-create: 创建约束事件
   * - remove-node: 移除节点事件
   */

  // ==================== 导入部分 ====================

  // Vue 核心功能导入
  import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
  import { eventBus } from '@/core/eventBus'
  // 国际化支持
  import { useI18n } from 'vue-i18n'
  // VueFlow 图库导入
  import { Handle, Position } from '@vue-flow/core'
  // 类型定义导入
  import type { JsonSchemaNodeData, JsonSchemaColumn } from '@/types/graph'
  // Composables 导入 - 组织业务逻辑
  import { useJsonSchemaData } from '@/composables/nodes/json/useJsonSchemaData'
  import { useJsonSchemaValidation } from '@/composables/nodes/json/useJsonSchemaValidation'
  import { useJsonSchemaUI } from '@/composables/nodes/json/useJsonSchemaUI'
  import { useJsonSchemaInteractions } from '@/composables/nodes/json/useJsonSchemaInteractions'
  import { useJsonSchemaSaving } from '@/composables/nodes/json/useJsonSchemaSaving'
  import { useJsonSchemaResizable } from '@/composables/nodes/json/useJsonSchemaResizable'
  // Store 导入
  import { useGraphStore } from '@/stores/graphStore'
  // 子组件导入
  import JsonSchemaTree from './JsonSchemaTree.vue'

  // 统一样式文件导入
  import '@/components/nodes/json/JsonSchemaNode.styles.css'

  // ==================== Props 定义 ====================

  /**
   * 组件属性
   */
  const props = defineProps<{
    /** 节点的唯一标识符 */
    id: string
    /** 节点的业务数据 */
    data: JsonSchemaNodeData
    /** 节点是否被选中 */
    selected?: boolean
  }>()

  // ==================== Emits 定义 ====================

  // 导入约束创建数据类型
  import type { ConstraintCreateData } from '@/composables/nodes/json/useJsonSchemaInteractions'
  /**
   * 组件事件定义
   * 使用 Vue 3 的类型化 emit 语法
   * 统一命名规范：column-{action} 格式
   */
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

  // 国际化
  const { t } = useI18n()

  // Store 初始化
  const store = useGraphStore()

  // ==================== Composables 初始化 ====================

  /**
   * useJsonSchemaData - 数据管理
   * 负责：
   * - 数据管理（添加、删除、更新列）
   * - Schema 数据同步
   * - 树形结构操作
   */
  const {
    schemaData,
    addColumn,
    updateColumn,
    deleteColumn: deleteColumnFromData,
    batchUpdateColumns,
    expandAll,
    collapseAll,
  } = useJsonSchemaData(props, emit)

  /**
   * useJsonSchemaValidation - 校验逻辑
   * 负责：
   * - JSONPath 格式验证
   * - 数据类型验证
   * - 列级别校验
   * - 全量校验
   */
  const { validateAllColumns, validateJsonPath } = useJsonSchemaValidation(props)

  /**
   * useJsonSchemaUI - UI 状态管理
   * 负责：
   * - 节点样式类计算
   * - 下拉菜单状态
   * - 悬停状态
   * - 错误信息格式化
   */
  const { nodeClasses } = useJsonSchemaUI(props)

  /**
   * useJsonSchemaInteractions - 交互逻辑
   * 负责：
   * - 键盘事件处理
   * - 列编辑状态
   * - 输入引用管理
   * - 连接处理
   */
  const {
    handleKeydown,
    watchSourceConnection,
    cleanup,
    handleColumnOutputConnect,
    createTableRelation,
    watchConnectionChanges,
    initKnownEdgeIds,
  } = useJsonSchemaInteractions(props, emit)

  /**
   * useJsonSchemaSaving - 保存逻辑
   * 负责：
   * - 保存状态追踪（saving/success/error）
   * - 脏数据追踪（isDirty）
   * - Ctrl+S 快捷键
   * - 关闭确认流程
   */
  const {
    showCloseConfirm,
    handleClose: handleCloseFromSaving,
    saveAndClose,
    confirmCloseWithoutSave,
    cancelClose,
    handlePatternDragOver: handlePatternDragOverFromSaving,
    handlePatternDrop: handlePatternDropFromSaving,
  } = useJsonSchemaSaving(props, emit as (event: string, ...args: unknown[]) => void)

  /**
   * useJsonSchemaResizable - 缩放逻辑
   * 负责：
   * - 节点宽度/高度管理
   * - 拖拽调整大小
   * - 最小尺寸约束
   */
  const { width, startResize } = useJsonSchemaResizable(props)

  // ==================== 计算属性 ====================

  const isDragOver = ref(false)

  /**
   * 检查是否已连接到 JSON 数据源
   * 通过遍历所有边，查找是否存在从 JsonSourcePreview 节点到当前节点的连接
   */
  const hasSourceConnection = computed(() => {
    return store.edges.some(
      (edge) =>
        edge.target === props.id &&
        store.nodes.find((n) => n.id === edge.source)?.type === 'jsonSourcePreview'
    )
  })

  // ==================== 事件处理函数 ====================

  /**
   * 处理列数据更新
   * @param newColumns - 新的列数组
   */
  const handleColumnsUpdate = (newColumns: JsonSchemaColumn[]) => {
    batchUpdateColumns(newColumns)
  }

  /**
   * 添加根级字段
   * 创建新的列定义，添加到 columns 数组末尾
   */
  const handleAddRootField = () => {
    const newCol: JsonSchemaColumn = {
      id: crypto.randomUUID(),
      columnName: `field_${schemaData.columns.length + 1}`,
      jsonPath: `$.field_${schemaData.columns.length + 1}`,
      dataType: 'string' as const,
      nullable: true,
    }

    addColumn(newCol)
    emit('column-add')
  }

  /**
   * 删除节点
   * 使用 useJsonSchemaSaving 的关闭逻辑，支持关闭确认
   */
  const handleClose = () => {
    handleCloseFromSaving()
  }

  /**
   * 执行 JSON Schema 校验
   * - 检查是否有列定义
   * - 检查列名是否有重复
   * - 检查 JSONPath 格式
   * - 检查是否已关联数据源
   */
  const runValidation = () => {
    logger.debug('🔄 [JsonSchemaNode] 开始校验，nodeId:', props.id)

    const errors: string[] = []

    // 1. 检查是否有列定义
    if (!schemaData.columns || schemaData.columns.length === 0) {
      errors.push('没有定义任何字段')
    }

    // 2. 检查列名是否有重复
    const columnNames: string[] = []
    const collectColumnNames = (columns: JsonSchemaColumn[]) => {
      for (const col of columns) {
        columnNames.push(col.columnName)
        if (col.children && col.children.length > 0) {
          collectColumnNames(col.children)
        }
      }
    }
    collectColumnNames(schemaData.columns)

    const duplicateNames = columnNames.filter((name, index) => columnNames.indexOf(name) !== index)
    if (duplicateNames.length > 0) {
      errors.push(`存在重复的字段名: ${[...new Set(duplicateNames)].join(', ')}`)
    }

    // 3. 检查 JSONPath 格式
    const checkJsonPaths = (columns: JsonSchemaColumn[]) => {
      for (const col of columns) {
        if (!validateJsonPath(col.jsonPath)) {
          errors.push(`JSONPath 格式不正确: ${col.jsonPath}`)
        }
        if (col.children && col.children.length > 0) {
          checkJsonPaths(col.children)
        }
      }
    }
    checkJsonPaths(schemaData.columns)

    // 4. 检查是否已关联数据源
    if (!hasSourceConnection.value) {
      errors.push('未关联数据源')
    }

    // 输出校验结果
    if (errors.length > 0) {
      logger.warn('⚠️ [JsonSchemaNode] 校验发现问题:', errors)
    } else {
      logger.debug('✅ [JsonSchemaNode] 校验通过')
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * 监听 validate-json-schema 自定义事件
   * 当事件的 nodeId 与当前组件匹配时触发校验
   */
  const handleValidateJsonSchema = (detail: { nodeId: string }) => {
    if (detail.nodeId === props.id) {
      logger.debug('🔄 [JsonSchemaNode] 收到自动校验事件，nodeId:', props.id)
      runValidation()
    }
  }

  // ==================== 生命周期 ====================

  /**
   * 组件挂载时初始化
   * - 注册 validate-json-schema 事件监听器
   * - 启动数据源连接监听
   */
  onMounted(() => {
    eventBus.on('validate-json-schema', handleValidateJsonSchema)
    watchSourceConnection()
    initKnownEdgeIds()
    watchConnectionChanges()
  })

  /**
   * 组件卸载时清理
   * - 移除事件监听器，避免内存泄漏
   * - 清理 composable 资源
   */
  onBeforeUnmount(() => {
    eventBus.off('validate-json-schema', handleValidateJsonSchema)
    cleanup()
  })

  // ==================== 暴露方法 ====================

  /**
   * 暴露公共方法和状态供外部组件调用
   * 主要用于 VueFlow 内部交互
   */
  defineExpose({
    runValidation,
    validateAllColumns,
    hasSourceConnection,
    schemaData,
    addColumn,
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
