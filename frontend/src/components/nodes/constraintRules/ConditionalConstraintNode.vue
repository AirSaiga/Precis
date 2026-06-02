/** * @file ConditionalConstraintNode.vue * @description 条件约束节点组件 * * 核心功能： * -
配置条件表达式规则 * - 接收多个 Schema 节点列的输入（if-then-else 结构） * -
执行条件校验（根据条件表达式验证数据） * - 显示校验状态和违反条件的数量 * * 数据流： *
Schema列(条件) → [if Handle] → ConditionalConstraintNode → 校验结果 * Schema列(值) → [then Handle] →
*/
<template>
  <ConstraintNodeFrame
    class="conditional-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="orange"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.conditionalConstraintNode.title')"
    icon="🔀"
    :help-text="t('customNodes.constraintRules.conditionalConstraintNode.helpTooltip')"
    :error-count="errorCount"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('common.delete')"
    :error-title="t('common.error')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :handles="[
      {
        id: `target-if-${id}`,
        type: 'target',
        position: Position.Left,
        color: 'warning',
        topOffset: '30%',
        title: t('customNodes.constraintRules.conditionalConstraintNode.inputIfHandle'),
      },
      {
        id: `target-then-${id}`,
        type: 'target',
        position: Position.Left,
        color: 'info',
        topOffset: '78%',
        title: t('customNodes.constraintRules.conditionalConstraintNode.inputThenHandle'),
      },
      {
        id: `target-input-${id}`,
        type: 'target',
        position: Position.Left,
        color: 'info',
        topOffset: '78%',
        title: t('customNodes.constraintRules.conditionalConstraintNode.inputThenHandle'),
      },
      {
        id: `source-output-${id}`,
        type: 'source',
        position: Position.Right,
        color: 'success',
        title: t('customNodes.constraintRules.conditionalConstraintNode.outputHandle'),
      },
    ]"
    @delete="handleDelete"
    @save="handleSave"
  >
    <ConstraintNodeLayout
      :status="validationStatus"
      :status-text="statusText"
      :error-count="errorCount"
      :show-guide="selected"
      :show-details="showDetails"
    >
      <!-- 信息区：表名与条件 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.conditionalConstraintNode.tableLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: !tableDisplay }">{{
            tableDisplay || t('customNodes.constraintRules.conditionalConstraintNode.tableEmpty')
          }}</span>
        </div>

        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.conditionalConstraintNode.ifLabel')
          }}</span>
          <span class="info-value if-wrap" :class="{ placeholder: !hasIf }" :title="ifDisplay">{{
            ifDisplay
          }}</span>
        </div>

        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.conditionalConstraintNode.thenLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasThen }">{{ thenDisplay }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.conditionalConstraintNode.detailsTitle') }}
        </div>

        <div v-if="props.data.lastValidation" class="details-metrics">
          <div class="metric">
            {{ t('customNodes.constraintRules.conditionalConstraintNode.totalRows') }}:
            {{ props.data.lastValidation.totalRows || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.conditionalConstraintNode.matchCount') }}:
            {{ props.data.lastValidation.matchCount || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.conditionalConstraintNode.errorCount') }}:
            {{ props.data.lastValidation.errorCount || 0 }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors" :key="idx" class="details-error">
            {{ msg }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.conditionalConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  /**
   * @file ConditionalConstraintNode.vue
   * @description 条件约束节点组件 (Conditional Constraint Node)
   *
   * # 核心业务逻辑
   * 该组件用于实现 "如果 A 满足条件，则 B 必须满足条件" 形式的复杂数据质量约束。
   * 它连接两个数据流（可以是同一个表或不同表），并允许用户配置 IF 和 THEN 的逻辑。
   *
   * # 架构设计
   * 1. **双输入端口 (Dual Inputs)**:
   *    - `target-if`: 接收作为 IF 条件判断依据的数据列。
   *    - `target-then`: 接收需要被校验（THEN 部分）的数据列。
   *    - `target-input`: 为了兼容旧版连线保留的输入端口。
   *
   * 2. **稳定引用 (Stable References)**:
   *    - 使用 `nodeId` + `columnId` 的组合来唯一确定引用的数据列，而不是依赖易变的列名。
   *    - 这确保了即使上游改名，只要 ID 不变，约束关系依然有效。
   *
   * 3. **实时响应式设计 (Reactive UI)**:
   *    - `ifDisplay`: 实现了双模式显示。在编辑态（Selected）下直接读取本地临时状态 (`localIfConditions`)，
   *      确保用户操作（如切换下拉框）能零延迟反馈到 UI 摘要中。
   *    - 在非编辑态下，回退到读取持久化的 `props.data`，确保展示的是已保存的状态。
   *
   * 4. **自动校验机制 (Auto-Validation)**:
   *    - 通过 `watch` 监听关键配置的变化，使用防抖 (Debounce) 机制触发后端校验 `/validate`。
   *    - 校验结果（通过率、错误行数）会回写到节点状态中，通过不同颜色的边框和徽章直观展示。
   */

  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import NodeBadge from '@/components/ui/NodeBadge.vue'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { ConditionalConstraintNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useConditional } from '@/composables/nodes/constraints/useConditional'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'

  const props = defineProps<{
    id: string // 节点在 Vue Flow 图中的唯一 ID
    data: ConditionalConstraintNodeData // 节点的持久化数据，包含配置和校验状态
    selected?: boolean // Vue Flow 注入的属性，表示当前节点是否被选中
  }>()

  const { t } = useI18n()
  const store = useGraphStore() // 全局图状态管理，用于获取其他节点信息和操作边
  const { showConfirm } = useGlobalConfirm()

  const {
    isSaving,
    validationStatus,
    validationErrors,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
    metrics,
    handleSave,
    handleDelete,
  } = useConstraintNodeBase(props, {
    statusI18nPrefix: 'customNodes.constraintRules.conditionalConstraintNode',
  })
  // useConditional: 封装了调用后端校验 API 的逻辑
  // 第二个参数是回调，这里暂时传入空函数，因为我们主要依赖响应式状态更新
  const { performValidation } = useConditional(
    props,
    (() => undefined) as unknown as (event: string, ...args: unknown[]) => void
  )

  /**
   * 格式化 THEN 部分的条件配置为可读字符串
   * 用于 UI 展示，支持 DSL 对象格式和旧版字符串格式
   */
  const formatCondition = (config: unknown) => {
    // 兼容旧版：直接存储函数名的字符串
    if (typeof config === 'string') {
      const s = config.trim()
      if (!s) return t('customNodes.constraintRules.conditionalConstraintNode.unknownCondition')
      return `${t('customNodes.constraintRules.conditionalConstraintNode.function')}: ${s}`
    }
    // 新版：DSL 对象 { operator, value, values, ref_column }
    if (typeof config === 'object' && config !== null) {
      const configObj = config as {
        operator?: string
        value?: string | number
        values?: string[]
        ref_column?: string
      }
      // 列间比较
      if (configObj.ref_column) {
        const opMap: Record<string, string> = {
          eq: '=',
          ne: '≠',
          gt: '>',
          gte: '≥',
          lt: '<',
          lte: '≤',
        }
        return `${opMap[configObj.operator || 'eq'] || configObj.operator} ${configObj.ref_column} 列`
      }
      switch (configObj.operator) {
        case 'not_null':
          return t('customNodes.constraintRules.conditionalConstraintNode.notNull')
        case 'greater_than':
          return `${t('customNodes.constraintRules.conditionalConstraintNode.greaterThan')} ${configObj.value}`
        case 'in':
          return `${t('customNodes.constraintRules.conditionalConstraintNode.inSet')}: [${(configObj.values || []).join(', ')}]`
        default:
          if (configObj.value !== undefined) {
            const opMap: Record<string, string> = {
              eq: '=',
              ne: '≠',
              neq: '≠',
              gt: '>',
              gte: '≥',
              lt: '<',
              lte: '≤',
            }
            return `${opMap[configObj.operator || 'eq'] || configObj.operator} ${configObj.value}`
          }
          return `${t('customNodes.constraintRules.conditionalConstraintNode.operator')}: ${configObj.operator}`
      }
    }
    return t('customNodes.constraintRules.conditionalConstraintNode.unknownCondition')
  }

  // --- 状态计算与指标 ---

  // --- 配置概览 ---

  /**
   * 计算配置概览显示
   * 显示当前条件配置的关键信息
   */
  const configOverview = computed(() => {
    const data = props.data
    if (!data.ifRef?.columnId && !data.thenRef?.columnId) {
      return null
    }

    const result: {
      ifColumn?: string
      ifOperator?: string
      ifValue?: string
      thenColumn?: string
      conditionMode?: string
    } = {}

    // IF 列
    if (data.ifRef?.columnId) {
      const nodeId = data.ifRef.nodeId
      const sourceNode = store.nodes.find((n) => n.id === nodeId)
      if (sourceNode && sourceNode.type === 'schema') {
        const columns = (sourceNode.data as unknown as Record<string, unknown>).columns as
          | Array<{ id: string; columnName: string }>
          | undefined
        const col = (columns || []).find((c) => c.id === data.ifRef!.columnId)
        result.ifColumn = col?.columnName || data.ifColumn || ''
      } else if (sourceNode && sourceNode.type === 'transformOutput') {
        result.ifColumn =
          ((sourceNode.data as Record<string, unknown>).columnName as string) || data.ifColumn || ''
      } else {
        result.ifColumn = data.ifColumn || ''
      }
    }

    // IF 操作符和值
    const firstCondition = normalizedIfConditions.value[0]
    if (firstCondition) {
      const opMap: Record<string, string> = {
        eq: '=',
        neq: '!=',
        not_null: 'Not Null',
        greater_than: '>',
        in: 'In',
      }
      result.ifOperator = opMap[firstCondition.operator] || firstCondition.operator

      if (firstCondition.operator === 'in' && firstCondition.values?.length) {
        result.ifValue = `[${firstCondition.values.join(', ')}]`
      } else if (firstCondition.operator !== 'not_null' && firstCondition.value) {
        result.ifValue = String(firstCondition.value)
      }
    }

    // THEN 列
    if (data.thenRef?.columnId) {
      const nodeId = data.thenRef.nodeId
      const sourceNode = store.nodes.find((n) => n.id === nodeId)
      if (sourceNode && sourceNode.type === 'schema') {
        const columns = (sourceNode.data as unknown as Record<string, unknown>).columns as
          | Array<{ id: string; columnName: string }>
          | undefined
        const col = (columns || []).find((c) => c.id === data.thenRef!.columnId)
        result.thenColumn = col?.columnName || data.thenColumn || ''
      } else if (sourceNode && sourceNode.type === 'transformOutput') {
        result.thenColumn =
          ((sourceNode.data as Record<string, unknown>).columnName as string) ||
          data.thenColumn ||
          ''
      } else {
        result.thenColumn = data.thenColumn || ''
      }
    }

    // THEN 条件模式
    const cfg = data.thenConditionConfig
    if (typeof cfg === 'string' && cfg.trim()) {
      result.conditionMode = `${t('customNodes.constraintRules.conditionalConstraintNode.function')}: ${cfg}`
    } else if (cfg && typeof cfg === 'object') {
      const cfgObj = cfg as { operator?: string; value?: string | number; values?: string[] }
      if (cfgObj.operator) {
        const modeText = formatCondition(cfg)
        result.conditionMode = `${t('customNodes.constraintRules.conditionalConstraintNode.dslMode')}: ${modeText}`
      }
    }

    return Object.keys(result).length > 0 ? result : null
  })

  // --- 数据标准化 (Normalization) ---

  /**
   * 将存储的数据结构标准化为前端统一处理的格式
   * 兼容旧版单条件配置和新版多条件数组配置
   */
  const normalizeIfConditions = (data: ConditionalConstraintNodeData) => {
    if (Array.isArray(data.ifConditions) && data.ifConditions.length > 0) {
      return data.ifConditions.map((c) => ({
        ref: c.ref,
        column: c.column,
        edgeId: c.edgeId,
        operator: c.operator || 'eq',
        value: c.value || '',
        values: Array.isArray(c.values) ? c.values : [],
      }))
    }
    // 迁移逻辑：将旧版单字段配置转换为数组的第一个元素
    return [
      {
        ref: data.ifRef ? { nodeId: data.ifRef.nodeId, columnId: data.ifRef.columnId } : undefined,
        column: data.ifColumn || '',
        edgeId: undefined,
        operator: 'eq' as const,
        value: data.ifValue || '',
        values: [],
      },
    ]
  }

  const normalizedIfConditions = computed(() => normalizeIfConditions(props.data))

  // --- 配置完整性检查 ---

  const hasThen = computed(() => !!props.data.thenRef?.nodeId && !!props.data.thenRef?.columnId)

  /**
   * 检查单个 IF 条件是否配置完整
   * - not_null 不需要值
   * - in 需要至少一个值
   * - 其他操作符需要非空值
   */
  const isIfConditionReady = (cond: (typeof normalizedIfConditions.value)[number]) => {
    if (!cond.ref?.nodeId || !cond.ref?.columnId) return false
    if (cond.operator === 'not_null') return true
    if (cond.operator === 'in') return (cond.values || []).length > 0
    return String(cond.value || '').trim().length > 0
  }

  // 过滤出已经关联了具体列的条件
  const configuredIfConditions = computed(() =>
    normalizedIfConditions.value.filter((c) => !!c.ref?.nodeId && !!c.ref?.columnId)
  )
  // 是否存在至少一个有效的 IF 配置
  const hasIf = computed(() => configuredIfConditions.value.length > 0)
  // 是否所有 IF 条件的值都已经填好
  const hasIfValue = computed(
    () =>
      configuredIfConditions.value.length > 0 &&
      configuredIfConditions.value.every((c) => isIfConditionReady(c))
  )
  // THEN 部分的条件是否已配置
  const hasThenCondition = computed(() => {
    const cfg = props.data.thenConditionConfig
    if (typeof cfg === 'string') return cfg.trim().length > 0
    if (cfg && typeof cfg === 'object') return !!(cfg as Record<string, unknown>).operator
    return false
  })

  // --- 数据源查找 ---

  /**
   * 计算可用的源表列表
   * 来源：图存储中所有类型为 'schema' 的节点
   */
  const availableSourceTables = computed(() => {
    return store.nodes
      .filter((n) => n.type === 'schema')
      .map((n) => ({
        id: n.id,
        tableName: ((n.data as unknown as Record<string, unknown>)?.tableName as string) || n.id,
      }))
  })

  // --- 本地状态 (Local State) ---
  // 用于在编辑过程中暂存用户的输入，直到触发更新或校验
  const localSourceNodeId = ref<string>('') // 当前选中的源表 ID
  const localThenColumnId = ref<string>('') // 当前选中的 THEN 列 ID
  const localIfLogic = ref<'and' | 'or'>((props.data.ifLogic as 'and' | 'or') || 'and')

  type IfOperator = 'eq' | 'neq' | 'in' | 'not_null' | 'greater_than'
  type IfConditionConfig = {
    ref?: { nodeId: string; columnId: string }
    column?: string
    operator: IfOperator
    value?: string
    values?: string[]
    edgeId?: string
  }
  // IF 条件列表的本地副本，支持动态增删改
  const localIfConditions = ref<
    Array<{
      columnId: string
      operator: IfOperator
      value: string
      valuesText: string
      edgeId?: string
    }>
  >([])

  type ConditionMode = 'dsl' | 'function'
  type DslOperator = 'not_null' | 'greater_than' | 'in'

  // THEN 条件的编辑模式：DSL (图形化配置) 或 Function (高级函数名)
  const localConditionMode = ref<ConditionMode>(
    typeof props.data.thenConditionConfig === 'string' ? 'function' : 'dsl'
  )
  const localOperator = ref<DslOperator>('not_null')
  const localGreaterThanValue = ref<string>('')
  const localInValues = ref<string>('')
  const localFunctionName = ref<string>(
    typeof props.data.thenConditionConfig === 'string' ? props.data.thenConditionConfig : ''
  )

  // 查找当前关联的源节点对象
  const sourceNode = computed(() => {
    // 优先级：本地选择 > props.thenRef > props.ifRef > 第一个条件
    const nodeId =
      localSourceNodeId.value ||
      props.data.thenRef?.nodeId ||
      normalizedIfConditions.value[0]?.ref?.nodeId ||
      props.data.ifRef?.nodeId
    if (!nodeId) return null
    return store.nodes.find((n) => n.id === nodeId) || null
  })

  // 根据当前源节点，获取可用的列列表
  const availableSourceColumns = computed(() => {
    const nodeId =
      localSourceNodeId.value ||
      props.data.thenRef?.nodeId ||
      normalizedIfConditions.value[0]?.ref?.nodeId ||
      props.data.ifRef?.nodeId
    if (!nodeId) return []
    const node = store.nodes.find((n) => n.id === nodeId)
    if (!node) return []
    if (node.type === 'schema') {
      return ((node.data as unknown as Record<string, unknown>).columns || []) as Array<{
        id: string
        columnName: string
      }>
    }
    if (node.type === 'transformOutput') {
      const colName = (node.data as Record<string, unknown>).columnName as string | undefined
      const colId = (node.data as Record<string, unknown>).columnName as string | undefined
      return colName ? [{ id: colId || colName, columnName: colName }] : []
    }
    return []
  })

  // --- UI 显示计算属性 ---

  const tableDisplay = computed(() => props.data.table || '')

  /**
   * 计算 IF 部分的摘要显示文本
   *
   * !重要优化 (Fix Reactivity Issue):
   * 为了解决用户在下拉框选择时摘要不更新的问题，这里引入了双重逻辑：
   * 1. 如果节点被选中 (Selected)，直接读取 localIfConditions，保证 0 延迟响应。
   * 2. 如果未选中，读取 configuredIfConditions (props.data)，保证持久化展示。
   */
  const ifDisplay = computed(() => {
    const useLocal = props.selected

    let conditions
    if (useLocal) {
      // 编辑态：从本地状态构建临时配置对象
      conditions = localIfConditions.value
        .filter((c) => !!c.columnId)
        .map((c) => ({
          ref: { columnId: c.columnId },
          column: '', // 这里的 column 是空的，依靠下方动态查找补全
          operator: c.operator,
          value: c.value,
          values: c.valuesText
            ? c.valuesText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        }))
    } else {
      // 查看态：直接使用已保存的配置
      conditions = configuredIfConditions.value
    }

    if (conditions.length === 0)
      return t('customNodes.constraintRules.conditionalConstraintNode.waitingForIf')

    const logic = (useLocal ? localIfLogic.value : props.data.ifLogic || 'and').toLowerCase()
    const joiner =
      logic === 'or'
        ? ` ${t('customNodes.constraintRules.conditionalConstraintNode.logicOr')} `
        : ` ${t('customNodes.constraintRules.conditionalConstraintNode.logicAnd')} `

    const opText = (op: string) => {
      if (op === 'eq') return '='
      if (op === 'neq') return '!='
      if (op === 'greater_than') return '>'
      if (op === 'in') return 'in'
      if (op === 'not_null') return 'not null'
      return op
    }

    return conditions
      .map((c) => {
        // 动态查找列名：即使 c.column 是旧值，这里也能通过 ID 找到最新列名
        const foundCol = availableSourceColumns.value.find((col) => col.id === c.ref?.columnId)
        const colName = foundCol?.columnName || c.column || ''
        if (c.operator === 'not_null') return `${colName} ${opText('not_null')}`
        if (c.operator === 'in')
          return `${colName} ${opText('in')} [${(c.values || []).join(', ')}]`
        const val = String(c.value || '').trim()
        return val
          ? `${colName} ${opText(c.operator)} ${val}`
          : `${colName} ${opText(c.operator)} ${t('customNodes.constraintRules.conditionalConstraintNode.ifValueEmpty')}`
      })
      .join(joiner)
  })

  // 计算 THEN 部分的摘要显示文本
  const thenDisplay = computed(() => {
    if (!hasThen.value)
      return t('customNodes.constraintRules.conditionalConstraintNode.waitingForThen')
    // 同样应用动态列名查找
    const foundCol = availableSourceColumns.value.find(
      (col) => col.id === props.data.thenRef?.columnId
    )
    const colName = foundCol?.columnName || props.data.thenColumn || ''
    return `${colName} ${t('customNodes.constraintRules.conditionalConstraintNode.shouldSatisfy')} ${formatCondition(props.data.thenConditionConfig)}`
  })

  // 控制是否显示引导步骤 (当配置未完成时显示)
  const showGuide = computed(() => {
    if (validationStatus.value === 'error') return false // 出错时优先显示错误
    return !hasIf.value || !hasThen.value || !hasIfValue.value || !hasThenCondition.value
  })

  // 辅助函数：获取当前上下文中的 Schema 节点 ID
  const getSchemaNodeIdForEdges = () => {
    return (
      localSourceNodeId.value ||
      props.data.thenRef?.nodeId ||
      normalizedIfConditions.value[0]?.ref?.nodeId ||
      props.data.ifRef?.nodeId ||
      ''
    )
  }

  // --- 状态同步 (Sync) ---

  /**
   * 将 props.data 同步到本地编辑状态
   * 当外部数据更新（如撤销/重做，或初次加载）时调用
   */
  const syncLocalFromProps = () => {
    const nodeId =
      props.data.thenRef?.nodeId ||
      normalizedIfConditions.value[0]?.ref?.nodeId ||
      props.data.ifRef?.nodeId ||
      ''
    if (!localSourceNodeId.value && nodeId) localSourceNodeId.value = nodeId
    localThenColumnId.value = props.data.thenRef?.columnId || ''
    localIfLogic.value = (props.data.ifLogic as 'and' | 'or') || 'and'

    // 映射 IF 条件
    localIfConditions.value = normalizedIfConditions.value.map((c) => ({
      columnId: c.ref?.columnId || '',
      operator: c.operator,
      value: String(c.value || ''),
      valuesText: (c.values || []).join(', '),
      edgeId: (c as Record<string, unknown>).edgeId as string | undefined,
    }))

    // 映射 THEN 条件配置
    const cfg = props.data.thenConditionConfig
    if (typeof cfg === 'string') {
      localConditionMode.value = 'function'
      localFunctionName.value = cfg
      return
    }
    localConditionMode.value = 'dsl'
    const op = (cfg as Record<string, unknown>).operator as DslOperator | undefined
    localOperator.value = op || 'not_null'
    if (localOperator.value === 'greater_than') {
      localGreaterThanValue.value =
        (cfg as Record<string, unknown>).value !== undefined
          ? String((cfg as Record<string, unknown>).value)
          : ''
    } else if (localOperator.value === 'in') {
      const cfgRecord = cfg as Record<string, unknown>
      const values = Array.isArray(cfgRecord.values) ? cfgRecord.values : []
      localInValues.value = values.map((v) => String(v)).join(', ')
    } else {
      localGreaterThanValue.value = ''
      localInValues.value = ''
    }
  }

  // 初始化同步
  syncLocalFromProps()

  // 监听 props 变化，反向同步到 local state
  watch(
    () => [
      props.data.thenRef?.nodeId,
      props.data.thenRef?.columnId,
      props.data.ifLogic,
      JSON.stringify(props.data.ifConditions),
      props.data.ifRef?.nodeId,
      props.data.ifRef?.columnId,
      props.data.ifValue,
      props.data.thenConditionConfig,
    ],
    () => syncLocalFromProps()
  )

  // --- 校验调度 (Validation Scheduler) ---

  const validateNow = async () => {
    await nextTick()
    // 调用 composable 中的校验逻辑
    await performValidation().catch(() => undefined)
  }

  let validationTimer: number | undefined
  onBeforeUnmount(() => { if (validationTimer) clearTimeout(validationTimer) })
  /**
   * 防抖校验函数
   * 避免用户输入过程中频繁触发后端请求
   */
  const scheduleValidation = () => {
    if (validationTimer) window.clearTimeout(validationTimer)
    validationTimer = window.setTimeout(() => {
      validateNow().catch(() => undefined)
    }, 300) // 300ms 延迟
  }

  // 监听关键配置变化，触发自动校验
  watch(
    () => [
      props.data.thenRef?.nodeId,
      props.data.thenRef?.columnId,
      props.data.ifLogic,
      JSON.stringify(props.data.ifConditions),
      JSON.stringify(props.data.thenConditionConfig),
    ],
    () => {
      // 只有当配置完整时才触发校验
      if (!hasIf.value || !hasThen.value) return
      if (!hasIfValue.value || !hasThenCondition.value) return
      scheduleValidation()
    }
  )

  // --- 事件处理 (Event Handlers) ---

  /**
   * 处理源表变更
   * 当用户切换源表时，需要清空所有关联的连线和配置
   */
  const handleSourceTableChange = () => {
    const selectedTable = availableSourceTables.value.find((t) => t.id === localSourceNodeId.value)
    // 查找并删除所有连接到本节点的输入边
    const removed = store.edges.filter(
      (e) =>
        e.target === props.id &&
        (e.targetHandle === `target-if-${props.id}` ||
          e.targetHandle === `target-then-${props.id}` ||
          e.targetHandle === `target-input-${props.id}`)
    )
    removed.forEach((e) => {
      e.data = { ...(e.data || {}), transient: true }
      store.deleteConnection(e.id)
    })

    // 重置节点数据
    store.updateNodeData(props.id, {
      table: selectedTable?.tableName || props.data.table,
      ifRef: undefined,
      thenRef: undefined,
      ifColumn: '',
      thenColumn: '',
      ifValue: '',
      ifLogic: 'and',
      ifConditions: [{ operator: 'eq', value: '' }],
      thenConditionConfig: { operator: 'not_null' },
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    })
    // 重置本地状态
    localThenColumnId.value = ''
    localIfConditions.value = localIfConditions.value.map((c) => ({ ...c, edgeId: undefined }))
  }

  /**
   * 处理 THEN 列变更
   * 更新数据并自动创建连线
   */
  const handleThenColumnChange = async () => {
    if (!localThenColumnId.value) return
    const selectedCol = availableSourceColumns.value.find((c) => c.id === localThenColumnId.value)
    const schemaNodeId = getSchemaNodeIdForEdges()
    if (!schemaNodeId) return
    const sourceHandle = `source-right-${localThenColumnId.value}`
    const targetHandle = `target-then-${props.id}`

    // 清理旧的 THEN 连线
    const existingThenEdges = store.edges.filter(
      (e) =>
        e.target === props.id &&
        (e.targetHandle === `target-then-${props.id}` ||
          e.targetHandle === `target-input-${props.id}`)
    )
    existingThenEdges.forEach((e) => {
      e.data = { ...(e.data || {}), transient: true }
      store.deleteConnection(e.id)
    })

    // 创建新连线 (虚线样式表示 THEN 关系)
    store.createConnection(schemaNodeId, props.id, sourceHandle, targetHandle, {
      type: 'smoothstep',
      animated: true,
      label: 'THEN',
      style: { stroke: 'var(--edge-conditional-then)', strokeWidth: 2.2, strokeDasharray: '4 6' }, // was #0ea5e9
    })

    // 更新 Store
    store.updateNodeData(props.id, {
      thenRef: { nodeId: schemaNodeId, columnId: localThenColumnId.value },
      table:
        availableSourceTables.value.find((t) => t.id === schemaNodeId)?.tableName ||
        props.data.table,
      thenColumn: selectedCol?.columnName || props.data.thenColumn,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    })
    await validateNow()
  }

  // 确保 THEN 边存在 (用于点击下拉框时恢复可能误删的连线)
  const ensureThenEdge = () => {
    const schemaNodeId = getSchemaNodeIdForEdges()
    const columnId = localThenColumnId.value || props.data.thenRef?.columnId || ''
    if (!schemaNodeId || !columnId) return

    const sourceHandle = `source-right-${columnId}`
    const targetHandle = `target-then-${props.id}`
    const legacyTargetHandle = `target-input-${props.id}`
    const existing = store.edges.find(
      (e) =>
        e.source === schemaNodeId &&
        e.target === props.id &&
        e.sourceHandle === sourceHandle &&
        (e.targetHandle === targetHandle || e.targetHandle === legacyTargetHandle)
    )
    if (existing) return

    // 如果没有找到，清理旧的并重建
    const existingThenEdges = store.edges.filter(
      (e) =>
        e.target === props.id &&
        (e.targetHandle === targetHandle || e.targetHandle === legacyTargetHandle)
    )
    existingThenEdges.forEach((e) => {
      e.data = { ...(e.data || {}), transient: true }
      store.deleteConnection(e.id)
    })

    store.createConnection(schemaNodeId, props.id, sourceHandle, targetHandle, {
      type: 'smoothstep',
      animated: true,
      label: 'THEN',
      style: { stroke: 'var(--edge-conditional-then)', strokeWidth: 2.2, strokeDasharray: '4 6' }, // was #0ea5e9
    })
  }

  /**
   * 构建要保存到 Store 的 IF 条件对象
   * 过滤空值并将 UI 状态转换为数据模型
   */
  const buildIfConditionsForStore = (): IfConditionConfig[] => {
    const nodeId = getSchemaNodeIdForEdges() || ''
    const next: IfConditionConfig[] = localIfConditions.value.map((c) => {
      const col = availableSourceColumns.value.find((x) => x.id === c.columnId)
      return {
        ref: nodeId && c.columnId ? { nodeId, columnId: c.columnId } : undefined,
        column: col?.columnName,
        operator: c.operator,
        value: c.operator === 'in' || c.operator === 'not_null' ? undefined : c.value,
        values:
          c.operator === 'in'
            ? c.valuesText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        edgeId: c.edgeId,
      }
    })
    return next.length > 0 ? next : [{ operator: 'eq', value: '' }]
  }

  /**
   * 确保指定行的 IF 连线存在
   * 管理多条 IF 连线的创建、去重和清理
   */
  const ensureIfEdgeForRow = (idx: number) => {
    const cond = localIfConditions.value[idx]
    if (!cond) return
    const schemaNodeId = getSchemaNodeIdForEdges()
    if (!schemaNodeId) return

    // Case 1: 用户清空了选择，删除对应连线
    if (!cond.columnId) {
      if (cond.edgeId) {
        const edge = store.edges.find((e) => e.id === cond.edgeId)
        if (edge) edge.data = { ...(edge.data || {}), transient: true }
        store.deleteConnection(cond.edgeId)
        cond.edgeId = undefined
      }
      return
    }

    // Case 2: 选择了重复的列，清理当前连线并重置选择
    const duplicate = localIfConditions.value.some(
      (c, i) => i !== idx && c.columnId && c.columnId === cond.columnId
    )
    if (duplicate) {
      if (cond.edgeId) {
        const edge = store.edges.find((e) => e.id === cond.edgeId)
        if (edge) edge.data = { ...(edge.data || {}), transient: true }
        store.deleteConnection(cond.edgeId)
      }
      cond.columnId = ''
      cond.edgeId = undefined
      return
    }

    // Case 3: 检查是否已有连线（可能由 Vue Flow 交互创建）
    const sourceHandle = `source-right-${cond.columnId}`
    const targetHandle = `target-if-${props.id}`
    const existing = store.edges.find(
      (e) =>
        e.source === schemaNodeId &&
        e.target === props.id &&
        e.sourceHandle === sourceHandle &&
        e.targetHandle === targetHandle
    )
    if (existing) {
      cond.edgeId = existing.id
      return
    }

    // Case 4: 创建新连线
    if (cond.edgeId) {
      const edge = store.edges.find((e) => e.id === cond.edgeId)
      if (edge) edge.data = { ...(edge.data || {}), transient: true }
      store.deleteConnection(cond.edgeId)
    }
    cond.edgeId = store.createConnection(schemaNodeId, props.id, sourceHandle, targetHandle, {
      type: 'smoothstep',
      animated: true,
      label: 'IF',
      style: { stroke: 'var(--edge-conditional-if)', strokeWidth: 2 }, // was #6f42c1
    })
  }

  /**
   * 协调所有的条件连线
   * 当节点选中状态变化时调用，确保视觉上的连线与内部状态一致
   */
  const reconcileConditionalEdges = () => {
    const schemaNodeId = getSchemaNodeIdForEdges()
    if (!schemaNodeId) return

    // 1. 修复 IF 连线
    localIfConditions.value.forEach((cond, idx) => {
      if (!cond.columnId) return
      const sourceHandle = `source-right-${cond.columnId}`
      const targetHandle = `target-if-${props.id}`
      const existing = store.edges.find(
        (e) =>
          e.source === schemaNodeId &&
          e.target === props.id &&
          e.sourceHandle === sourceHandle &&
          e.targetHandle === targetHandle
      )
      if (existing) {
        cond.edgeId = existing.id
        return
      }
      if (!cond.edgeId) {
        ensureIfEdgeForRow(idx)
      }
    })

    // 2. 修复 THEN 连线
    if (localThenColumnId.value) {
      const thenHandles = new Set([`target-then-${props.id}`, `target-input-${props.id}`])
      const hasThenEdge = store.edges.some(
        (e) =>
          e.source === schemaNodeId &&
          e.target === props.id &&
          !!e.targetHandle &&
          thenHandles.has(e.targetHandle)
      )
      if (!hasThenEdge && props.data.thenRef?.columnId) {
        const sourceHandle = `source-right-${props.data.thenRef.columnId}`
        store.createConnection(schemaNodeId, props.id, sourceHandle, `target-then-${props.id}`, {
          type: 'smoothstep',
          animated: true,
          label: 'THEN',
          style: {
            stroke: 'var(--edge-conditional-then)',
            strokeWidth: 2.2,
            strokeDasharray: '4 6',
          }, // was #0ea5e9
        })
      }
    }
  }

  watch(
    () => [
      props.selected,
      localSourceNodeId.value,
      props.data.thenRef?.nodeId,
      JSON.stringify(localIfConditions.value.map((c) => [c.columnId, c.edgeId])),
    ],
    () => {
      if (!props.selected) return
      reconcileConditionalEdges()
    }
  )

  // --- 统一更新逻辑 ---

  /**
   * 应用 IF 条件的更新
   * 将本地状态写入 Store 并触发校验
   */
  const applyIfConditionsUpdate = () => {
    const nextConditions = buildIfConditionsForStore()
    const first = nextConditions[0]
    store.updateNodeData(props.id, {
      ifLogic: localIfLogic.value,
      ifConditions: nextConditions,
      ifRef: first?.ref, // 兼容旧版字段
      ifColumn: first?.column || '',
      ifValue: typeof first?.value === 'string' ? first.value : '',
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    })
    scheduleValidation()
  }

  const handleIfLogicChange = () => {
    applyIfConditionsUpdate()
  }

  // 高阶函数：生成特定索引的处理函数
  const handleIfConditionColumnChange = (idx: number) => () => {
    if (!localIfConditions.value[idx]) return
    ensureIfEdgeForRow(idx)
    applyIfConditionsUpdate()
  }

  const handleIfConditionOperatorChange = (idx: number) => () => {
    const cond = localIfConditions.value[idx]
    if (!cond) return
    cond.value = ''
    cond.valuesText = ''
    applyIfConditionsUpdate()
  }

  const handleIfConditionValueInput = (idx: number) => () => {
    if (!localIfConditions.value[idx]) return
    applyIfConditionsUpdate()
  }

  const handleIfConditionValuesInput = (idx: number) => () => {
    if (!localIfConditions.value[idx]) return
    applyIfConditionsUpdate()
  }

  const addIfCondition = () => {
    localIfConditions.value.push({
      columnId: '',
      operator: 'eq',
      value: '',
      valuesText: '',
      edgeId: undefined,
    })
    applyIfConditionsUpdate()
  }

  const removeIfCondition = (idx: number) => {
    if (localIfConditions.value.length <= 1) return
    const removed = localIfConditions.value[idx]
    // 移除对应的连线
    if (removed?.edgeId) {
      const edge = store.edges.find((e) => e.id === removed.edgeId)
      if (edge) edge.data = { ...(edge.data || {}), transient: true }
      store.deleteConnection(removed.edgeId)
    }
    localIfConditions.value.splice(idx, 1)
    applyIfConditionsUpdate()
  }

  // --- THEN 条件配置更新 ---

  const setThenConditionConfig = (next: ConditionalConstraintNodeData['thenConditionConfig']) => {
    store.updateNodeData(props.id, {
      thenConditionConfig: next,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    })
    scheduleValidation()
  }

  // 切换 DSL/Function 模式
  const handleConditionModeChange = () => {
    if (localConditionMode.value === 'function') {
      setThenConditionConfig(localFunctionName.value.trim())
    } else {
      setThenConditionConfig({ operator: localOperator.value })
    }
  }

  const handleOperatorChange = () => {
    if (localOperator.value === 'not_null') {
      setThenConditionConfig({ operator: 'not_null' })
      return
    }
    if (localOperator.value === 'greater_than') {
      setThenConditionConfig({ operator: 'greater_than', value: localGreaterThanValue.value })
      return
    }
    // in 操作符需要数组
    setThenConditionConfig({
      operator: 'in',
      values: localInValues.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    })
  }

  const handleGreaterThanInput = () => {
    setThenConditionConfig({ operator: 'greater_than', value: localGreaterThanValue.value })
  }

  const handleInValuesInput = () => {
    setThenConditionConfig({
      operator: 'in',
      values: localInValues.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    })
  }

  const handleFunctionInput = () => {
    if (localConditionMode.value !== 'function') return
    setThenConditionConfig(localFunctionName.value.trim())
  }
</script>

<style scoped src="./ConditionalConstraintNode.styles.css"></style>
