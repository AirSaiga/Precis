<!--
  @file JsonSchemaNodeInspector.vue
  @description JSON Schema 节点属性检查器组件

  完整镜像 SchemaNodeInspector 的七段结构，并适配 JSON 数据格式特点：
  - definition：配置名、表名（可编辑）
  - datasource：数据源信息（只读）
  - validationTask：单表校验入口（可编辑）
  - jsonParams：JSON 特有参数 — format / jsonPath / recordPath（可编辑，JSON 格式专属）
  - columns：递归字段编辑器（name/type/jsonPath 只读/nullable/primaryKey + 嵌套 children）
  - connectedConstraints：连接的约束节点（只读）
  - saveState + timestamp：保存状态与时间戳（只读）

  与 SchemaNodeInspector 的核心差异：
  1. 新增 jsonParams 段（JSON 解析参数无处可配，这是该节点的独有缺口）
  2. 列编辑器改为递归渲染（支持 object/array 的嵌套 children，缩进展示）
  3. 数据类型用 JsonDataType（string/number/boolean/object/array/null）而非 DataType
  4. 列级约束/属性切换用 nullable（类型层）+ primaryKey + constraints.notNull/unique
-->
<template>
  <div class="json-schema-inspector">
    <!-- 1. 定义区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.definition')"
      :badge="t('inspector.jsonSchemaNode.badgeEditable')"
      badge-class="editable"
    >
      <InspectorField
        :label="t('inspector.jsonSchemaNode.labels.configName')"
        :model-value="data.configName"
        :editable="true"
        :placeholder="t('inspector.jsonSchemaNode.placeholders.configName')"
        @update:model-value="(v) => updateData({ configName: v })"
      />
      <InspectorField
        :label="t('inspector.jsonSchemaNode.labels.tableName')"
        :model-value="data.tableName"
        :editable="true"
        :placeholder="t('inspector.jsonSchemaNode.placeholders.tableName')"
        @update:model-value="(v) => updateData({ tableName: v })"
      />
    </BaseInspector>

    <!-- 2. 数据源信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.datasource')"
      :badge="t('inspector.jsonSchemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        v-if="connectedSourcePreview"
        :label="t('inspector.jsonSchemaNode.labels.sourcePreview')"
        :model-value="connectedSourcePreview"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.jsonSchemaNode.labels.sourceFile')"
        :model-value="data.sourceFile || t('inspector.jsonSchemaNode.values.notConnected')"
        :editable="false"
      />
      <InspectorField
        v-if="data.sourceFilePath"
        :label="t('inspector.jsonSchemaNode.labels.filePath')"
        :model-value="data.sourceFilePath"
        type="path"
        :editable="false"
      />
    </BaseInspector>

    <!-- 3. 校验任务区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.validationTask')"
      :badge="t('inspector.jsonSchemaNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="validation-task-copy">
        {{ t('inspector.jsonSchemaNode.validationTask.description') }}
      </div>
      <button class="validate-table-btn" @click="openSingleTableValidation">
        {{ t('inspector.jsonSchemaNode.actions.validateTable') }}
      </button>
    </BaseInspector>

    <!-- 4. JSON 解析参数区块（可编辑，JSON 特有） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.jsonParams')"
      :badge="t('inspector.jsonSchemaNode.badgeEditable')"
      badge-class="editable"
    >
      <!-- format：JSON 格式变体 -->
      <div class="form-group">
        <label>{{ t('inspector.jsonSchemaNode.labels.format') }}</label>
        <select
          class="column-type-select"
          :value="data.format || 'auto'"
          @change="handleFormatChange"
        >
          <option value="auto">{{ t('inspector.jsonSchemaNode.formatOptions.auto') }}</option>
          <option value="array">{{ t('inspector.jsonSchemaNode.formatOptions.array') }}</option>
          <option value="lines">{{ t('inspector.jsonSchemaNode.formatOptions.lines') }}</option>
          <option value="object">{{ t('inspector.jsonSchemaNode.formatOptions.object') }}</option>
        </select>
      </div>
      <!-- jsonPath：从 JSON 中提取数据的 JSONPath 表达式 -->
      <InspectorField
        :label="t('inspector.jsonSchemaNode.labels.jsonPath')"
        :model-value="data.jsonPath || ''"
        :editable="true"
        :placeholder="t('inspector.jsonSchemaNode.placeholders.jsonPath')"
        @update:model-value="(v) => updateData({ jsonPath: v || undefined })"
      />
      <!-- recordPath：pandas read_json 的 record_path 参数 -->
      <InspectorField
        :label="t('inspector.jsonSchemaNode.labels.recordPath')"
        :model-value="data.recordPath || ''"
        :editable="true"
        :placeholder="t('inspector.jsonSchemaNode.placeholders.recordPath')"
        @update:model-value="(v) => updateData({ recordPath: v || undefined })"
      />
    </BaseInspector>

    <!-- 5. 字段定义区块（可编辑，递归渲染嵌套 children） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.columns')"
      :badge="t('inspector.jsonSchemaNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.jsonSchemaNode.labels.fieldCount') }}</label>
        <div class="column-count-badge">
          <span class="column-count-number">{{ countAllFields(data.columns) }}</span>
          <span class="column-count-unit">{{ t('inspector.jsonSchemaNode.units.fields') }}</span>
        </div>
      </div>

      <!-- 递归字段编辑列表 -->
      <div v-if="data.columns && data.columns.length > 0" class="columns-editor">
        <JsonFieldRow
          v-for="(column, index) in data.columns"
          :key="column.id"
          :column="column"
          :index="index"
          :depth="0"
          @rename="handleColumnNameChange"
          @type-change="handleDataTypeChange"
          @toggle-nullable="handleToggleNullable"
          @toggle-primary-key="handleTogglePrimaryKey"
          @toggle-constraint="handleToggleConstraint"
          @delete="handleDeleteColumn"
        />
      </div>

      <!-- 添加根级字段按钮 -->
      <button class="add-column-btn" @click="handleAddRootField">
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
        {{ t('inspector.jsonSchemaNode.actions.addField') }}
      </button>
    </BaseInspector>

    <!-- 6. 连接的约束区块（只读） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.connectedConstraints')"
      :badge="t('inspector.jsonSchemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <div v-if="connectedConstraints.length > 0" class="connected-constraints-list">
        <div v-for="c in connectedConstraints" :key="c.nodeId" class="connected-constraint-item">
          <div class="constraint-item-header">
            <span class="constraint-type-badge" :class="`ctype-${c.constraintType}`">{{
              getConstraintTypeLabel(c.constraintType)
            }}</span>
            <span class="constraint-name">{{ c.configName || c.nodeId }}</span>
          </div>
          <div class="constraint-item-detail">
            <span class="constraint-detail-label"
              >{{ t('inspector.jsonSchemaNode.labels.targetColumn') }}:</span
            >
            <span class="constraint-detail-value">{{ c.columnNames || '-' }}</span>
          </div>
          <div v-if="c.validationStatus" class="constraint-item-detail">
            <span class="constraint-detail-label"
              >{{ t('inspector.jsonSchemaNode.labels.validationStatus') }}:</span
            >
            <span class="constraint-status-badge" :class="`status-${c.validationStatus}`">{{
              getValidationStatusText(c.validationStatus)
            }}</span>
          </div>
        </div>
      </div>
      <div v-else class="no-constraints">
        {{ t('inspector.jsonSchemaNode.values.noConnectedConstraints') }}
      </div>
    </BaseInspector>

    <!-- 7. 保存状态区块（只读） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.saveState')"
      :badge="t('inspector.jsonSchemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.jsonSchemaNode.labels.currentStatus') }}</label>
        <div class="save-status-display" :class="`status-${data.saveState}`">
          <AppIcon class="status-icon" :name="getStatusIcon(data.saveState)" :size="16" />
          <span class="status-text">{{ getStatusText(data.saveState) }}</span>
        </div>
      </div>
      <InspectorField
        v-if="data.lastSaved"
        :label="t('inspector.jsonSchemaNode.labels.lastSaved')"
        :model-value="formatDateTime(data.lastSaved)"
        :editable="false"
      />
    </BaseInspector>

    <!-- 8. 时间戳区块（只读） -->
    <BaseInspector
      :title="t('inspector.jsonSchemaNode.groups.timestamp')"
      :badge="t('inspector.jsonSchemaNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        v-if="data.createdAt"
        :label="t('inspector.jsonSchemaNode.labels.createdAt')"
        :model-value="formatDateTime(data.createdAt)"
        :editable="false"
      />
      <InspectorField
        v-if="data.updatedAt"
        :label="t('inspector.jsonSchemaNode.labels.updatedAt')"
        :model-value="formatDateTime(data.updatedAt)"
        :editable="false"
      />
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file JsonSchemaNodeInspector.vue
   * @description JSON Schema 节点属性检查器
   *
   * 与 SchemaNodeInspector 的核心差异：
   * - 新增 jsonParams 段（format/jsonPath/recordPath，JSON 解析专属）
   * - 列编辑器递归渲染（支持嵌套 children）
   * - 数据类型用 JsonDataType，属性切换含 nullable/primaryKey
   */
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { storeToRefs } from 'pinia'
  import { useGraphStore } from '@/stores/graphStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { JsonSchemaNodeData, JsonSchemaColumn, JsonDataType } from '@/types/nodes'
  import { findJsonSchemaColumnById } from '@/utils/nodes/json/columnFinder'
  import JsonFieldRow from './JsonFieldRow.vue'

  type JsonFormat = 'auto' | 'array' | 'lines' | 'object'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const validationTaskStore = useValidationTaskStore()
  const { nodes, edges } = storeToRefs(graphStore)

  interface Props {
    data: JsonSchemaNodeData
    nodeId?: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:data': [data: Partial<JsonSchemaNodeData>]
  }>()

  /**
   * 递归统计所有字段数量（含嵌套子字段）
   */
  function countAllFields(columns: JsonSchemaColumn[] | undefined): number {
    if (!columns) return 0
    let n = 0
    for (const c of columns) {
      n += 1
      if (c.children && c.children.length > 0) n += countAllFields(c.children)
    }
    return n
  }

  /** 连接的 JsonSourcePreview 节点名称 */
  const connectedSourcePreview = computed(() => {
    const sourceNodeId = props.data.sourceNodeId
    if (!sourceNodeId) return null
    const sourceNode = nodes.value.find(
      (n) => n.id === sourceNodeId && n.type === 'jsonSourcePreview'
    )
    if (!sourceNode) return null
    return (
      ((sourceNode.data as unknown as Record<string, unknown>).sourceName as string) ||
      sourceNode.id
    )
  })

  /** 连接的约束节点信息 */
  interface ConnectedConstraintInfo {
    nodeId: string
    constraintType: string
    configName: string
    columnNames: string
    validationStatus: string
  }

  /**
   * 计算属性：获取所有连接到当前 JSON Schema 节点的约束节点信息
   * 策略与 SchemaNodeInspector 一致：出边扫描 + children 兜底，seen 去重
   */
  const connectedConstraints = computed<ConnectedConstraintInfo[]>(() => {
    if (!props.nodeId) return []
    const schemaId = props.nodeId

    const outgoingEdges = edges.value.filter((e) => e.source === schemaId)
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

    /** 从约束节点 data 提取关联的列名（递归查找嵌套列） */
    const resolveColumnNames = (d: Record<string, unknown>): string => {
      const sourceRef = (d.sourceRef || {}) as Record<string, unknown>
      if (sourceRef.columnId) {
        const col = findJsonSchemaColumnById(
          props.data.columns,
          sourceRef.columnId as string
        )?.column
        return col?.columnName || (sourceRef.columnId as string)
      }
      if (sourceRef.columnIds) {
        return (sourceRef.columnIds as string[])
          .map(
            (cid) => findJsonSchemaColumnById(props.data.columns, cid)?.column?.columnName || cid
          )
          .join(', ')
      }
      if (d.column) return d.column as string
      if (d.columns) return (d.columns as string[]).join(', ')
      return ''
    }

    /** 处理单个约束节点，累加到 result */
    const handleConstraintNode = (node: (typeof nodes.value)[number]) => {
      if (seen.has(node.id)) return
      seen.add(node.id)
      const d = node.data as unknown as Record<string, unknown>
      const cType = node.type || ''
      result.push({
        nodeId: node.id,
        constraintType: getConstraintTypeFromNodeType(cType),
        configName: (d.configName as string) || (d.constraintName as string) || '',
        columnNames: resolveColumnNames(d),
        validationStatus: (d.validationStatus as string) || 'idle',
      })
    }

    // 出边扫描
    for (const edge of outgoingEdges) {
      const targetNode = nodes.value.find((n) => n.id === edge.target)
      if (!targetNode || !constraintNodeTypes.has(targetNode.type || '')) continue
      handleConstraintNode(targetNode)
    }

    // children 兜底
    const childIds = props.data.children
    if (childIds && childIds.length > 0) {
      for (const childId of childIds) {
        const childNode = nodes.value.find((n) => n.id === childId)
        if (!childNode || !constraintNodeTypes.has(childNode.type || '')) continue
        handleConstraintNode(childNode)
      }
    }

    return result
  })

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

  function getConstraintTypeLabel(type: string): string {
    const key = `inspector.jsonSchemaNode.constraintTypes.${type}`
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

  function getValidationStatusText(status: string): string {
    const map: Record<string, string> = {
      idle: t('inspector.jsonSchemaNode.validationStatus.idle'),
      pass: t('inspector.jsonSchemaNode.validationStatus.pass'),
      error: t('inspector.jsonSchemaNode.validationStatus.error'),
      missing: t('inspector.jsonSchemaNode.validationStatus.missing'),
    }
    return map[status] || status
  }

  /** 更新数据（透传给 InspectorPanel → GraphStore） */
  function updateData(newData: Partial<JsonSchemaNodeData>) {
    emit('update:data', newData)
  }

  /** format 下拉变更处理（从模板移出，避免模板内的 TS 类型断言问题） */
  function handleFormatChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value as JsonFormat
    updateData({ format: value })
  }

  /**
   * 递归更新列树：返回一棵新的 columns 树，目标列由 updater 函数变换
   * 用于所有列级编辑（改名/改类型/切换属性/删除）
   */
  function updateColumnRecursive(
    columns: JsonSchemaColumn[],
    columnId: string,
    updater: (col: JsonSchemaColumn) => JsonSchemaColumn
  ): JsonSchemaColumn[] {
    return columns.map((col) => {
      if (col.id === columnId) return updater({ ...col })
      if (col.children) {
        return { ...col, children: updateColumnRecursive(col.children, columnId, updater) }
      }
      return col
    })
  }

  /** 字段名变更 */
  function handleColumnNameChange(columnId: string, newName: string) {
    if (!props.data.columns) return
    const updated = updateColumnRecursive(props.data.columns, columnId, (col) => ({
      ...col,
      columnName: newName,
    }))
    updateData({ columns: updated })
  }

  /** 数据类型变更 */
  function handleDataTypeChange(columnId: string, newType: JsonDataType) {
    if (!props.data.columns) return
    const updated = updateColumnRecursive(props.data.columns, columnId, (col) => ({
      ...col,
      dataType: newType,
    }))
    updateData({ columns: updated })
  }

  /** nullable 切换（类型层非空） */
  function handleToggleNullable(columnId: string) {
    if (!props.data.columns) return
    const target = findJsonSchemaColumnById(props.data.columns, columnId)?.column
    if (!target) return
    const updated = updateColumnRecursive(props.data.columns, columnId, (col) => ({
      ...col,
      nullable: !(col.nullable ?? true),
    }))
    updateData({ columns: updated })
  }

  /** primaryKey 切换 */
  function handleTogglePrimaryKey(columnId: string) {
    if (!props.data.columns) return
    const updated = updateColumnRecursive(props.data.columns, columnId, (col) => ({
      ...col,
      primaryKey: !col.primaryKey,
    }))
    updateData({ columns: updated })
  }

  /** 内嵌约束切换（约束层 notNull/unique） */
  function handleToggleConstraint(columnId: string, type: 'notNull' | 'unique') {
    if (!props.data.columns) return
    const updated = updateColumnRecursive(props.data.columns, columnId, (col) => ({
      ...col,
      constraints: {
        ...col.constraints,
        [type]: !col.constraints?.[type],
      },
    }))
    updateData({ columns: updated })
  }

  /** 添加根级字段 */
  function handleAddRootField() {
    const currentColumns = props.data.columns || []
    const newIndex = countAllFields(currentColumns) + 1
    const newColumn: JsonSchemaColumn = {
      id: `col_${Date.now()}`,
      columnName: `field_${newIndex}`,
      jsonPath: `$.field_${newIndex}`,
      dataType: 'string',
      nullable: true,
    }
    updateData({ columns: [...currentColumns, newColumn] })
  }

  /** 删除字段（递归过滤） */
  function handleDeleteColumn(columnId: string) {
    if (!props.data.columns) return
    const filterRecursive = (columns: JsonSchemaColumn[]): JsonSchemaColumn[] =>
      columns
        .filter((col) => col.id !== columnId)
        .map((col) => ({
          ...col,
          children: col.children ? filterRecursive(col.children) : undefined,
        }))
    updateData({ columns: filterRecursive(props.data.columns) })
  }

  function openSingleTableValidation() {
    validationTaskStore.openSingleTable(
      props.nodeId || props.data.configName,
      props.data.tableName || props.data.configName
    )
  }

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

  function getStatusText(state: string): string {
    switch (state) {
      case 'saved':
        return t('inspector.jsonSchemaNode.status.saved')
      case 'draft':
        return t('inspector.jsonSchemaNode.status.draft')
      case 'error':
        return t('inspector.jsonSchemaNode.status.error')
      default:
        return t('inspector.jsonSchemaNode.status.unknown')
    }
  }

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

<style scoped src="./JsonSchemaNodeInspector.css"></style>
