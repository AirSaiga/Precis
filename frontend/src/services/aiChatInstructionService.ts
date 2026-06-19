/**
 * @file aiChatInstructionService.ts
 * @description AI 聊天前端指令处理服务
 *
 * 职责：
 * - 解析 AI 返回的前端渲染指令
 * - 在画布上创建节点、连线或修改内嵌约束
 * - 与 graphStore 和 Vue Flow API 交互
 *
 * 指令类型：
 * - 约束节点（ADD/UPDATE_CONSTRAINT_NODE）
 * - Schema 节点（ADD/UPDATE/DELETE_SCHEMA）
 * - Regex 节点（ADD/UPDATE/DELETE_REGEX）
 * - Transform 节点（ADD/UPDATE/DELETE_TRANSFORM）
 * - 项目设置（UPDATE_SETTINGS）
 * - 数据校验（VALIDATE_PROJECT）
 *
 * 所有 DAG 操作通过 vueFlowApi 增量 API，不直接 push。
 */

import { logger } from '@/core/utils/logger'
import { toastError, toastSuccess } from '@/core/toast'
import { useVueFlow, type Edge, type Node as VueFlowNode } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import { nextTick } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { i18n } from '@/i18n'
import type { FrontendInstruction } from '@/stores/aiChatStore'
import * as vueFlowApi from '@/services/canvas/vueFlowApi'
import { fromBackendType } from '@/services/builders/schemaBuilder'
import { useConnectionValidator } from '@/composables/validation/useConnectionValidator'

/**
 * AI 指令执行过程中遇到无法继续的非法连接时抛出的错误
 */
export class AIInstructionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly instruction?: FrontendInstruction
  ) {
    super(message)
    this.name = 'AIInstructionError'
  }
}

interface AINodeConnectionInput {
  sourceNode: VueFlowNode
  sourceColumnId?: string
  targetNode: VueFlowNode
  edges: Edge[]
}

/**
 * 从 Schema/JsonSchema 节点中解析列 ID
 *
 * 优先使用 AI 直接提供的 targetColumnId；若未提供，则按 columnName 在 columns 中查找。
 * 无法解析时返回 undefined，避免用不存在的列名创建非法连接。
 */
function resolveColumnId(node: VueFlowNode, columnNameOrId?: string): string | undefined {
  if (!columnNameOrId) return undefined

  const data = node.data as Record<string, unknown>
  const columns = data.columns as Array<{ id?: string; columnName?: string }> | undefined
  if (!columns || columns.length === 0) return undefined

  const byId = columns.find((c) => c.id === columnNameOrId)
  if (byId?.id) return byId.id

  const byName = columns.find((c) => c.columnName === columnNameOrId)
  if (byName?.id) return byName.id

  return undefined
}

/**
 * 根据目标节点类型解析目标 handle ID
 *
 * 与 connectionRules.ts 中的规则保持一致：
 * - Regex / Transform / TemplateInstance 使用固定输入 handle
 * - Schema/JsonSchema/ManualData/TransformOutput 使用 target-left
 * - CompositeConstraint 使用 target-left
 * - 其他约束节点使用 target-input-{nodeId}
 */
function resolveTargetHandle(targetNode: VueFlowNode): string | undefined {
  switch (targetNode.type) {
    case 'regex':
      return 'regex-input'
    case 'transform':
      return 'transform-input'
    case 'templateInstance':
      return 'template-input'
    case 'schema':
    case 'jsonSchema':
    case 'manualData':
    case 'transformOutput':
      return 'target-left'
    case 'compositeConstraint':
      return 'target-left'
    default:
      if (targetNode.type?.endsWith('Constraint')) {
        return `target-input-${targetNode.id}`
      }
      return undefined
  }
}

/**
 * 创建 AI 生成的边，并在加入画布前通过连接规则验证
 *
 * 若验证失败，抛出 AIInstructionError，且不向 edges 添加非法边。
 */
