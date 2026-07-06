<!--
  @file SchemaNodeInspector.vue
  @description Schema 节点属性检查器组件

  这个组件用于显示和编辑 Schema 节点（表格定义节点）的属性信息。
  Schema 节点代表一个数据表的结构定义，包含列信息、约束条件等。

  功能概述：
  - 表格定义（可编辑）：配置名称、表格名称、目标 Sheet 名
  - 数据源信息（只读）：关联的数据源文件
  - 列定义（可编辑）：列数量、每行可编辑列名/数据类型/内嵌约束
  - 连接的约束（只读）：通过边或 children 关联的约束节点信息
  - 保存状态（只读）：当前保存状态、最后保存时间
  - 时间信息（只读）：创建时间、更新时间
-->
<template>
  <!-- 整个属性检查器容器 -->
  <div class="schema-inspector">
    <!-- 1. 表格定义区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.schemaNode.groups.definition')"
      :badge="t('inspector.schemaNode.badgeEditable')"
      badge-class="editable"
    >
      <InspectorField
        :label="t('inspector.schemaNode.labels.configName')"
        :model-value="data.configName"
        :editable="true"
        :placeholder="t('inspector.schemaNode.placeholders.configName')"
        @update:model-value="(v) => updateData({ configName: v })"
      />
      <InspectorField
        :label="t('inspector.schemaNode.labels.tableName')"
        :model-value="data.tableName"
        :editable="true"
        :placeholder="t('inspector.schemaNode.placeholders.tableName')"
        @update:model-value="(v) => updateData({ tableName: v })"
      />
      <InspectorField
        :label="t('inspector.schemaNode.labels.sheetName')"
        :model-value="data.sheetName || ''"
        :editable="true"
        :placeholder="t('inspector.schemaNode.placeholders.sheetName')"
        @update:model-value="(v) => updateData({ sheetName: v || undefined })"
      />
    </BaseInspector>

    <!-- 2. 数据源信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.schemaNode.groups.datasource')"
      :badge="t('inspector.schemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        v-if="connectedSourcePreview"
        :label="t('inspector.schemaNode.labels.sourcePreview')"
        :model-value="connectedSourcePreview"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.schemaNode.labels.sourceFile')"
        :model-value="data.sourceFile || t('inspector.schemaNode.values.notConnected')"
        :editable="false"
      />
      <InspectorField
        v-if="data.sourceFilePath"
        :label="t('inspector.schemaNode.labels.filePath')"
        :model-value="data.sourceFilePath"
        type="path"
        :editable="false"
      />
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.schemaNode.groups.validationTask')"
      :badge="t('inspector.schemaNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="validation-task-copy">
        {{ t('inspector.schemaNode.validationTask.description') }}
      </div>
      <button class="validate-table-btn" @click="openSingleTableValidation">
        {{ t('inspector.schemaNode.actions.validateTable') }}
      </button>
    </BaseInspector>

    <!-- 3. 列定义区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.schemaNode.groups.columns')"
      :badge="t('inspector.schemaNode.badgeEditable')"
      badge-class="editable"
    >
      <!-- 隐式匹配状态区块 -->
      <div v-if="implicitMatchColumns.length > 0" class="implicit-match-section">
        <div class="implicit-match-header">
          <span class="implicit-match-label">{{
            t('inspector.schemaNode.implicitMatch.title')
          }}</span>
          <span class="implicit-match-count">{{ implicitMatchColumns.length }}</span>
        </div>
        <div class="implicit-match-list">
          <div v-for="column in implicitMatchColumns" :key="column.id" class="implicit-match-item">
            <div class="implicit-match-info">
              <span class="column-name">{{ column.columnName }}</span>
              <span class="match-type">{{
                t('inspector.schemaNode.implicitMatch.runtimeDetection')
              }}</span>
            </div>
            <button class="lock-binding-btn" @click="convertToExplicitBinding(column.id)">
              {{ t('inspector.schemaNode.implicitMatch.lockBinding') }}
            </button>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>{{ t('inspector.schemaNode.labels.columnCount') }}</label>
        <div class="column-count-badge">
          <span class="column-count-number">{{ data.columns?.length || 0 }}</span>
          <span class="column-count-unit">{{ t('inspector.schemaNode.units.columns') }}</span>
        </div>
      </div>

      <!-- 列定义编辑列表（每行可编辑列名、数据类型、内嵌约束） -->
      <div v-if="data.columns && data.columns.length > 0" class="columns-editor">
        <div class="column-edit-row" v-for="(column, index) in data.columns" :key="column.id">
          <div class="column-edit-row-header">
            <span class="column-index">{{ index + 1 }}</span>
            <input
              class="column-name-input"
              :value="column.columnName"
              @change="handleColumnNameChange(column.id, ($event.target as HTMLInputElement).value)"
              :placeholder="t('inspector.schemaNode.placeholders.columnName')"
            />
            <button
              class="column-delete-btn"
              @click="handleDeleteColumn(column.id)"
              :title="t('inspector.schemaNode.actions.deleteColumn')"
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="column-edit-row-body">
            <!-- 数据类型选择器 -->
            <div class="column-edit-field">
              <label class="column-edit-label">{{
                t('inspector.schemaNode.labels.dataType')
              }}</label>
              <select
                class="column-type-select"
                :value="column.dataType"
                @change="
                  handleDataTypeChange(
                    column.id,
                    ($event.target as HTMLSelectElement).value as DataType
                  )
                "
              >
                <option v-for="dt in dataTypes" :key="dt" :value="dt">
                  {{ getDataTypeDisplay(dt) }}
                </option>
              </select>
            </div>
            <!-- 内嵌约束切换按钮（NN=非空, UQ=唯一） -->
            <div class="column-edit-constraints">
              <label class="column-edit-label">{{
                t('inspector.schemaNode.labels.inlineConstraints')
              }}</label>
              <div class="constraint-toggles">
                <button
                  class="constraint-toggle not-null"
                  :class="{ active: column.constraints?.notNull }"
                  @click="handleToggleConstraint(column.id, 'notNull')"
                  :title="t('inspector.schemaNode.constraints.notNull')"
                >
                  NN
                </button>
                <button
                  class="constraint-toggle unique"
                  :class="{ active: column.constraints?.unique }"
                  @click="handleToggleConstraint(column.id, 'unique')"
                  :title="t('inspector.schemaNode.constraints.unique')"
                >
                  UQ
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 添加新列按钮 -->
      <button class="add-column-btn" @click="handleAddColumn">
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
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {{ t('inspector.schemaNode.actions.addColumn') }}
      </button>
    </BaseInspector>

    <!-- 4. 连接的约束区块（只读） -->
    <BaseInspector
      :title="t('inspector.schemaNode.groups.connectedConstraints')"
      :badge="t('inspector.schemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <div v-if="connectedConstraints.length > 0" class="connected-constraints-list">
        <div v-for="c in connectedConstraints" :key="c.nodeId" class="connected-constraint-item">
          <div class="constraint-item-header">
            <!-- 约束类型标签（带颜色区分） -->
            <span class="constraint-type-badge" :class="`ctype-${c.constraintType}`">{{
              getConstraintTypeLabel(c.constraintType)
            }}</span>
            <span class="constraint-name">{{ c.configName || c.nodeId }}</span>
          </div>
          <!-- 约束关联的目标列 -->
          <div class="constraint-item-detail">
            <span class="constraint-detail-label"
              >{{ t('inspector.schemaNode.labels.targetColumn') }}:</span
            >
            <span class="constraint-detail-value">{{ c.columnNames || '-' }}</span>
          </div>
          <!-- 约束校验状态 -->
          <div v-if="c.validationStatus" class="constraint-item-detail">
            <span class="constraint-detail-label"
              >{{ t('inspector.schemaNode.labels.validationStatus') }}:</span
            >
            <span class="constraint-status-badge" :class="`status-${c.validationStatus}`">{{
              getValidationStatusText(c.validationStatus)
            }}</span>
          </div>
        </div>
      </div>
      <!-- 没有连接约束时的占位提示 -->
      <div v-else class="no-constraints">
        {{ t('inspector.schemaNode.values.noConnectedConstraints') }}
      </div>
    </BaseInspector>

    <!-- 5. 保存状态区块（只读） -->
    <BaseInspector
      :title="t('inspector.schemaNode.groups.saveState')"
      :badge="t('inspector.schemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.schemaNode.labels.currentStatus') }}</label>
        <div class="status-indicator" :class="data.saveState">
          <AppIcon class="status-icon" :name="getStatusIcon(data.saveState)" :size="16" />
          <span class="status-text">{{ getStatusText(data.saveState) }}</span>
        </div>
      </div>
      <InspectorField
        v-if="data.lastSaved"
        :label="t('inspector.schemaNode.labels.lastSaved')"
        :model-value="formatDateTime(data.lastSaved)"
        :editable="false"
      />
    </BaseInspector>

    <!-- 6. 时间信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.schemaNode.groups.timestamp')"
      :badge="t('inspector.schemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        v-if="data.createdAt"
        :label="t('inspector.schemaNode.labels.createdAt')"
        :model-value="formatDateTime(data.createdAt)"
        :editable="false"
      />
      <InspectorField
        v-if="data.updatedAt"
        :label="t('inspector.schemaNode.labels.updatedAt')"
        :model-value="formatDateTime(data.updatedAt)"
        :editable="false"
      />
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { storeToRefs } from 'pinia'
  import { useGraphStore } from '@/stores/graphStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { SchemaNodeData, SchemaColumn } from '@/types/nodes'
  import type { DataType } from '@/types/common'
  import apiClient from '@/core/services/httpClient'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const validationTaskStore = useValidationTaskStore()
  const { nodes, edges } = storeToRefs(graphStore)

  /**
   * 组件属性接口
   * 接收 SchemaNodeData 类型的数据，以及可选的 nodeId（用于查找约束连接）
   */
  interface Props {
    data: SchemaNodeData
    nodeId?: string
  }

  /**
   * 使用 defineProps 声明组件属性
   */
  const props = defineProps<Props>()

  /**
   * 定义组件可以触发的事件
   * update:data 事件用于通知父组件数据已更新
   */
  const emit = defineEmits<{
    'update:data': [data: Partial<SchemaNodeData>]
  }>()

  /**
   * 支持的数据类型列表，用于列定义的数据类型下拉选择
   */
  const dataTypes: DataType[] = [
    'String',
    'Integer',
    'Float',
    'Decimal',
    'Boolean',
    'Date',
    'Expression',
  ]

  /**
   * 获取关联的 SourcePreview 节点名称
   * 从 graphStore 中查找通过边连接到该 schema 的 sourcePreview 类型节点
   */
  const connectedSourcePreview = computed(() => {
    const sourceNodeId = props.data.sourceNodeId
    if (!sourceNodeId) return null
    const sourceNode = nodes.value.find((n) => n.id === sourceNodeId && n.type === 'sourcePreview')
    if (!sourceNode) return null
    return (
      ((sourceNode.data as unknown as Record<string, unknown>).sourceName as string) ||
      sourceNode.id
    )
  })

  /**
   * 获取隐式匹配的列
   * 筛选 expressionType 为 'implicit' 的列，这些列的正则绑定由运行时动态推断
   */
  const implicitMatchColumns = computed(() => {
    if (!props.data.columns) return []
    return props.data.columns.filter((col) => col.expressionType === 'implicit')
  })

  /**
   * 连接约束信息接口
   * 描述一个连接到当前 Schema 节点的约束节点的摘要信息
   */
  interface ConnectedConstraintInfo {
    nodeId: string
    nodeType: string
    constraintType: string
    configName: string
    columnNames: string
    validationStatus: string
  }

  /**
   * 计算属性：获取所有连接到当前 Schema 节点的约束节点信息
   *
   * 查找策略（两种途径，通过 seen 集合去重）：
   * 1. 出边扫描：遍历以当前 Schema 为 source 的所有边，筛选目标为约束类型的节点
   * 2. children 扫描：遍历 Schema 节点 data.children 中记录的子节点 ID
   *
   * 对于每个约束节点，从其 sourceRef 中提取关联的列 ID，
   * 并将列 ID 映射为用户可读的列名
   */
  const connectedConstraints = computed<ConnectedConstraintInfo[]>(() => {
    if (!props.nodeId) return []
    const schemaId = props.nodeId

    // Step 1: 筛选当前 Schema 节点的所有出边
    const outgoingEdges = edges.value.filter((e) => e.source === schemaId)

    // 所有约束节点类型的白名单
    const constraintNodeTypes = new Set([
      'notNullConstraint',
      'uniqueConstraint',
      'foreignKeyConstraint',
      'allowedValuesConstraint',
      'rangeConstraint',
      'conditionalConstraint',
      'scriptedConstraint',
      'charsetConstraint',
      'dateLogicConstraint',
    ])

    const result: ConnectedConstraintInfo[] = []
    const seen = new Set<string>()

    // Step 2: 通过出边查找关联的约束节点
    for (const edge of outgoingEdges) {
      const targetNode = nodes.value.find((n) => n.id === edge.target)
      if (!targetNode || !constraintNodeTypes.has(targetNode.type || '')) continue
      if (seen.has(targetNode.id)) continue
      seen.add(targetNode.id)

      const d = targetNode.data as unknown as Record<string, unknown>
      const cType = targetNode.type || ''
      const cTypeLabel = getConstraintTypeFromNodeType(cType)

      // 从约束节点的 sourceRef 中提取关联列名
      let columnNames = ''
      const sourceRef = (d.sourceRef || {}) as Record<string, unknown>
      if (sourceRef.columnId) {
        const col = props.data.columns?.find((c) => c.id === sourceRef.columnId)
        columnNames = col?.columnName || (sourceRef.columnId as string)
      } else if (sourceRef.columnIds) {
        columnNames = (sourceRef.columnIds as string[])
          .map((cid: string) => props.data.columns?.find((c) => c.id === cid)?.columnName || cid)
          .join(', ')
      } else if (d.column) {
        columnNames = d.column as string
      } else if (d.columns) {
        columnNames = (d.columns as string[]).join(', ')
      }

      result.push({
        nodeId: targetNode.id,
        nodeType: cType,
        constraintType: cTypeLabel,
        configName: (d.configName as string) || (d.constraintName as string) || '',
        columnNames,
        validationStatus: (d.validationStatus as string) || 'idle',
      })
    }

    // Step 3: 通过 children 数组查找（兜底，处理无直接边连接的约束节点）
    const childIds = props.data.children
    if (childIds && childIds.length > 0) {
      for (const childId of childIds) {
        if (seen.has(childId)) continue
        const childNode = nodes.value.find((n) => n.id === childId)
        if (!childNode || !constraintNodeTypes.has(childNode.type || '')) continue
        seen.add(childNode.id)

        const d = childNode.data as unknown as Record<string, unknown>
        const cType = childNode.type || ''
        const cTypeLabel = getConstraintTypeFromNodeType(cType)

        let columnNames = ''
        const sourceRef = (d.sourceRef || {}) as Record<string, unknown>
        if (sourceRef.columnId) {
          const col = props.data.columns?.find((c) => c.id === sourceRef.columnId)
          columnNames = col?.columnName || (sourceRef.columnId as string)
        } else if (sourceRef.columnIds) {
          columnNames = (sourceRef.columnIds as string[])
            .map((cid: string) => props.data.columns?.find((c) => c.id === cid)?.columnName || cid)
            .join(', ')
        } else if (d.column) {
          columnNames = d.column as string
        } else if (d.columns) {
          columnNames = (d.columns as string[]).join(', ')
        }

        result.push({
          nodeId: childNode.id,
          nodeType: cType,
          constraintType: cTypeLabel,
          configName: (d.configName as string) || (d.constraintName as string) || '',
          columnNames,
          validationStatus: (d.validationStatus as string) || 'idle',
        })
      }
    }

    return result
  })

  /**
   * 将节点类型（如 'notNullConstraint'）映射为约束类型标签（如 'NotNull'）
   *
   * @param nodeType - 节点类型字符串
   * @returns 约束类型标签
   */
  function getConstraintTypeFromNodeType(nodeType: string): string {
    const map: Record<string, string> = {
      notNullConstraint: 'NotNull',
      uniqueConstraint: 'Unique',
      foreignKeyConstraint: 'ForeignKey',
      allowedValuesConstraint: 'AllowedValues',
      rangeConstraint: 'Range',
      conditionalConstraint: 'Conditional',
      scriptedConstraint: 'Scripted',
      charsetConstraint: 'Charset',
      dateLogicConstraint: 'DateLogic',
    }
    return map[nodeType] || nodeType
  }

  /**
   * 获取约束类型的显示标签
   * 优先使用 i18n 翻译，如果翻译 key 不存在则回退到缩写
   *
   * @param type - 约束类型标签（如 'NotNull'）
   * @returns 显示用文本
   */
  function getConstraintTypeLabel(type: string): string {
    const key = `inspector.schemaNode.constraintTypes.${type}`
    const fallback: Record<string, string> = {
      NotNull: 'NN',
      Unique: 'UQ',
      ForeignKey: 'FK',
      AllowedValues: 'AV',
      Range: 'RG',
      Conditional: 'CD',
      Scripted: 'SC',
      Charset: 'CS',
      DateLogic: 'DL',
    }
    const translated = t(key)
    return translated !== key ? translated : fallback[type] || type
  }

  /**
   * 获取校验状态的显示文本
   *
   * @param status - 校验状态字符串
   * @returns 本地化的状态文本
   */
  function getValidationStatusText(status: string): string {
    const map: Record<string, string> = {
      idle: t('inspector.schemaNode.validationStatus.idle'),
      pass: t('inspector.schemaNode.validationStatus.pass'),
      error: t('inspector.schemaNode.validationStatus.error'),
      missing: t('inspector.schemaNode.validationStatus.missing'),
    }
    return map[status] || status
  }

  /**
   * 硬绑定转换处理函数
   * 将隐式匹配的列转换为显式绑定，调用后端 API 完成转换
   *
   * @param columnId - 需要转换的列 ID
   */
  async function convertToExplicitBinding(columnId: string) {
    // 获取当前 Schema 的 tableId
    const tableId = props.data.configName || props.data.tableName
    if (!tableId) return

    // 获取该列的隐式匹配信息
    const column = props.data.columns?.find((c) => c.id === columnId)
    if (!column) return

    // 从隐式匹配信息中获取推断的正则模式 ID
    const implicitInfo = column as unknown as Record<string, unknown>
    const patternId = implicitInfo?.implicitRegexPatternId || implicitInfo?.inferredPatternId
    if (!patternId) return

    try {
      await apiClient.post(`/api/latest/project/schemas/${tableId}/convert-to-explicit-binding`, {
        column_id: columnId,
        pattern_id: patternId,
        pattern_registry: 'expression_registry',
      })
    } catch (error) {
      logger.error('硬绑定转换失败:', error)
    }
  }

  /**
   * 更新数据函数
   * 将更新后的数据通过事件发送给父组件（InspectorPanel -> GraphStore）
   *
   * @param newData - 包含部分更新字段的对象
   */
  function updateData(newData: Partial<SchemaNodeData>) {
    emit('update:data', newData)
  }

  /**
   * 处理列名变更
   * 在列定义编辑器中修改列名后触发，更新对应列的 columnName
   *
   * @param columnId - 目标列 ID
   * @param newName - 新的列名
   */
  function handleColumnNameChange(columnId: string, newName: string) {
    if (!props.data.columns) return
    const updatedColumns = props.data.columns.map((col) =>
      col.id === columnId ? { ...col, columnName: newName } : col
    )
    updateData({ columns: updatedColumns })
  }

  /**
   * 处理数据类型变更
   * 在列定义编辑器中切换数据类型后触发，更新对应列的 dataType
   *
   * @param columnId - 目标列 ID
   * @param newType - 新的数据类型
   */
  function handleDataTypeChange(columnId: string, newType: DataType) {
    if (!props.data.columns) return
    const updatedColumns = props.data.columns.map((col) =>
      col.id === columnId ? { ...col, dataType: newType } : col
    )
    updateData({ columns: updatedColumns })
  }

  /**
   * 处理内嵌约束切换
   * 切换指定列的 notNull 或 unique 约束的启用/禁用状态
   *
   * @param columnId - 目标列 ID
   * @param type - 约束类型：'notNull' 或 'unique'
   */
  function handleToggleConstraint(columnId: string, type: 'notNull' | 'unique') {
    if (!props.data.columns) return
    const column = props.data.columns.find((c) => c.id === columnId)
    if (!column) return
    const currentValue = column.constraints?.[type] || false
    const updatedColumns = props.data.columns.map((col) => {
      if (col.id !== columnId) return col
      return {
        ...col,
        constraints: {
          ...col.constraints,
          [type]: !currentValue,
        },
      }
    })
    updateData({ columns: updatedColumns })
  }

  /**
   * 添加新列
   * 在列定义列表末尾追加一个新的 String 类型列，ID 使用时间戳生成
   */
  function handleAddColumn() {
    const currentColumns = props.data.columns || []
    const newId = `col_${Date.now()}`
    const newIndex = currentColumns.length + 1
    const newColumn: SchemaColumn = {
      id: newId,
      columnName: `column_${newIndex}`,
      dataType: 'String',
    }
    updateData({ columns: [...currentColumns, newColumn] })
  }

  function openSingleTableValidation() {
    validationTaskStore.openSingleTable(
      props.nodeId || props.data.configName,
      props.data.tableName || props.data.configName
    )
  }

  /**
   * 删除列
   * 从列定义列表中移除指定 ID 的列
   *
   * @param columnId - 要删除的列 ID
   */
  function handleDeleteColumn(columnId: string) {
    if (!props.data.columns) return
    const updatedColumns = props.data.columns.filter((col) => col.id !== columnId)
    updateData({ columns: updatedColumns })
  }

  /**
   * 获取数据类型的显示文本
   * 将完整的数据类型名称转换为简写形式
   *
   * @param type - 原始数据类型
   * @returns 简写后的数据类型文本
   */
  function getDataTypeDisplay(type: DataType): string {
    const map: Record<string, string> = {
      String: 'String',
      Integer: 'Int',
      Float: 'Float',
      Decimal: 'Decimal',
      Date: 'Date',
      Boolean: 'Boolean',
      Expression: 'Expr',
    }
    return map[type] || type
  }

  /**
   * 获取保存状态的图标
   *
   * @param state - 保存状态字符串
   * @returns 对应的图标字符
   */
  function getStatusIcon(state: string): string {
    switch (state) {
      case 'saved':
        return 'check'
      case 'draft':
        return 'circle'
      case 'error':
        return 'x'
      default:
        return 'info'
    }
  }

  /**
   * 获取保存状态的中文文本
   *
   * @param state - 保存状态字符串
   * @returns 对应的本地化状态文本
   */
  function getStatusText(state: string): string {
    switch (state) {
      case 'saved':
        return t('inspector.schemaNode.status.saved')
      case 'draft':
        return t('inspector.schemaNode.status.draft')
      case 'error':
        return t('inspector.schemaNode.status.error')
      default:
        return t('inspector.schemaNode.status.unknown')
    }
  }

  /**
   * 格式化日期时间字符串
   * 将日期字符串转换为本地化的日期时间格式
   *
   * @param dateString - 日期字符串
   * @returns 格式化后的日期时间字符串，如果为空则返回 '-'
   */
  function formatDateTime(dateString: string): string {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }
</script>

<style scoped src="./SchemaNodeInspector.css"></style>
