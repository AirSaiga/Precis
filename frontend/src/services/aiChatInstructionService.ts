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

  const targetNode = graphStore.nodes.find((n) => n.id === targetNodeId)

  if (!targetNode) {
    logger.warn(`[AI Chat] 目标节点不存在: ${targetNodeId}`)
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

  const edgeId = uuidv4()
  const newEdge: Edge = {
    id: edgeId,
    source: constraintNodeId,
    target: targetNodeId,
    sourceHandle: null,
    targetHandle: `column-${targetColumn}`,
  }

  vueFlowApi.addEdges(newEdge)

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

  const column = (nodeData.columns as unknown[]).find(
    (c) => (c as Record<string, unknown>).columnName === columnName
  ) as Record<string, unknown> | undefined
  if (!column) {
    logger.warn(`[AI Chat] 目标节点没有列: ${columnName}`)
    toastError(t('aiChat.columnNotFound', { column: columnName }))
    return
  }

  if (!column.constraints) {
    column.constraints = {}
  }

  const constraintKey = constraintType.toLowerCase()
  ;(column.constraints as Record<string, unknown>)[constraintKey] = {
    id: constraintId,
    enabled: true,
  }

  const nodeIndex = graphStore.nodes.findIndex((n) => n.id === targetNode.id)
  if (nodeIndex !== -1) {
    graphStore.nodes[nodeIndex] = { ...targetNode }
  }
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
      id: col.id || `sc_${col.name}`,
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

    // 如果有关联的 Schema 节点，创建边
    if (spec.targetNodeId && spec.targetColumn) {
      const targetNode = graphStore.nodes.find((n) => n.id === spec.targetNodeId)
      if (targetNode) {
        const edgeId = uuidv4()
        const newEdge: Edge = {
          id: edgeId,
          source: regexId,
          target: spec.targetNodeId,
          sourceHandle: null,
          targetHandle: `column-${spec.targetColumn}`,
        }
        vueFlowApi.addEdges(newEdge)
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