function addValidatedAIConnection(input: AINodeConnectionInput): Edge {
  const { sourceNode, sourceColumnId, targetNode, edges } = input
  const sourceHandle = sourceColumnId ? `source-right-${sourceColumnId}` : undefined
  const targetHandle = resolveTargetHandle(targetNode)

  const { validateConnection } = useConnectionValidator({ existingConnections: edges })
  const result = validateConnection(sourceNode, sourceHandle, targetNode, targetHandle)

  if (!result.isValid) {
    throw new AIInstructionError(
      `[AI Chat] 连接验证失败: ${result.message || result.errorCode}`,
      result.errorCode || 'CONNECTION_VALIDATION_FAILED'
    )
  }

  const edge: Edge = {
    id: uuidv4(),
    source: sourceNode.id,
    target: targetNode.id,
    sourceHandle,
    targetHandle,
  }

  vueFlowApi.addEdges(edge)
  return edge
}

/**
 * AI 返回的约束类型到前端 ConstraintKind 的映射表
 *
 * AI 使用大写下划线格式（如 NOT_NULL），前端使用 camelCase（如 notNull）。
 * 覆盖全部 10 种约束类型。
 */
const CONSTRAINT_TYPE_MAP: Record<string, string> = {
  NOT_NULL: 'notNull',
  UNIQUE: 'unique',
  ALLOWED_VALUES: 'allowedValues',
  RANGE: 'range',
  FOREIGN_KEY: 'foreignKey',
  CONDITIONAL: 'conditional',
  SCRIPTED: 'scripted',
  CHARSET: 'charset',
  DATE_LOGIC: 'dateLogic',
  COMPOSITE: 'composite',
}

/**
 * 解析约束指令的目标节点（前端兜底）
 *
 * 优先级：
 * 1. targetNodeId 精确匹配（后端解析出的确定性 ID）
 * 2. tableName 匹配节点的 data.tableName / data.configName / id
 * 3. tableName 大小写不敏感包含匹配（宽松兜底）
 *
 * 应对"AI 二手观察画布 + 后端双出口"同步鸿沟的最后一道防线：
 * 即使后端解析的 ID 与画布真实节点 ID 不同步（如未保存的新建节点、
 * 多轮对话间画布状态变化），前端仍能用 tableName 找到正确节点。
 */
function resolveTargetNode(
  nodes: VueFlowNode[],
  targetNodeId: string,
  tableName?: string
): VueFlowNode | undefined {
  // 策略 1：精确 ID 匹配
  if (targetNodeId) {
    const exact = nodes.find((n) => n.id === targetNodeId)
    if (exact) return exact
  }

  // 无 tableName 则无法兜底
  if (!tableName) return undefined
  const query = tableName.toLowerCase()

  // 策略 2：tableName 精确匹配节点的 tableName / configName / id
  const byTableField = nodes.find((n) => {
    const data = n.data as Record<string, unknown>
    const candidates = [data.tableName, data.configName, n.id]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.toLowerCase())
    return candidates.includes(query)
  })
  if (byTableField) {
    logger.info(
      `[AI Chat] targetNodeId=${targetNodeId} 未命中，用 tableName=${tableName} 兜底匹配到节点 ${byTableField.id}`
    )
    return byTableField
  }

  // 策略 3：tableName 包含匹配（处理 "Orders Table" vs "orders" 等命名差异）
  // 收紧原则：宁可漏匹配（最终返回 undefined 让上层报"节点未找到"），
  // 也不要错匹配——错匹配会把约束加到错误的表上，后果比"没匹配到"严重得多。
  // - 只保留"节点名包含 query"方向（query 来自 AI，通常较完整），
  //   去掉危险的"query 包含节点名"方向（节点名仅 "a" 时会匹配所有含 a 的表）。
  // - 要求 query 至少 3 字符，避免 "a"/"or" 这类过短词误命中大量表。
  const MIN_FUZZY_LEN = 3
  const byContain =
    query.length >= MIN_FUZZY_LEN
      ? nodes.find((n) => {
          const data = n.data as Record<string, unknown>
          const candidates = [data.tableName, data.configName]
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.toLowerCase())
          // 仅节点名包含 query；且节点名本身也要够长，否则短名噪声大
          return candidates.some((v) => v.length >= MIN_FUZZY_LEN && v.includes(query))
        })
      : undefined
  if (byContain) {
    logger.info(
      `[AI Chat] targetNodeId=${targetNodeId} 未命中，用 tableName=${tableName} 包含匹配到节点 ${byContain.id}`
    )
    return byContain
  }

  return undefined
}

const CONSTRAINT_ACTION_TYPES = new Set([
  'ADD_CONSTRAINT_NODE',
  'UPDATE_CONSTRAINT_NODE',
  'DELETE_CONSTRAINT_NODE',
])

