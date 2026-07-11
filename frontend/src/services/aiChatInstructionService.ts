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
import { type Edge, type Node as VueFlowNode } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import { nextTick } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { i18n } from '@/i18n'
import type { FrontendInstruction } from '@/stores/aiChatStore'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import * as vueFlowApi from '@/services/canvas/vueFlowApi'
import { VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
import {
  FITVIEW_DURATION_MS,
  NODE_ENTER_DURATION_MS,
  NODE_ENTERING_CLASS,
} from '@/services/canvas/animationDurations'
import { parseColumnSpecs } from '@/services/builders/parseColumnSpec'
import { useConnectionValidator } from '@/composables/validation/useConnectionValidator'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import type { ProjectResourceKind } from '@/stores/graphStore/modules/v2/import/importV2ResourceToCanvas'
// 动作类型分类集合由 codegen 从后端 registry 生成,消除前后端硬编码漂移
import {
  CONSTRAINT_ACTION_TYPES,
  SCHEMA_ACTION_TYPES,
  REGEX_ACTION_TYPES,
  TRANSFORM_ACTION_TYPES,
} from '@/types/generated/actions'

/**
 * fitView 防抖
 *
 * 多个 handler 连续创建节点时（如 Schema + 子约束），各自触发 fitView 会导致画布
 * 连续跳动。防抖窗口内累加所有调用方传入的节点 id（取并集，而非覆盖），最终只执行
 * 一次 fitView，框住整批节点。
 *
 * 跨 handler 共享同一 timer，防抖窗口 500ms。
 *
 * 注意：入场动画与 fitView 不做时序拆分——曾尝试「先 fitView 再延迟加 enter class」，
 * 但节点创建时缺少 opacity:0 初始态，延迟加 class 反而造成「先可见→闪没→淡入」
 * 的闪现回归。改为节点创建即带 NODE_ENTERING_CLASS（详见 attachEnteringClass）。
 */
let fitViewTimer: ReturnType<typeof setTimeout> | null = null
let pendingFitViewNodes = new Set<string>()

/**
 * 防抖 fitView：累加节点 id，500ms 窗口结束后执行一次 fitView 框住全部节点
 *
 * @param nodes 本次调用要纳入视野的节点 id
 * @param options padding / duration 覆盖（最后一次生效）
 */
export function debouncedFitView(
  nodes: string[],
  options: { padding?: number; duration?: number } = {}
): void {
  for (const n of nodes) pendingFitViewNodes.add(n)
  if (fitViewTimer) {
    clearTimeout(fitViewTimer)
  }
  fitViewTimer = setTimeout(() => {
    fitViewTimer = null
    const nodeIds = [...pendingFitViewNodes]
    pendingFitViewNodes = new Set()
    if (nodeIds.length === 0) return
    // 画布可能正处于模式切换重建窗口期，fitView 失败时静默跳过（不记 error）
    try {
      vueFlowApi.fitView({
        nodes: nodeIds,
        padding: options.padding ?? 0.25,
        duration: options.duration ?? FITVIEW_DURATION_MS,
      })
    } catch (e) {
      if (e instanceof VueFlowApiNotInitializedError) {
        logger.warn('[AI Instruction] fitView 跳过（画布未就绪）')
      } else {
        throw e
      }
    }
  }, 500)
}

/**
 * 给 AI 新建的节点安排入场动画 class 的清理。
 *
 * 与 createBaseNodeFactory.clearNodeClass 同一模式：用 findNode 增量改 Vue Flow
 * 内部响应式 GraphNode 的 class，不能用 nodes.value = [...] 全量替换（会绕过 Vue Flow
 * 增量 hooks，在节点→边关联场景下可能引发隐性状态不一致）。
 *
 * 调用方在节点对象上预设 `class: NODE_ENTERING_CLASS`，再调用本助手在动画结束后清除。
 */
function attachEnteringClass(nodeId: string): void {
  setTimeout(() => {
    const vfNode = vueFlowApi.findNode(nodeId)
    if (vfNode && vfNode.class === NODE_ENTERING_CLASS) {
      vfNode.class = undefined
    }
  }, NODE_ENTER_DURATION_MS)
}

/**
 * 执行画布操作，VueFlow 未就绪时（模式切换窗口期）静默跳过并记 warn。
 *
 * IDE ↔ Agent 模式切换时 NodeCanvas 会销毁重建，vueFlowApi 单例被 resetVueFlowApi 置空。
 * 此时飞行中的 AI 指令若调用 addNodes/addEdges/removeNodes 会抛 VueFlowApiNotInitializedError。
 * 这是可预期的降级——指令遇画布重建时不应崩溃，也不应记 error 制造噪音。
 * 节点可能少建（与"切换前中止 AI 任务"配合可将此场景压到极低概率），但不会污染新画布。
 *
 * 其他异常照常上抛，不吞错。
 */
function guardCanvasOp<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (e) {
    if (e instanceof VueFlowApiNotInitializedError) {
      logger.warn('[AI Instruction] 画布未就绪（模式切换中），跳过指令:', e.message)
      return undefined
    }
    throw e
  }
}

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

  // 画布未就绪（模式切换窗口期）时静默跳过，不抛错污染调用方
  guardCanvasOp(() => vueFlowApi.addEdges(edge))
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
    } else if (actionType === 'ADD_TO_CANVAS') {
      await handleAddToCanvasInstruction(instruction)
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

  // DELETE 分支：约束文件已由后端删除，此处镜像到画布
  if (instruction.actionType === 'DELETE_CONSTRAINT_NODE') {
    if (isInline) {
      // 内联删除：从目标列移除该约束（handleInlineConstraint 的逆操作）
      removeInlineConstraint(targetNode, type, targetColumn)
    } else {
      // 独立删除：按 (约束节点类型, table, column) 三元组定位节点
      // 独立约束节点 id 是前端 uuidv4()，与后端 constraintId 无关，故不能按 id 删
      const constraintKind = CONSTRAINT_TYPE_MAP[type]
      if (constraintKind) {
        const nodeType = `${constraintKind}Constraint`
        const toRemove = graphStore.nodes.filter((n) => {
          if (n.type !== nodeType) return false
          const d = n.data as Record<string, unknown>
          return d.table === tableName && d.column === targetColumn
        })
        if (toRemove.length > 0) {
          guardCanvasOp(() => vueFlowApi.removeNodes(toRemove.map((n) => n.id)))
          await nextTick()
          graphStore.reconcileAll()
          toastSuccess(t('aiChat.constraintDeleted', { table: tableName, column: targetColumn }))
        } else {
          logger.info(
            `[AI Chat] 画布上未找到匹配的约束节点: ${type} on ${tableName}.${targetColumn}`
          )
        }
      }
    }
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
    // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
    class: NODE_ENTERING_CLASS,
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

  guardCanvasOp(() => vueFlowApi.addNodes(constraintNode))

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

  attachEnteringClass(constraintNodeId)
  debouncedFitView([constraintNodeId])

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
 * 移除内嵌约束（handleInlineConstraint 的逆操作）
 *
 * 从目标列的 constraints 字典中删除指定类型的约束。
 */
function removeInlineConstraint(
  targetNode: VueFlowNode,
  constraintType: string,
  columnName: string
) {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const nodeData = targetNode.data as unknown as Record<string, unknown>
  if (!nodeData.columns) {
    logger.warn(`[AI Chat] 目标节点没有 columns 数组`)
    return
  }

  const constraintKey = constraintType.toLowerCase()
  let removed = false
  const updatedColumns = (nodeData.columns as unknown[]).map((c) => {
    const col = c as Record<string, unknown>
    if (col.columnName !== columnName) return col
    const existingConstraints = (col.constraints as Record<string, unknown>) || {}
    if (!(constraintKey in existingConstraints)) return col
    removed = true
    const next = { ...existingConstraints }
    delete next[constraintKey]
    return { ...col, constraints: next }
  })

  if (!removed) {
    logger.info(`[AI Chat] 内联约束不存在，无需删除: ${constraintType} on ${columnName}`)
    return
  }

  graphStore.updateNodeData(targetNode.id, {
    columns: updatedColumns,
  } as Partial<import('@/types/graph').CustomNodeData>)
  toastSuccess(t('aiChat.inlineConstraintDeleted', { column: columnName }))
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

  const spec = instruction.schemaSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_SCHEMA') {
    const schemaId = spec.schemaId || spec.name || uuidv4()
    const schemaName = spec.name || schemaId
    const columns = spec.columns || []

    // AI 创建的 schema 节点无数据源文件，按普通 schema 解析列（isJsonSchema=false）
    const cols = parseColumnSpecs(
      columns.map((c) => ({ ...c, id: c.id || c.name })) as Array<{
        id: string
        name: string
        type: string | Record<string, unknown>
      }>,
      { isJsonSchema: false }
    ).map((col) => ({
      ...col,
      // 合并 AI spec 携带的列级内嵌约束（parseColumnSpecs 默认置空）
      constraints: columns.find((c) => c.name === col.columnName)?.constraints || {},
    }))

    const position = computePlacementPosition(graphStore)

    const schemaNode: VueFlowNode = {
      id: schemaId,
      type: 'schema',
      position,
      // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
      class: NODE_ENTERING_CLASS,
      data: {
        configName: `Schema_${schemaName}`,
        tableName: schemaName,
        columns: cols,
        saveState: 'saved',
      },
    }

    guardCanvasOp(() => vueFlowApi.addNodes(schemaNode))
    await nextTick()

    // 物化内嵌约束节点与边，行为与从资源树拖拽 Schema 保持一致
    const embeddedConstraints = spec.constraints || []
    if (embeddedConstraints.length > 0) {
      const createdSchemaNode = graphStore.nodes.find((n) => n.id === schemaId)
      if (createdSchemaNode) {
        const schemaData = createdSchemaNode.data as Record<string, unknown>
        const colNameToId = new Map<string, string>(
          ((schemaData.columns as Array<{ id?: string; columnName?: string }>) || []).map((c) => [
            c.columnName || '',
            c.id || '',
          ])
        )
        const createdConstraintIds: string[] = []
        materializeV2EmbeddedConstraints({
          schemaNode: createdSchemaNode as CustomNode,
          schemaTableName: String(schemaData.tableName || schemaName),
          embeddedConstraints,
          colNameToId,
          hasNode: (id: string) => graphStore.nodes.some((n) => n.id === id),
          addNode: (node: CustomNode) => {
            guardCanvasOp(() => vueFlowApi.addNodes(node as VueFlowNode))
            createdConstraintIds.push(node.id)
          },
          addConstraintEdge: (tableId: string, constraintId: string, columnId: string) => {
            const edgeId = `e-${tableId}-${constraintId}-${columnId}`
            if (graphStore.edges.some((e) => e.id === edgeId)) return
            guardCanvasOp(() =>
              vueFlowApi.addEdges({
                id: edgeId,
                source: tableId,
                target: constraintId,
                sourceHandle: `source-right-${columnId}`,
                targetHandle: `target-input-${constraintId}`,
                type: 'smoothstep',
              } as Edge)
            )
          },
        })
        await nextTick()
        graphStore.reconcileAll()
        // 内嵌约束节点入场动画清理 + 纳入防抖 fitView
        for (const cid of createdConstraintIds) {
          attachEnteringClass(cid)
          debouncedFitView([cid])
        }
      }
    }

    graphStore.reconcileAll()

    attachEnteringClass(schemaId)
    debouncedFitView([schemaId])

    toastSuccess(t('aiChat.schemaCreated', { name: schemaName }))
    return
  }

  if (actionType === 'DELETE_SCHEMA') {
    // schemaId 可能是 sc_xxx，AI 通常只知道 name；两者都尝试，并加 tableName/configName 兜底
    const schemaId = spec.schemaId || spec.name
    let existing = graphStore.nodes.find((n) => n.id === schemaId)
    if (!existing) {
      existing = graphStore.nodes.find((n) => {
        if (n.type !== 'schema') return false
        const d = n.data as Record<string, unknown>
        return d.tableName === spec.name || d.configName === spec.name || d.tableName === schemaId
      })
    }
    if (existing) {
      guardCanvasOp(() => vueFlowApi.removeNodes(existing.id))
      await nextTick()
      graphStore.reconcileAll()
      toastSuccess(t('aiChat.schemaDeleted', { name: spec.name || schemaId }))
    } else {
      logger.info(`[AI Chat] 画布上未找到 Schema 节点: ${schemaId}`)
    }
    return
  }

  if (actionType === 'UPDATE_SCHEMA') {
    // UPDATE：刷新画布节点的列结构（后端已合并，指令携带合并后的完整 columns）
    const schemaId = spec.schemaId || spec.name
    let existing = graphStore.nodes.find((n) => n.id === schemaId)
    if (!existing) {
      existing = graphStore.nodes.find((n) => {
        if (n.type !== 'schema') return false
        const d = n.data as Record<string, unknown>
        return d.tableName === spec.name || d.configName === spec.name
      })
    }
    if (existing && spec.columns) {
      // AI 更新：按普通 schema 解析列，并合并列级内嵌约束
      const cols = parseColumnSpecs(
        spec.columns.map((c) => ({ ...c, id: c.id || c.name })) as Array<{
          id: string
          name: string
          type: string | Record<string, unknown>
        }>,
        { isJsonSchema: false }
      ).map((col) => ({
        ...col,
        constraints: spec.columns!.find((c) => c.name === col.columnName)?.constraints || {},
      }))
      graphStore.updateNodeData(existing.id, { columns: cols } as Partial<CustomNodeData>)
      toastSuccess(t('aiChat.schemaUpdated', { name: spec.name || schemaId }))
    } else {
      logger.info(`[AI Chat] UPDATE_SCHEMA: 画布上无对应节点或无列数据: ${schemaId}`)
    }
    return
  }

  logger.warn(`[AI Chat] 未知的 Schema 动作类型: ${actionType}`)
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

  const spec = instruction.regexSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_REGEX') {
    const regexId = spec.regexId || spec.name || uuidv4()
    const regexName = spec.name || regexId
    const isExtract = spec.matchMode === 'extract'

    const position = computePlacementPosition(graphStore)

    const regexNode: VueFlowNode = {
      id: regexId,
      type: isExtract ? 'regexExtract' : 'regex',
      position,
      // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
      class: NODE_ENTERING_CLASS,
      data: isExtract
        ? {
            configName: regexName,
            description: spec.description || '',
            pattern: spec.pattern || '',
            flags: '',
            caseSensitive: spec.caseSensitive || false,
            enabled: true,
            captureGroups: [],
            outputColumns: [],
            validationStatus: 'idle',
            saveState: 'saved',
          }
        : {
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

    guardCanvasOp(() => vueFlowApi.addNodes(regexNode))
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

    attachEnteringClass(regexId)
    debouncedFitView([regexId])

    toastSuccess(t('aiChat.regexCreated', { name: regexName }))
    return
  }

  // DELETE/UPDATE：定位现有 Regex 节点（按 id 或 configName=name）
  const regexId = spec.regexId || spec.name
  let existing = graphStore.nodes.find((n) => n.id === regexId)
  if (!existing) {
    existing = graphStore.nodes.find(
      (n) => n.type === 'regex' && (n.data as Record<string, unknown>).configName === spec.name
    )
  }

  if (existing && actionType === 'DELETE_REGEX') {
    guardCanvasOp(() => vueFlowApi.removeNodes(existing.id))
    await nextTick()
    graphStore.reconcileAll()
    toastSuccess(t('aiChat.regexDeleted', { name: spec.name || regexId }))
    return
  }

  if (existing && actionType === 'UPDATE_REGEX') {
    // 刷新 pattern/matchMode/caseSensitive/description（数据来自后端重读的真实结果）
    graphStore.updateNodeData(existing.id, {
      pattern: spec.pattern,
      matchMode: spec.matchMode,
      caseSensitive: spec.caseSensitive,
      description: spec.description,
    } as Partial<CustomNodeData>)
    toastSuccess(t('aiChat.regexUpdated', { name: spec.name || regexId }))
    return
  }

  logger.info(`[AI Chat] Regex ${actionType}: 画布上无对应节点 (${spec.name || regexId})`)
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
      // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
      class: NODE_ENTERING_CLASS,
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

    guardCanvasOp(() => vueFlowApi.addNodes(transformNode))
    await nextTick()
    graphStore.reconcileAll()

    attachEnteringClass(transformId)
    debouncedFitView([transformId])

    toastSuccess(t('aiChat.transformCreated', { name: transformType }))
    return
  }

  // DELETE/UPDATE：定位现有 Transform 节点（按 id；无 name 字段，兜底用 configName 前缀）
  const transformId = spec.transformId || ''
  let existing = graphStore.nodes.find((n) => n.id === transformId)
  if (!existing && transformId) {
    existing = graphStore.nodes.find(
      (n) =>
        n.type === 'transform' &&
        typeof (n.data as Record<string, unknown>).configName === 'string' &&
        ((n.data as Record<string, unknown>).configName as string).includes(transformId)
    )
  }

  if (existing && actionType === 'DELETE_TRANSFORM') {
    guardCanvasOp(() => vueFlowApi.removeNodes(existing.id))
    await nextTick()
    graphStore.reconcileAll()
    toastSuccess(t('aiChat.transformDeleted', { name: transformId }))
    return
  }

  if (existing && actionType === 'UPDATE_TRANSFORM') {
    // 刷新 params/outputColumns/description（数据来自后端重读的真实结果）
    graphStore.updateNodeData(existing.id, {
      params: spec.params,
      outputColumns: spec.outputColumns,
      description: spec.description,
    } as Partial<CustomNodeData>)
    toastSuccess(t('aiChat.transformUpdated', { name: transformId }))
    return
  }

  logger.info(`[AI Chat] Transform ${actionType}: 画布上无对应节点 (${transformId})`)
}

/**
 * canvasSpec.resourceKind → importV2ResourceToCanvas 的 ProjectResourceKind 映射
 *
 * pattern/regex_node 归一为 regex（与 importV2ResourceToCanvas 内部归一一致）。
 */
function normalizeResourceKind(kind: string): ProjectResourceKind {
  if (kind === 'pattern' || kind === 'regex_node') return 'regex'
  return kind as ProjectResourceKind
}

/**
 * 处理 ADD_TO_CANVAS 指令 — 把已存在的配置资源显示到画布上
 *
 * 与 ADD_*（创建节点对象）不同：本指令委托 graphStore.importV2ResourceToCanvas，
 * 由它从后端重读真实配置、构建规范节点数据、建立连接边（幂等，节点已存在则跳过）。
 *
 * 关键：传 skipRelatedConstraints=true，避免 AI 流程中弹出无人响应的确认对话框。
 */
async function handleAddToCanvasInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const spec = instruction.canvasSpec
  if (!spec) {
    logger.warn(`[AI Chat] ADD_TO_CANVAS 指令缺少 canvasSpec`)
    return
  }

  const resourceKind = normalizeResourceKind(spec.resourceKind || '')
  const resourceId = spec.resourceId || ''
  const displayName = spec.name || resourceId

  if (!resourceId) {
    logger.warn(`[AI Chat] ADD_TO_CANVAS 缺少 resourceId`)
    toastError(t('aiChat.targetNodeNotFound'))
    return
  }

  // 幂等检查：若画布已有同 id 节点，直接跳过（避免重复创建）
  if (graphStore.nodes.some((n) => n.id === resourceId)) {
    logger.info(`[AI Chat] ADD_TO_CANVAS: 节点 ${resourceId} 已在画布，跳过`)
    toastSuccess(t('aiChat.constraintCreated', { table: displayName, column: '' }))
    return
  }

  const position = computePlacementPosition(graphStore)

  try {
    const nodeId = await graphStore.importV2ResourceToCanvas(resourceKind, resourceId, position, {
      includeDeps: false,
      moveIfExists: false,
      // AI 流程跳过相关约束确认弹窗（无人响应会永久挂起）
      skipRelatedConstraints: true,
    })

    if (nodeId) {
      await nextTick()
      debouncedFitView([nodeId])
      toastSuccess(t('aiChat.schemaCreated', { name: displayName }))
    } else {
      logger.warn(`[AI Chat] ADD_TO_CANVAS: 导入失败（资源不存在或已被过滤）: ${resourceId}`)
      toastError(t('aiChat.targetNodeNotFound'))
    }
  } catch (error) {
    logger.error(`[AI Chat] ADD_TO_CANVAS 导入异常: ${resourceId}`, error)
    toastError(t('aiChat.targetNodeNotFound'))
  }
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
