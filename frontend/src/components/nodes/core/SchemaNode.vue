<!--
  @file SchemaNode.vue
  @description Schema 表节点主组件，展示表结构、列定义、数据源绑定

  功能概述：
  - 显示和编辑数据表的表名、数据源信息
  - 管理数据表的所有列定义（列名、数据类型、约束）
  - 处理与数据源节点（SourcePreview）的连接
  - 支持正则表达式模式的拖拽绑定
  - 执行数据校验功能

  Props：
  - id: string — 节点的唯一标识符
  - data: SchemaNodeData — 节点的业务数据
  - selected: boolean — 节点是否被选中

  Emits：
  - save: 保存节点数据事件
  - delete-column: 删除列事件
  - add-column: 添加列事件
  - pattern-bind: Pattern 绑定事件
  - constraint-create: 创建约束事件
  - remove-node: 移除节点事件
  - schema-node-save: Schema 节点保存事件（带完整信息）
-->
<template>
  <!--
    ========================================
    SchemaNode 组件 - 数据表结构定义核心组件
    ========================================
    组件功能概述：
    1. 显示和编辑数据表的表名、数据源信息
    2. 管理数据表的所有列定义（列名、数据类型、约束）
    3. 处理与数据源节点（SourcePreview）的连接
    4. 提供列级别的约束设置（非空、唯一）
    5. 支持正则表达式模式的拖拽绑定
    6. 执行数据校验功能
    7. 滚动出屏幕列的虚拟锚点连接处理
    
    组件结构：
    1. 节点容器 - 最外层容器，处理交互事件（双击编辑、拖拽Pattern）
    2. 左侧目标连接点 - 接收来自数据源节点的连接
    3. SchemaNodeHeader - 节点头部（表名、数据源信息、控制按钮）
    4. 列标题栏 - 显示列的序号、名称、约束、类型、操作列标题
    5. 列编辑区 - 使用虚拟滚动技术，支持大量列定义
    6. SchemaNodeColumnRow - 单行列定义组件
    7. 虚拟锚点层 - 当列滚动出屏幕时显示，用于连接约束节点
    8. 底部添加列按钮
    9. 下拉菜单组件（数据源、约束、类型选择）
    10. 关闭确认弹窗
    
    虚拟锚点机制说明：
    - 当列滚动出可视区域时，原有的连接线会隐藏
    - 自动创建代理边连接到虚拟锚点（顶部/底部）
    - 代理边只在需要时显示，保证视觉连续性
    - 避免列过多时连接线断开的问题
  -->
  <div
    class="schema-node"
    :class="nodeClasses"
    :style="{ width: width + 'px', height: height ? height + 'px' : 'auto' }"
    :data-node-id="props.id"
    @keydown="handleKeydown"
    @drop="handlePatternDrop"
    @dragover="handlePatternDragOver"
    @mouseenter="nodeHovered = true"
    @mouseleave="nodeHovered = false"
  >
    <!-- 
      左侧目标连接点（Handle）
      用于接收来自 SourcePreview 节点的数据源连接
      - type="target": 表示这是目标端，接收连接
      - position="Left": 位于节点左侧
      - class="target-handle": 自定义样式类
    -->
    <Handle
      id="target-left"
      type="target"
      :position="Position.Left"
      class="target-handle"
      :title="t('customNodes.schemaNode.dragForRelation')"
    />

    <!--
      右侧主输出连接点（Handle）
      用于数据流输出到 Transform、Regex 等下游节点
      - type="source": 表示这是源端，输出连接
      - position="Right": 位于节点右侧
      - class="output-handle": 自定义样式类
    -->
    <Handle
      id="schema-output"
      type="source"
      :position="Position.Right"
      class="output-handle"
      :title="t('customNodes.schemaNode.dragToTransform')"
    />

    <!--
      SchemaNodeHeader 节点头部组件
      包含：
      - 表名显示/编辑区域
      - 数据源连接状态徽标
      - 智能填充按钮（✨）
      - 保存按钮（带状态反馈）
      - 关闭按钮
    -->
    <SchemaNodeHeader
      :table-name="localData.tableName"
      :source-file="localData.sourceFile ?? null"
      :sheet-name="localData.sheetName"
      :is-saving="isSaving"
      :save-success="saveSuccess"
      :save-error="saveError"
      :save-state="localData.saveState"
      @save="handleSave"
      @smart-fill="handleSmartFillClick"
      @close="handleClose"
      @source-info-click="handleSourceInfoClick($event)"
    />

    <!-- 
      列标题栏
      使用 grid 布局，5列结构：
      - 24px: 行号列
      - minmax(0, 1fr): 列名（自适应宽度）
      - auto: 约束图标列
      - auto: 数据类型列
      - 40px: 操作按钮列
    -->
    <div class="columns-header">
      <span class="col-header-num">{{ t('customNodes.schemaNode.columnsHeader.index') }}</span>
      <span class="col-header-name">{{ t('customNodes.schemaNode.columnsHeader.name') }}</span>
      <span class="col-header-constraints"></span>
      <span class="col-header-type">{{ t('customNodes.schemaNode.columnsHeader.type') }}</span>
      <span class="col-header-actions"></span>
    </div>

    <!-- 
      列编辑区容器
      使用 flex + overflow 实现虚拟滚动效果
      - columns-section-wrapper: 容器层，限制最大高度
      - columns-section-scroll: 滚动区域
      - columns-list: 列定义列表
    -->
    <div class="columns-section-wrapper">
      <!-- 可滚动区域，滚动时触发 handleColumnsScroll 更新虚拟锚点状态 -->
      <div class="columns-section-scroll" ref="columnsSectionRef" @scroll="handleColumnsScroll">
        <div class="columns-list">
          <!-- 
            SchemaNodeColumnRow 列定义行组件
            使用 v-for 遍历所有列定义渲染行组件
            每个列定义行包含：
            - Pattern 拖拽连接点（左侧）
            - 列名编辑/显示
            - 约束图标（非空、唯一）
            - 数据类型选择器
            - 列输出连接点（右侧）
            - 删除按钮（悬停时显示）
          -->
          <SchemaNodeColumnRow
            v-for="(column, index) in localData.columns"
            :key="column.id"
            :column="column"
            :index="index"
            :is-editing="editingColumn === column.id"
            :is-hovered="hoveredColumn === column.id"
            :is-drag-over="localData.isDragOver ?? false"
            :is-snapping="snappingColumnIds.has(column.id)"
            :is-connected="connectedColumnIds.has(column.id)"
            :show-constraint-menu="constraintMenuColumnId === column.id"
            @hover="hoveredColumn = column.id"
            @unhover="hoveredColumn = null"
            @hover-error="hoveredErrorColumn = column.id"
            @unhover-error="hoveredErrorColumn = null"
            @start-edit="startColumnEdit"
            @confirm-edit="confirmColumnEdit"
            @cancel-edit="cancelColumnEdit"
            @delete="deleteColumn"
            @toggle-constraint-menu="(id, e) => toggleConstraintMenu(id, e)"
            @toggle-type-dropdown="(id, e) => toggleTypeDropdown(id, e)"
            @enter="onColumnEnter(column.id)"
            @tab="onColumnTab(column.id)"
          />
        </div>
      </div>

      <!-- 
        虚拟锚点层
        当有列滚动出可视区域时显示
        提供顶部和底部两个虚拟连接点
        用于连接被滚动出屏幕的列的约束节点
      -->
      <div class="virtual-anchor-layer" v-show="hasScrolledOutColumns">
        <Handle
          id="virtual-anchor-top"
          type="source"
          :position="Position.Right"
          class="virtual-anchor virtual-anchor-top"
          :title="t('customNodes.schemaNode.virtualAnchor.top')"
        />
        <Handle
          id="virtual-anchor-bottom"
          type="source"
          :position="Position.Right"
          class="virtual-anchor virtual-anchor-bottom"
          :title="t('customNodes.schemaNode.virtualAnchor.bottom')"
        />
      </div>
    </div>

    <!-- 
      底部区域
      显示添加新列的按钮
    -->
    <div class="footer-section">
      <div class="add-column-btn" @click="handleAddColumn">
        + {{ t('customNodes.schemaNode.addColumn') }}
      </div>
    </div>

    <!-- 调整大小句柄 -->
    <div
      class="resize-handle"
      @mousedown.stop.prevent="startResize"
      :title="t('customNodes.sourcePreviewNode.resizeHandle')"
    ></div>

    <!-- 
      Pattern绑定提示层
      当拖拽 Pattern 进入节点区域时显示
      提示用户可以将 Pattern 绑定到 Expression 类型的列
    -->
    <div v-if="localData.isDragOver" class="binding-overlay">
      <div class="binding-prompt">
        <span class="prompt-text">{{ t('customNodes.schemaNode.actions.dropPatternToBind') }}</span>
      </div>
    </div>

    <!-- 
      数据源下拉菜单组件
      点击数据源徽标时显示
      包含当前连接信息、以树状结构展示的外部数据源列表
    -->
    <SchemaNodeDataSourceDropdown
      :show="showSourceDropdown"
      :position="sourceDropdownPosition"
      :current-source="{ sourceName: localData.sourceFile ?? '', sheetName: localData.sheetName }"
      :data-source-tree="dataSourceTree"
      @select="connectToDataSource"
      @close="closeSourceDropdown"
    />

    <!-- 
      列菜单下拉菜单组件
      支持两种模式：
      - constraint: 约束选择菜单（非空、唯一）
      - type: 数据类型选择菜单
      根据 activeDropdown 或 constraintMenuColumnId 判断显示哪种菜单
    -->
    <SchemaNodeColumnMenuDropdown
      :show="!!constraintMenuColumnId || !!activeDropdown"
      :menu-type="activeDropdown ? 'type' : 'constraint'"
      :position="activeDropdown ? dropdownPosition : constraintDropdownPosition"
      :column-id="activeDropdown || constraintMenuColumnId || ''"
      :constraints="getColumnConstraints(constraintMenuColumnId || '')"
      :current-type="getColumnType(activeDropdown || '')"
      :type-options="typeOptions"
      @close="handleCloseMenus"
      @toggle-constraint="toggleConstraint"
      @remove-all-constraints="removeAllConstraints"
      @select-type="updateColumnType"
    />

    <!-- 
      错误详情弹窗组件
      当鼠标悬停在有错误的列名上时显示
      显示验证错误的详细信息
    -->
    <SchemaNodeErrorPopover
      :show="!!hoveredErrorColumn && hasErrors(hoveredErrorColumn)"
      :errors="getColumnErrors(hoveredErrorColumn || '')"
      :position="getErrorPopoverPosition(hoveredErrorColumn || '')"
    />

    <!-- 
      关闭确认弹窗组件
      当尝试关闭有未保存更改的节点时显示
      提供三种操作：保存并关闭、放弃更改直接关闭、取消
    -->
    <SchemaNodeCloseConfirm
      :show="showCloseConfirm"
      @save="saveAndClose"
      @discard="confirmCloseWithoutSave"
      @cancel="cancelClose"
    />
  </div>