const SCHEMA_ACTION_TYPES = new Set(['ADD_SCHEMA', 'UPDATE_SCHEMA', 'DELETE_SCHEMA'])

const REGEX_ACTION_TYPES = new Set(['ADD_REGEX', 'UPDATE_REGEX', 'DELETE_REGEX'])

const TRANSFORM_ACTION_TYPES = new Set(['ADD_TRANSFORM', 'UPDATE_TRANSFORM', 'DELETE_TRANSFORM'])

/**
 * 处理前端渲染指令，按 actionType 分发到对应 handler
 *
 * @param instructions - AI 返回的前端渲染指令数组
 */
export async function processFrontendInstructions(
  instructions: FrontendInstruction[]
): Promise<void> {
  if (!instructions || instructions.length === 0) return

  for (const instruction of instructions) {
    const { actionType } = instruction

    if (CONSTRAINT_ACTION_TYPES.has(actionType)) {
      await handleConstraintInstruction(instruction)
    } else if (SCHEMA_ACTION_TYPES.has(actionType)) {
      await handleSchemaInstruction(instruction)
    } else if (REGEX_ACTION_TYPES.has(actionType)) {
      await handleRegexInstruction(instruction)
    } else if (TRANSFORM_ACTION_TYPES.has(actionType)) {
      await handleTransformInstruction(instruction)
    } else if (actionType === 'UPDATE_SETTINGS') {
      logger.info(`[AI Chat] Settings 指令: 无需画布操作`)
    } else if (actionType === 'VALIDATE_PROJECT') {
      logger.info(`[AI Chat] Validate 指令: 无需画布操作`)
    } else {
      logger.warn(`[AI Chat] 未知指令类型: ${actionType}`)
    }
  }
}

/**
 * 处理约束指令
 *
 * 根据 constraintSpec 中的 isInline 决定：
 * - 内嵌约束：修改目标节点的列定义
 * - 独立约束：在目标节点右侧创建约束节点并连线
 */
async function handleConstraintInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()
  const { fitView } = useVueFlow()

  const { constraintSpec } = instruction
  const { type, targetNodeId, tableName, targetColumn, constraintId, isInline } = constraintSpec

  // 解析目标节点：targetNodeId 精确匹配失败时，用 tableName 多策略兜底
  // 这是应对"AI 二手观察画布 + 后端双出口同步鸿沟"的最后一道防线
  const targetNode = resolveTargetNode(graphStore.nodes, targetNodeId, tableName)

  if (!targetNode) {
    logger.warn(`[AI Chat] 目标节点不存在: targetNodeId=${targetNodeId}, tableName=${tableName}`)
    toastError(t('aiChat.targetNodeNotFound'))
    return
  }

  if (isInline) {
    handleInlineConstraint(targetNode, type, targetColumn, constraintId)
    toastSuccess(t('aiChat.inlineConstraintCreated', { table: tableName, column: targetColumn }))
    return
  }

  const constraintKind = CONSTRAINT_TYPE_MAP[type]
  if (!constraintKind) {
    logger.warn(`[AI Chat] 未知的约束类型: ${type}`)
    toastError(t('aiChat.unsupportedConstraintType', { type }))
    return
  }

  const nodePosition = {
    x: targetNode.position.x + 350,
    y: targetNode.position.y,
  }

  const constraintNodeId = uuidv4()
  const constraintNode: VueFlowNode = {
    id: constraintNodeId,
    type: `${constraintKind}Constraint`,
    position: nodePosition,
    data: {
      configName: `${constraintId}`,
      table: tableName,
      column: targetColumn,
      constraintName: constraintId,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
      sourceRef: undefined,
    },
  }

  vueFlowApi.addNodes(constraintNode)

  await nextTick()

  const columnId = constraintSpec.targetColumnId || resolveColumnId(targetNode, targetColumn)
  if (!columnId) {
    logger.warn(`[AI Chat] 无法解析目标列: ${targetColumn}`)
    toastError(t('aiChat.columnNotFound', { column: targetColumn }))
    return
  }

  try {
    addValidatedAIConnection({
      sourceNode: targetNode,
      sourceColumnId: columnId,
      targetNode: constraintNode,
      edges: graphStore.edges,
    })
  } catch (error) {
    if (error instanceof AIInstructionError) {
      logger.error(error.message)
      toastError(error.message)
    } else {
      throw error
    }
  }

  await nextTick()

  graphStore.reconcileAll()

  setTimeout(() => {
    fitView({ nodes: [constraintNodeId], padding: 0.25, duration: 300 })
  }, 100)

  toastSuccess(t('aiChat.constraintCreated', { table: tableName, column: targetColumn }))
}