</template>

<script setup lang="ts">
  import { eventBus } from '@/core/eventBus'
  /**
   * @file SchemaNode.vue
   * @description Schema节点组件 - 数据表结构定义的核心可视化组件
   *
   * 组件设计理念：
   * - 采用组件化架构，将复杂UI拆分为多个职责单一的子组件
   * - 使用 composables 组织业务逻辑，保持模板清晰
   * - 统一样式通过外部CSS文件引入，便于维护
   * - 支持虚拟滚动，可处理大量列定义
   *
   * 数据流向：
   * 1. props.data 传入节点基础数据
   * 2. localData 创建本地副本，避免直接修改props
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
   * - pattern-bind: Pattern绑定事件
   * - constraint-create: 创建约束事件
   * - remove-node: 移除节点事件
   * - schema-node-save: Schema节点保存事件（带节点ID和数据）
   */

  // ==================== 导入部分 ====================

  // Vue 核心功能导入
  import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
  // 国际化支持
  import { useI18n } from 'vue-i18n'
  // VueFlow 图库导入
  // - Handle: 连接点组件
  // - Position: 连接位置枚举
  // - useVueFlow: VueFlow 核心 hook
  import { Handle, Position } from '@vue-flow/core'
  // 类型定义导入
  import type { SchemaNodeData, SchemaColumn, DataType } from '@/types/graph'
  // A5: 数据源连接逻辑提取到 composable（复用 useNodeSourceManager 基础设施）
  import { useSchemaDataSource } from '@/composables/nodes/schema/useSchemaDataSource'
  // Store 导入
  // - graphStore: 图数据状态（节点、边）
  import { useGraphStore } from '@/stores/graphStore'
  // Composables 导入 - 组织业务逻辑
  // - useSchemaNode: 整合所有 Schema 节点核心逻辑
  // - useSchemaUI: UI 状态管理（下拉菜单、悬停状态等）
  // - useSchemaInteractions: 交互逻辑（拖拽、连接、吸附动画）
  // - useSchemaConnectionHandler: 连接处理器（虚拟锚点、边管理）
  import { useSchemaNode } from '@/composables/nodes/schema'
  import { useSchemaUI } from '@/composables/nodes/schema/useSchemaUI'
  import { useSchemaInteractions } from '@/composables/nodes/schema/useSchemaInteractions'
  import { useSchemaConnectionHandler } from '@/composables/nodes/schema/useSchemaConnectionHandler'
  import { useSchemaResizable } from '@/composables/nodes/schema/useSchemaResizable'
  // 子组件导入
  import SchemaNodeHeader from '@/components/nodes/core/SchemaNode/components/SchemaNodeHeader.vue'
  import SchemaNodeColumnRow from '@/components/nodes/core/SchemaNode/components/SchemaNodeColumnRow.vue'
  import SchemaNodeDataSourceDropdown from '@/components/nodes/core/SchemaNode/components/SchemaNodeDataSourceDropdown.vue'
  import SchemaNodeColumnMenuDropdown from '@/components/nodes/core/SchemaNode/components/SchemaNodeColumnMenuDropdown.vue'
  import SchemaNodeErrorPopover from '@/components/nodes/core/SchemaNode/components/SchemaNodeErrorPopover.vue'
  import SchemaNodeCloseConfirm from '@/components/nodes/core/SchemaNode/components/SchemaNodeCloseConfirm.vue'

  // 统一样式文件导入
  import '@/components/nodes/core/SchemaNode/SchemaNode.styles.css'

  // ==================== Props 定义 ====================

  /**
   * 组件属性
   */
  const props = defineProps<{
    /** 节点的唯一标识符 */
    id: string
    /** 节点的业务数据 */
    data: SchemaNodeData
    /** 节点是否被选中 */
    selected?: boolean
  }>()

  // ==================== Emits 定义 ====================

  /**
   * 组件事件定义
   * 使用 Vue 3 的类型化 emit 语法
   */
  const emit = defineEmits<{
    /** 保存节点数据事件 */
    save: [data: SchemaNodeData]
    /** 删除列事件 */
    'delete-column': [columnId: string]
    /** 添加列事件 */
    'add-column': []
    /** Pattern绑定事件 */
    'pattern-bind': [columnId: string, patternData: Record<string, unknown>]
    /** 创建约束事件 */
    'constraint-create': [relationData: Record<string, unknown>]
    /** 移除节点事件 */
    'remove-node': [nodeId: string]
    /** Schema节点保存事件（带完整信息） */
    'schema-node-save': [data: { nodeId: string; nodeData: SchemaNodeData }]
  }>()

  // ==================== 初始化 ====================

  // 国际化
  const { t } = useI18n()

  // Store 初始化
  const store = useGraphStore()
  const updateNodeData = store.updateNodeData

  /**
   * 创建本地数据副本
   * 避免直接修改 props，保持单向数据流
   * 当 props.data 变化时自动同步
   */
  const localData = ref<SchemaNodeData>({ ...props.data })

  /**
   * 监听 props 变化并更新本地数据
   * 使用 deep: true 监听嵌套属性变化
   */
  watch(
    () => props.data,
    (newData) => {
      localData.value = { ...newData }
    },
    { deep: true }
  )

  // ==================== Composables 初始化 ====================

  /**
   * useSchemaUI - UI 状态管理
   * 负责：
   * - 滚动区域引用和滚动处理
   * - 悬停状态管理（hoveredColumn、hoveredErrorColumn）
   * - 下拉菜单位置计算
   * - 节点样式类计算
   * - 错误信息格式化
   */
  const {
    columnsSectionRef,
    handleColumnsScroll,
    hasScrolledOutColumns,
    getScrolledOutColumnsBySide,
    scrollVersion,
    typeOptions,
    hoveredColumn,
    hoveredErrorColumn,
    activeDropdown,
    dropdownPosition,
    constraintMenuColumnId,
    constraintDropdownPosition,
    showSourceDropdown,
    sourceDropdownPosition,
    dataSourceTree,
    nodeClasses,
    getErrorPopoverPosition,
    toggleTypeDropdown,
    toggleConstraintMenu,
    closeConstraintMenu,
    handleSourceInfoClick,
    closeSourceDropdown,
  } = useSchemaUI(props)

  /**
   * 节点悬停状态
   * 跟踪鼠标是否悬停在整个节点上
   * 用于控制连接点的显示/隐藏等
   */
  const nodeHovered = ref(false)

  /**
   * useSchemaInteractions - 交互逻辑
   * 负责：
   * - 列连接吸附动画
   * - 边变化监听
   * - 约束节点连接处理
   * - 表关系创建（外键）
   */
  const {
    snappingColumnIds,
    editingColumnName,
    handleColumnOutputConnect,
    createTableRelation,
    watchConnectionChanges,
    initKnownEdgeIds,
  } = useSchemaInteractions(props, emit)

  /**
   * useSchemaConnectionHandler - 连接处理器
   * 负责：
   * - SourcePreview 到 Schema 的连接处理
   * - 虚拟锚点状态监听
   * - 滚动出屏幕列的边管理
   */
  const { watchVirtualAnchorState } = useSchemaConnectionHandler()

  /**
   * useSchemaResizable - 调整大小逻辑
   * 负责：
   * - 拖拽调整节点宽高
   * - 保存尺寸状态
   */
  const { width, height, startResize } = useSchemaResizable(props)

  /**
   * useSchemaNode - Schema 节点核心逻辑
   * 负责：
   * - 数据管理（添加、删除、更新列）
   * - 数据源连接处理
   * - 列生成和类型推断
   * - 数据校验功能
   * - 编辑操作（表名、列名、约束）
   * - 保存逻辑
   */
  const {
    updateSchemaData,
    autoGenerateColumns,
    showSmartFillDialog,
    editingColumn,
    columnInputRefs,
    startColumnEdit,
    confirmColumnEdit,
    cancelColumnEdit,
    deleteColumn: deleteColumnFromEditing,
    toggleConstraint,
    removeAllConstraints,
    updateColumnType,
    bindPatternToColumn,
    onColumnEnter,
    onColumnTab,
    isSaving,
    saveSuccess,
    saveError,
    showCloseConfirm,
    handleSave,
    handleSaveCompleteDOM,
    handleClose,
    confirmCloseWithoutSave,
    saveAndClose,
    cancelClose,
    handleValidate,
    handleSourceConnection,
    handleSourceNodeDisconnected,
    handlePatternDragOver,
    handlePatternDrop,
    handleKeydown,
  } = useSchemaNode(props, emit)

  // ==================== 计算属性 ====================

  /**
   * 计算已连接的列 ID 集合
   * 遍历所有边，找出从当前 Schema 节点的列连接点出发的边
   * 用于显示列的已连接状态样式
   */
  const connectedColumnIds = computed(() => {
    const ids = new Set<string>()
    for (const edge of store.edges) {
      if (edge.source !== props.id) continue
      const sourceHandle = edge.sourceHandle as string | undefined
      if (!sourceHandle || !sourceHandle.startsWith('source-right-')) continue
      ids.add(sourceHandle.replace('source-right-', ''))
    }
    return ids
  })

  // ==================== Watch 监听 ====================

  /**
   * 监听边变化，触发吸附动画
   * 当新的约束连接建立时，播放一次性吸附效果
   */
  watchConnectionChanges()

  /**
   * 启动虚拟锚点状态监听
   * 当滚动状态或列数据变化时，自动更新虚拟锚点相关的边
   */
  watchVirtualAnchorState(
    props.id,
    () => hasScrolledOutColumns.value,
    getScrolledOutColumnsBySide,
    () => scrollVersion.value
  )

  /**
   * 监听节点数据变化
   * 当检测到修改且不是保存操作时，重置保存成功状态
   */
  watch(
    () => localData.value,
    (newData, oldData) => {
      if (oldData && !isSaving.value) {
        if (JSON.stringify(newData) !== JSON.stringify(oldData)) {
          if (newData.saveState === 'draft' && oldData.saveState === 'saved') {
            saveSuccess.value = false
          }
        }
      }
    },
    { deep: true }
  )

  /**
   * 监听表名变化
   * 确保表名修改时保存状态正确更新
   */
  watch(
    () => localData.value.tableName,
    (newTableName, oldTableName) => {
      if (oldTableName && oldTableName !== newTableName && !isSaving.value) {
        saveSuccess.value = false
      }
    }
  )

  // ==================== 事件处理函数 ====================

  // ==================== 数据源连接 + 智能填充（提取到 useSchemaDataSource composable） ====================
  // A5 修复：connectToDataSource（原 170 行）和 handleSmartFillClick（原 40 行）提取到 composable，
  // 内部复用 useNodeSourceManager.handleSourceConnection，消除重复代码
  const { connectToDataSource, handleSmartFillClick } = useSchemaDataSource(props, {
    localData,
    autoGenerateColumns,
    handleSourceConnection,
    showSmartFillDialog,
    handleValidate,
    closeSourceDropdown,
  })

  /**
   * 添加新列处理
   * 创建新的列定义，添加到列列表末尾
   * 自动聚焦新列的编辑状态
   */
  const handleAddColumn = () => {
    const newColumnName = `column_${localData.value.columns.length + 1}`
    const newId = `col-${Date.now()}`

    const newCol: SchemaColumn = {
      id: newId,
      columnName: newColumnName,
      dataType: 'String',
      expressionType: 'none',
      validationErrors: [],
    }

    const newColumns = [...localData.value.columns, newCol]

    updateSchemaData({
      columns: newColumns,
      saveState: 'draft',
      isDragOver: false,
      updatedAt: new Date().toISOString(),
    })

    updateNodeData(props.id, {
      ...localData.value,
      columns: newColumns,
      saveState: 'draft',
      isDragOver: false,
      updatedAt: new Date().toISOString(),
    })

    emit('add-column')

    editingColumn.value = newId
    editingColumnName.value = newColumnName

    nextTick(() => {
      const inputEl = columnInputRefs.value[newId] as HTMLInputElement | undefined
      if (inputEl) {
        inputEl.focus()
        inputEl.select()
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    })
  }

  /**
   * 删除列处理
   * 委托给 useSchemaNode 的 deleteColumnFromEditing
   * @param columnId - 要删除的列 ID
   */
  const deleteColumn = (columnId: string) => {
    deleteColumnFromEditing(columnId)
  }

  /**
   * 获取列的约束配置
   * @param columnId - 列 ID
   * @returns 约束配置对象或 undefined
   */
  const getColumnConstraints = (columnId: string) => {
    const column = localData.value.columns.find((c) => c.id === columnId)
    return column?.constraints
  }

  /**
   * 获取列的数据类型
   * @param columnId - 列 ID
   * @returns 数据类型或 undefined
   */
  const getColumnType = (columnId: string): DataType | undefined => {
    const column = localData.value.columns.find((c) => c.id === columnId)
    return column?.dataType
  }

  /**
   * 获取列的验证错误列表
   * @param columnId - 列 ID
   * @returns 错误字符串数组
   */
  const getColumnErrors = (columnId: string): string[] => {
    const column = localData.value.columns.find((c) => c.id === columnId)
    return column?.validationErrors || []
  }

  /**
   * 检查列是否有错误
   * @param columnId - 列 ID
   * @returns 是否有错误
   */
  const hasErrors = (columnId: string): boolean => {
    return getColumnErrors(columnId).length > 0
  }

  /**
   * 关闭所有下拉菜单
   */
  const handleCloseMenus = () => {
    closeConstraintMenu()
    activeDropdown.value = null
  }

  // ==================== 生命周期 ====================

  /**
   * 组件挂载时初始化
   * - 如果没有列，初始化一个默认列
   * - 初始化已知边集合（避免误判已有连接为新连接）
   * - 注册全局事件监听器
   */
  onMounted(() => {
    if (!localData.value.columns || localData.value.columns.length === 0) {
      const newId = `col-${Date.now()}`
      const initialCol: SchemaColumn = {
        id: newId,
        columnName: 'column_1',
        dataType: 'String',
        expressionType: 'none',
        validationErrors: [],
      }

      updateNodeData(props.id, {
        ...localData.value,
        columns: [initialCol],
      })
    }

    initKnownEdgeIds()

    eventBus.on('sourceNodeDisconnected', handleSourceNodeDisconnected)
    eventBus.on('schema-node-save-complete', handleSaveCompleteDOM)
  })

  /**
   * 组件卸载时清理
   * - 移除全局事件监听器
   */
  onUnmounted(() => {
    eventBus.off('sourceNodeDisconnected', handleSourceNodeDisconnected)
    eventBus.off('schema-node-save-complete', handleSaveCompleteDOM)
  })

  // 导入 nextTick（解决脚本末尾导入顺序问题）
  import { nextTick } from 'vue'
  // ==================== 暴露方法 ====================

  /**
   * 暴露公共方法和状态供外部组件调用
   * 主要用于 VueFlow 内部交互
   */
  defineExpose({
    handleSave,
    handleClose,
    startColumnEdit,
    confirmColumnEdit,
    cancelColumnEdit,
    deleteColumn: deleteColumnFromEditing,
    handleAddColumn,
    bindPatternToColumn,
    handlePatternDrop,
    handlePatternDragOver,
    handleColumnOutputConnect,
    createTableRelation,
    editingColumn,
    editingColumnName,
    hoveredColumn,
    activeDropdown,
    isSaving,
    saveSuccess,
    saveError,
    nodeHovered: nodeHovered,
    showCloseConfirm,
  })
</script>