/**
 * 处理内嵌约束指令
 *
 * 将约束直接附加到目标节点的列定义上，不创建独立节点和连线。
 * 约束数据存储在 column.constraints 字典中，键为约束类型小写，值为 { id, enabled }。
 */
function handleInlineConstraint(
  targetNode: VueFlowNode,
  constraintType: string,
  columnName: string,
  constraintId: string
) {
  const graphStore = useGraphStore()
  const { t } = i18n.global

  const nodeData = targetNode.data as unknown as Record<string, unknown>
  if (!nodeData.columns) {
    logger.warn(`[AI Chat] 目标节点没有 columns 数组`)
    return
  }

  // 预检目标列是否存在（不存在则提示，避免静默失败）
  const columnExists = (nodeData.columns as unknown[]).some(
    (c) => (c as Record<string, unknown>).columnName === columnName
  )
  if (!columnExists) {
    logger.warn(`[AI Chat] 目标节点没有列: ${columnName}`)
    toastError(t('aiChat.columnNotFound', { column: columnName }))
    return
  }

  // 构造更新后的 columns 数组（不可变更新，避免直接修改响应式 proxy）
  const constraintKey = constraintType.toLowerCase()
  const updatedColumns = (nodeData.columns as unknown[]).map((c) => {
    const col = c as Record<string, unknown>
    if (col.columnName !== columnName) return col
    // 命中目标列，添加约束
    const existingConstraints = (col.constraints as Record<string, unknown>) || {}
    return {
      ...col,
      constraints: {
        ...existingConstraints,
        [constraintKey]: { id: constraintId, enabled: true },
      },
    }
  })

  // 通过 updateNodeData 统一入口更新（触发 Vue 响应式 + VueFlow 同步）
  // 不直接操作 graphStore.nodes 数组下标，遵循 DAG 操作规范
  graphStore.updateNodeData(targetNode.id, {
    columns: updatedColumns,
  } as Partial<import('@/types/graph').CustomNodeData>)
}

/**
 * 处理 Schema 指令 — 在画布上创建/更新/删除 Schema 节点
 *
 * ADD_SCHEMA: 创建 Schema 节点，包含列定义
 * UPDATE_SCHEMA: 更新已有 Schema 节点的列（目前为日志提示，YAML 已由后端修改）
 * DELETE_SCHEMA: 移除画布上的 Schema 节点（YAML 已由后端删除）
 */
async function handleSchemaInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()
  const { fitView } = useVueFlow()

  const spec = instruction.schemaSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_SCHEMA') {
    const schemaId = spec.schemaId || spec.name || uuidv4()
    const schemaName = spec.name || schemaId
    const columns = spec.columns || []

    const cols = columns.map((col) => ({
      id: col.id || col.name,
      columnName: col.name,
      dataType: fromBackendType(col.type),
      validationErrors: [],
      constraints: {},
    }))

    const position = computePlacementPosition(graphStore)

    const schemaNode: VueFlowNode = {
      id: schemaId,
      type: 'schema',
      position,
      data: {
        configName: `Schema_${schemaName}`,
        tableName: schemaName,
        columns: cols,
        saveState: 'saved',
      },
    }

    vueFlowApi.addNodes(schemaNode)
    await nextTick()
    graphStore.reconcileAll()

    setTimeout(() => {
      fitView({ nodes: [schemaId], padding: 0.25, duration: 300 })
    }, 100)

    toastSuccess(t('aiChat.schemaCreated', { name: schemaName }))
    return
  }

  if (actionType === 'DELETE_SCHEMA') {
    const schemaId = spec.schemaId || spec.name
    const existing = graphStore.nodes.find((n) => n.id === schemaId)
    if (existing) {
      vueFlowApi.removeNodes(schemaId)
      await nextTick()
      graphStore.reconcileAll()
      toastSuccess(t('aiChat.schemaDeleted', { name: spec.name || schemaId }))
    }
    return
  }

  // UPDATE_SCHEMA — 后端已修改 YAML，前端无需画布操作
  // 用户下次从资源树拖入即可看到更新
  logger.info(`[AI Chat] Schema 更新已由后端处理: ${spec.name}`)
}

/**
 * 处理 Regex 指令 — 在画布上创建 Regex 节点
 *
 * ADD_REGEX: 创建 Regex 节点，如有 targetNodeId 则自动连线
 * UPDATE/DELETE: 后端已处理 YAML，前端暂不做画布操作
 */
async function handleRegexInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()
  const { fitView } = useVueFlow()

  const spec = instruction.regexSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_REGEX') {
    const regexId = spec.regexId || spec.name || uuidv4()
    const regexName = spec.name || regexId

    const position = computePlacementPosition(graphStore)

    const regexNode: VueFlowNode = {
      id: regexId,
      type: 'regex',
      position,
      data: {
        configName: regexName,
        description: spec.description || '',
        pattern: spec.pattern || '',
        matchMode: spec.matchMode || 'full',
        caseSensitive: spec.caseSensitive || false,
        enabled: true,
        validationStatus: 'idle',
        saveState: 'saved',
      },
    }

    vueFlowApi.addNodes(regexNode)
    await nextTick()

    // 如果有关联的 Schema 节点，创建边（方向：Schema 列 -> Regex）
    if (spec.targetNodeId && spec.targetColumn) {
      const sourceNode = graphStore.nodes.find((n) => n.id === spec.targetNodeId)
      if (sourceNode) {
        const columnId = resolveColumnId(sourceNode, spec.targetColumn)
        if (columnId) {
          try {
            addValidatedAIConnection({
              sourceNode,
              sourceColumnId: columnId,
              targetNode: regexNode,
              edges: graphStore.edges,
            })
          } catch (error) {
            if (error instanceof AIInstructionError) {
              logger.error(error.message)
              toastError(error.message)
            } else {
              throw error
            }
          }
        } else {
          logger.warn(`[AI Chat] 无法解析 Regex 目标列: ${spec.targetColumn}`)
          toastError(t('aiChat.columnNotFound', { column: spec.targetColumn }))
        }
        await nextTick()
      }
    }

    graphStore.reconcileAll()

    setTimeout(() => {
      fitView({ nodes: [regexId], padding: 0.25, duration: 300 })
    }, 100)

    toastSuccess(t('aiChat.regexCreated', { name: regexName }))
    return
  }

  logger.info(`[AI Chat] Regex ${actionType}: 后端已处理`)
}

/**
 * 处理 Transform 指令 — 在画布上创建 Transform 节点
 *
 * ADD_TRANSFORM: 创建 Transform 节点
 * UPDATE/DELETE: 后端已处理 YAML
 */
async function handleTransformInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()
  const { fitView } = useVueFlow()

  const spec = instruction.transformSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_TRANSFORM') {
    const transformId = spec.transformId || uuidv4()
    const transformType = spec.type || 'CastType'

    const position = computePlacementPosition(graphStore)

    const transformNode: VueFlowNode = {
      id: transformId,
      type: 'transform',
      position,
      data: {
        configName: `${transformType}_${transformId}`,
        transformType,
        description: spec.description || '',
        enabled: true,
        params: spec.params || {},
        outputColumns: spec.outputColumns || [],
        inputFromNode: spec.inputFromNode,
        inputColumn: spec.inputColumn,
        saveState: 'saved',
      },
    }

    vueFlowApi.addNodes(transformNode)
    await nextTick()
    graphStore.reconcileAll()

    setTimeout(() => {
      fitView({ nodes: [transformId], padding: 0.25, duration: 300 })
    }, 100)

    toastSuccess(t('aiChat.transformCreated', { name: transformType }))
    return
  }

  logger.info(`[AI Chat] Transform ${actionType}: 后端已处理`)
}

/**
 * 计算新节点的放置位置
 *
 * 在当前画布视口中心偏移放置，避免与已有节点重叠。
 */
function computePlacementPosition(graphStore: ReturnType<typeof useGraphStore>) {
  const nodes = graphStore.nodes
  if (nodes.length === 0) {
    return { x: 100, y: 100 }
  }

  let maxX = 0
  let maxY = 0
  for (const node of nodes) {
    if (node.position.x > maxX) maxX = node.position.x
    if (node.position.y > maxY) maxY = node.position.y
  }

  return {
    x: maxX + 400,
    y: maxY,
  }
}
