/**
 * @file validationRegistry.ts
 * @description 约束验证注册表 - 管理所有数据质量约束类型的验证处理器
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 该模块是约束验证系统的核心注册中心，负责：
 * 1. 注册和管理所有约束类型的验证处理器
 * 2. 提供约束类型元数据查询接口
 * 3. 构建验证上下文并执行验证
 * 4. 处理连接断开时的状态重置
 *
 * ====================================================================
 * 支持的约束类型
 * ====================================================================
 * | 类型 | V2类型 | 说明 | 是否需要输入连接 |
 * |------|--------|------|-----------------|
 * | notNullConstraint | NotNull | 非空约束 | 否 |
 * | uniqueConstraint | Unique | 唯一性约束 | 否 |
 * | foreignKeyConstraint | ForeignKey | 外键约束 | 是 |
 * | allowedValuesConstraint | AllowedValues | 允许值约束 | 是 |
 * | rangeConstraint | Range | 区间约束 | 是 |
 * | conditionalConstraint | Conditional | 条件约束 | 否 |
 * | scriptedConstraint | Scripted | 脚本约束 | 是 |
 * | charsetConstraint | Charset | 字符集约束 | 是 |
 * | dateLogicConstraint | DateLogic | 日期逻辑约束 | 是 |
 *
 * ====================================================================
 * 架构设计
 * ====================================================================
 * - 采用注册表模式，新增约束类型只需调用 register() 方法
 * - 使用 Map 存储处理器，按 kind 作为 key
 * - 使用 typeToMeta 和 kindToMeta 两个 Map 提供快速查询
 * - 所有验证逻辑通过 handlers.get(kind).validate() 统一调用
 *
 * ====================================================================
 * 验证流程
 * ====================================================================
 * 1. validateConstraintNode: 验证单个约束节点
 *    - buildValidationContext: 构建验证上下文（列信息、文件路径等）
 *    - 获取对应的处理器
 *    - 调用 handler.validate(ctx) 执行验证
 *    - 更新节点数据（状态、错误信息、统计数据）
 *
 * 2. validateConstraintNodesForSchema: 验证 Schema 的所有关联约束
 *    - 查找所有从 Schema 出发的边
 *    - 过滤出约束节点
 *    - 逐个调用 validateConstraintNode
 *
 * ====================================================================
 * buildValidationContext 关键逻辑
 * ====================================================================
 * - 从 edge.sourceHandle 提取列 ID（格式: 'source-right-{columnId}'）
 * - 从 schemaNode 查找对应的列定义
 * - 提取数据源信息：文件路径、工作表名、表头行号
 * - 返回完整的验证上下文供处理器使用
 *
 * ====================================================================
 * 验证上下文（ConstraintValidationContext）
 * ====================================================================
 * 包含验证所需的所有信息：
 * - nodes: 画布节点列表（用于查找关联节点）
 * - schemaNode: Schema 节点（数据源）
 * - constraintNode: 约束节点（配置信息）
 * - edge: 连接边（列标识）
 * - columnId/columnName: 列信息
 * - sourceFilePath/sourceFile: 数据源路径
 * - sheetName/headerRow: 工作表信息
 *
 * ====================================================================
 * 处理器注册模式
 * ====================================================================
 * 每种约束类型都注册一个 handler，包含：
 * - kind: 约束类型标识
 * - validate: 异步验证函数
 * - resetOnDisconnect: 断开连接时的重置函数
 *
 * validate 函数返回 ConstraintValidationResult：
 * - status: 状态（pass/error/missing/idle）
 * - validationErrors: 错误信息数组
 * - lastValidation: 统计数据（totalRows/errorCount/matchCount）
 *
 * ====================================================================
 * requireSource 防护检查
 * ====================================================================
 * 所有处理器首先调用 requireSource 检查数据源：
 * - 如果缺少 sourceFile 或 sourceFilePath，返回 missing 状态
 * - 避免在无数据源时执行无效的 API 调用
 *
 * ====================================================================
 * getTargetValues 辅助函数
 * ====================================================================
 * 用于外键约束，获取目标表的所有值：
 * - 查找目标 Schema 节点
 * - 提取指定列的所有非空值
 * - 去重后返回，用于参照完整性检查
 *
 * ====================================================================
 * resetOnDisconnect 默认行为
 * ====================================================================
 * 断开连接时重置节点状态：
 * - validationStatus → 'idle'
 * - validationErrors → []
 * - lastValidation → undefined
 *
 * 特殊约束可自定义重置逻辑（如 ForeignKey 需要清理 targetRef）。
 *
 * ====================================================================
 * 关键设计决策
 * ====================================================================
 * 1. 【注册表模式】新增约束类型只需注册，无需修改调度代码
 * 2. 【类型映射】nodeType ↔ kind ↔ v2Type 三向映射
 * 3. 【异步验证】所有验证都是异步的，调用后端 API
 * 4. 【上下文构建】验证所需的上下文通过 edge 和 node 构建，而非从节点存储读取
 *
 * ====================================================================
 * 依赖说明
 * ====================================================================
 * - @vue-flow/core: 节点和边的类型定义
 * - @/api/validationApi: 后端验证 API
 * - @/composables/nodes/constraints: 部分约束的本地验证函数
 * - ./types: 约束相关的类型定义
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 验证会更新节点的 validationStatus、validationErrors、lastValidation
 * - 验证可能触发多次 API 调用
 * - validateConstraintNode 会通过 updateNodeData 触发响应式更新
 *
 * @module core/constraints
 */

import type { Edge, Node } from '@vue-flow/core'
import {
  validateAllowedValues,
  validateCharset,
  validateConditional,
  validateForeignKey,
  validateRange,
  validateScripted,
} from '@/api/validationApi'
import { validateNotNull } from '@/composables/nodes/constraints/useNotNull'
import { validateUnique } from '@/composables/nodes/constraints/useUnique'
import { getApiBaseUrl } from '@/core/services/httpClient'
import { logger } from '@/core/utils/logger'
import type {
  ConstraintKind,
  ConstraintNodeType,
  ConstraintTypeMeta,
  ConstraintValidationContext,
  ConstraintValidationHandler,
  ConstraintValidationResult,
} from './types'

export const CONSTRAINT_TYPES: ConstraintTypeMeta[] = [
  { nodeType: 'notNullConstraint', kind: 'notNull', v2Type: 'NotNull', requireInputHandle: false },
  { nodeType: 'uniqueConstraint', kind: 'unique', v2Type: 'Unique', requireInputHandle: false },
  {
    nodeType: 'foreignKeyConstraint',
    kind: 'foreignKey',
    v2Type: 'ForeignKey',
    requireInputHandle: true,
  },
  {
    nodeType: 'allowedValuesConstraint',
    kind: 'allowedValues',
    v2Type: 'AllowedValues',
    requireInputHandle: true,
  },
  { nodeType: 'rangeConstraint', kind: 'range', v2Type: 'Range', requireInputHandle: true },
  {
    nodeType: 'conditionalConstraint',
    kind: 'conditional',
    v2Type: 'Conditional',
    requireInputHandle: false,
  },
  {
    nodeType: 'scriptedConstraint',
    kind: 'scripted',
    v2Type: 'Scripted',
    requireInputHandle: true,
  },
  { nodeType: 'charsetConstraint', kind: 'charset', v2Type: 'Charset', requireInputHandle: true },
  {
    nodeType: 'dateLogicConstraint',
    kind: 'dateLogic',
    v2Type: 'DateLogic',
    requireInputHandle: true,
  },
  {
    nodeType: 'compositeConstraint',
    kind: 'composite',
    v2Type: 'Composite',
    requireInputHandle: true,
  },
]

export const typeToMeta = new Map(CONSTRAINT_TYPES.map((x) => [x.nodeType, x]))
export const kindToMeta = new Map(CONSTRAINT_TYPES.map((x) => [x.kind, x]))

export const handlers = new Map<ConstraintKind, ConstraintValidationHandler>()

export const defaultReset = (nodeData: Record<string, unknown>) => ({
  ...nodeData,
  validationStatus: 'idle',
  validationErrors: [],
  lastValidation: undefined,
})

export const toResult = (
  errorRows: unknown[] | undefined,
  totalRows: number,
  fallbackMessage: string
): ConstraintValidationResult => {
  const rows = Array.isArray(errorRows) ? errorRows : []
  const errorCount = rows.length
  const messages = rows.map((err) => {
    const errRec = err as Record<string, unknown>
    const row = typeof errRec?.row_index === 'number' ? (errRec.row_index as number) + 1 : '-'
    const msg = (errRec?.error_message as string) || fallbackMessage
    return `第 ${row} 行: ${msg}`
  })
  return {
    status: errorCount > 0 ? 'error' : 'pass',
    validationErrors: messages,
    lastValidation: {
      totalRows,
      errorCount,
      matchCount: Math.max(0, totalRows - errorCount),
    },
  }
}

export const requireSource = (
  ctx: ConstraintValidationContext
): ConstraintValidationResult | null => {
  // 行内数据源（TransformOutput / ManualData）无需文件路径
  if (ctx.inlineRows && ctx.inlineRows.length > 0) {
    return null
  }
  if (!ctx.sourceFile || !ctx.sourceFilePath) {
    return { status: 'idle', validationErrors: [], lastValidation: undefined }
  }
  return null
}

export const getTargetValues = (
  targetSchemaNode: Node | undefined,
  targetColumnName: string,
  nodes?: Node[]
): string[] => {
  if (!targetSchemaNode || targetSchemaNode.type !== 'schema') return []
  const targetSchemaData = (targetSchemaNode.data || {}) as Record<string, unknown>
  let rows =
    (targetSchemaData?.originalData as unknown[]) || (targetSchemaData?.data as unknown[]) || []

  // 如果 Schema 节点自身没有数据行，尝试从关联的 SourcePreview 节点获取
  if ((!Array.isArray(rows) || rows.length === 0) && nodes) {
    const sourceNodeId = targetSchemaData?.sourceNodeId as string | undefined
    if (sourceNodeId) {
      const sourcePreviewNode = nodes.find((n) => n.id === sourceNodeId)
      if (sourcePreviewNode?.type === 'sourcePreview') {
        const spData = (sourcePreviewNode.data || {}) as Record<string, unknown>
        rows = (spData?.data as unknown[]) || []
      }
    }
  }

  if (!Array.isArray(rows) || rows.length === 0) return []
  const headerRowIndex =
    typeof targetSchemaData?.headerRow === 'number' ? (targetSchemaData.headerRow as number) : 0
  const header = (rows[headerRowIndex] as unknown[]) || []
  const colIndex = Array.isArray(header)
    ? header.findIndex((h) => String(h ?? '').trim() === targetColumnName)
    : -1
  if (colIndex < 0) return []
  const values = rows
    .slice(headerRowIndex + 1)
    .map((r) => (Array.isArray(r) ? (r as unknown[])[colIndex] : undefined))
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .map((v) => String(v))
  return Array.from(new Set(values))
}

export function register(handler: ConstraintValidationHandler) {
  handlers.set(handler.kind, handler)
}

export function getConstraintNodeTypes(): ConstraintNodeType[] {
  return CONSTRAINT_TYPES.map((x) => x.nodeType)
}

export function getConstraintKinds(): ConstraintKind[] {
  return CONSTRAINT_TYPES.map((x) => x.kind)
}

export function isConstraintNodeType(type: string | undefined): type is ConstraintNodeType {
  if (!type) return false
  return typeToMeta.has(type as ConstraintNodeType)
}

export function getConstraintKindByNodeType(type: string | undefined): ConstraintKind | '' {
  if (!type) return ''
  return typeToMeta.get(type as ConstraintNodeType)?.kind || ''
}

export function requiresInputHandle(nodeType: string | undefined): boolean {
  if (!nodeType) return false
  return typeToMeta.get(nodeType as ConstraintNodeType)?.requireInputHandle || false
}

export function getHandlerByNodeType(type: string | undefined): ConstraintValidationHandler | null {
  const kind = getConstraintKindByNodeType(type)
  if (!kind) return null
  return handlers.get(kind) || null
}

export function getHandlerByKind(kind: ConstraintKind): ConstraintValidationHandler | null {
  return handlers.get(kind) || null
}

export function buildValidationContext(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
}): ConstraintValidationContext | null {
  const { schemaNode, constraintNode, edge } = params
  const sourceHandle = edge.sourceHandle || ''
  if (!sourceHandle.startsWith('source-right-')) return null
  const columnId = sourceHandle.replace('source-right-', '')
  const schemaData = (schemaNode.data || {}) as Record<string, unknown>
  const column = ((schemaData.columns || []) as unknown[]).find(
    (c) => (c as Record<string, unknown>).id === columnId
  ) as Record<string, unknown> | undefined
  if (!column) return null
  return {
    nodes: params.nodes,
    schemaNode,
    constraintNode,
    edge,
    columnId,
    columnName: column.columnName as string,
    sourceFilePath: (schemaData.localPath || schemaData.sourceFilePath) as string,
    sourceFile: schemaData.sourceFile as string,
    sheetName: schemaData.sheetName as string,
    headerRow: typeof schemaData.headerRow === 'number' ? schemaData.headerRow : 0,
  }
}

export async function validateConstraintNode(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<void> {
  const { schemaNode, constraintNode, edge, nodes, updateNodeData } = params
  const handler = getHandlerByNodeType(constraintNode.type)
  if (!handler) return
  const ctx = buildValidationContext({ schemaNode, constraintNode, edge, nodes })
  if (!ctx) return
  const result = await handler.validate(ctx)
  updateNodeData(constraintNode.id, {
    ...(constraintNode.data as Record<string, unknown>),
    table: ((schemaNode.data || {}) as Record<string, unknown>)?.tableName as string,
    column: ctx.columnName,
    sourceRef: { nodeId: schemaNode.id, columnId: ctx.columnId },
    validationStatus: result.status,
    validationErrors: result.validationErrors,
    lastValidation: result.lastValidation,
  })
}

export async function validateConstraintNodesForSchema(params: {
  schemaNodeId: string
  nodes: Node[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<void> {
  const { schemaNodeId, nodes, edges, updateNodeData } = params
  const schemaNode = nodes.find((n) => n.id === schemaNodeId && n.type === 'schema')
  if (!schemaNode) return
  const schemaEdges = edges.filter((e) => e.source === schemaNodeId)

  // ============================================================================
  // 分两阶段执行约束校验
  // ============================================================================
  // 第一阶段：先执行非 Composite 约束，确保其结果可用
  // 第二阶段：再执行 Composite 约束，使其能读取上游约束的已执行结果

  const nonCompositeEdges = schemaEdges.filter((e) => {
    const node = nodes.find((n) => n.id === e.target)
    return node?.type !== 'compositeConstraint'
  })

  const compositeEdges = schemaEdges.filter((e) => {
    const node = nodes.find((n) => n.id === e.target)
    return node?.type === 'compositeConstraint'
  })

  // 收集每列的校验错误，用于同步更新 Schema 列的 validationErrors
  const columnErrorMap = new Map<string, string[]>()

  for (const edge of nonCompositeEdges) {
    const constraintNode = nodes.find((n) => n.id === edge.target)
    if (!constraintNode || !isConstraintNodeType(constraintNode.type)) continue
    const ctx = buildValidationContext({ schemaNode, constraintNode, edge, nodes })
    if (!ctx) continue
    const handler = getHandlerByNodeType(constraintNode.type)
    if (!handler) continue
    const result = await handler.validate(ctx)

    // 更新约束节点状态
    updateNodeData(constraintNode.id, {
      ...(constraintNode.data as Record<string, unknown>),
      table: ((schemaNode.data || {}) as Record<string, unknown>)?.tableName as string,
      column: ctx.columnName,
      sourceRef: { nodeId: schemaNode.id, columnId: ctx.columnId },
      validationStatus: result.status,
      validationErrors: result.validationErrors,
      lastValidation: result.lastValidation,
    })

    // 收集该列的错误
    if (result.validationErrors.length > 0) {
      const existing = columnErrorMap.get(ctx.columnId) || []
      columnErrorMap.set(ctx.columnId, [...existing, ...result.validationErrors])
    }
  }

  for (const edge of compositeEdges) {
    const constraintNode = nodes.find((n) => n.id === edge.target)
    if (!constraintNode || !isConstraintNodeType(constraintNode.type)) continue
    await validateConstraintNode({ schemaNode, constraintNode, edge, nodes, updateNodeData })
  }

  // 同步更新 Schema 列的 validationErrors
  const schemaData = (schemaNode.data || {}) as Record<string, unknown>
  const columns = (schemaData.columns || []) as Array<Record<string, unknown>>
  if (columns.length > 0 && (nonCompositeEdges.length > 0 || compositeEdges.length > 0)) {
    const updatedColumns = columns.map((col) => {
      const colId = col.id as string
      const errors = columnErrorMap.get(colId) || []
      return {
        ...col,
        validationErrors: errors,
      }
    })
    updateNodeData(schemaNodeId, {
      ...schemaData,
      columns: updatedColumns,
    })
  }
}

// ============================================================================
// 约束节点目标引用解析接口
// ============================================================================
/**
 * 解析约束节点对目标 Schema 的引用
 *
 * 不同约束类型可能引用其他 Schema 作为目标/参照。
 * 当目标 Schema 的数据源就绪时，需要重新验证这些约束。
 *
 * @returns 被引用的目标 Schema 节点 ID 数组；如果没有引用返回空数组
 */
export type TargetRefResolver = (nodeData: Record<string, unknown>) => string[]

/**
 * 约束类型到目标引用解析器的映射
 *
 * 注册方式：约束处理器注册时通过 registerTargetRefResolver 注册
 * 未注册的约束类型默认不引用其他 Schema
 */
const targetRefResolvers = new Map<string, TargetRefResolver>()

/**
 * 注册约束类型的目标引用解析器
 *
 * @param nodeType - 约束节点类型（如 'foreignKeyConstraint'）
 * @param resolver - 解析函数，返回该约束引用的目标 Schema ID 列表
 */
export function registerTargetRefResolver(
  nodeType: string,
  resolver: TargetRefResolver
): void {
  targetRefResolvers.set(nodeType, resolver)
}

/**
 * 获取约束节点引用的所有目标 Schema ID
 *
 * @param constraintNode - 约束节点
 * @returns 目标 Schema 节点 ID 数组
 */
export function getConstraintTargetRefs(constraintNode: Node): string[] {
  const resolver = targetRefResolvers.get(constraintNode.type || '')
  if (!resolver) return []
  return resolver((constraintNode.data || {}) as Record<string, unknown>)
}

/**
 * 当 Schema 节点数据源就绪时，触发引用该 Schema 为目标的约束重新验证
 *
 * 设计说明：
 * - 这是通用机制，不针对特定约束类型
 * - 约束类型通过 registerTargetRefResolver 声明自己的目标引用关系
 * - 新增约束类型时只需注册解析器，无需修改此处逻辑
 *
 * @param schemaNodeId - 数据源就绪的 Schema 节点 ID
 * @param nodes - 画布所有节点
 * @param edges - 画布所有边
 * @param updateNodeData - 更新节点数据的回调
 */
export async function revalidateConstraintsReferencingSchema(params: {
  schemaNodeId: string
  nodes: Node[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<void> {
  const { schemaNodeId, nodes, edges, updateNodeData } = params

  // 收集所有引用本 Schema 为目标的约束节点
  const referencingConstraints = nodes.filter((n) => {
    if (!isConstraintNodeType(n.type)) return false
    const targetIds = getConstraintTargetRefs(n)
    return targetIds.includes(schemaNodeId)
  })

  if (referencingConstraints.length === 0) return

  // 按源 Schema 分组，避免同一源 Schema 被重复验证
  const sourceSchemaIds = new Set<string>()
  for (const constraintNode of referencingConstraints) {
    // 约束节点的源 Schema 通过 edges 查找（约束边从 Schema 指向约束节点）
    const sourceEdges = edges.filter((e) => e.target === constraintNode.id)
    for (const edge of sourceEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'schema') {
        sourceSchemaIds.add(sourceNode.id)
      }
    }
  }

  for (const srcSchemaId of sourceSchemaIds) {
    await validateConstraintNodesForSchema({
      schemaNodeId: srcSchemaId,
      nodes,
      edges,
      updateNodeData,
    }).catch((err) => {
      logger.warn(`[revalidateConstraintsReferencingSchema] 源 ${srcSchemaId} 重验失败:`, err)
    })
  }

  logger.debug(
    `[revalidateConstraintsReferencingSchema] 已触发 ${referencingConstraints.length} 个约束的重验（涉及 ${sourceSchemaIds.size} 个源 Schema）`
  )
}

export function buildDisconnectReset(
  nodeType: string | undefined,
  nodeData: Record<string, unknown>
): Record<string, unknown> {
  const kind = getConstraintKindByNodeType(nodeType)
  if (!kind) return defaultReset(nodeData)
  const handler = handlers.get(kind)
  if (!handler) return defaultReset(nodeData)
  return handler.resetOnDisconnect(nodeData)
}

export function getConstraintMetaByKind(kind: ConstraintKind): ConstraintTypeMeta | null {
  return kindToMeta.get(kind) || null
}

export function getV2ConstraintTypeByKind(kind: ConstraintKind): ConstraintTypeMeta['v2Type'] | '' {
  return kindToMeta.get(kind)?.v2Type || ''
}

export function getV2ConstraintTypeByNodeType(
  nodeType: string | undefined
): ConstraintTypeMeta['v2Type'] | '' {
  if (!nodeType) return ''
  return typeToMeta.get(nodeType as ConstraintNodeType)?.v2Type || ''
}

/**
 * 低层约束执行器 —— 不依赖 Vue Flow 节点对象
 *
 * 为 System B 的 batch / inline 场景提供纯数据驱动的验证入口，
 * 内部构造最小 mock 上下文以满足现有 handler 的接口要求。
 */
export async function executeConstraintValidation(params: {
  kind: ConstraintKind
  columnName: string
  sourceFilePath: string
  sourceFile: string
  sheetName: string
  headerRow: number
  constraintData: Record<string, unknown>
  nodes?: Node[]
  schemaColumns?: unknown[]
}): Promise<ConstraintValidationResult> {
  const handler = getHandlerByKind(params.kind)
  if (!handler) {
    return {
      status: 'idle',
      validationErrors: [`未知约束类型: ${params.kind}`],
      lastValidation: undefined,
    }
  }

  const mockEdge = {} as Edge
  const mockConstraintNode = { data: params.constraintData } as Node
  const mockSchemaNode = { data: { columns: params.schemaColumns || [] } } as Node

  const ctx: ConstraintValidationContext = {
    nodes: params.nodes || [],
    schemaNode: mockSchemaNode,
    constraintNode: mockConstraintNode,
    edge: mockEdge,
    columnId: '',
    columnName: params.columnName,
    sourceFilePath: params.sourceFilePath,
    sourceFile: params.sourceFile,
    sheetName: params.sheetName,
    headerRow: params.headerRow,
  }

  return handler.validate(ctx)
}

/**
 * 为纯数据节点（TransformOutput / ManualData）触发约束校验
 *
 * 这些节点的数据（rows: string[][]）已在前端内存中，
 * 无需后端文件路径，通过 inlineRows 传递给约束处理器进行本地校验。
 *
 * @param sourceNodeId - 源节点 ID（TransformOutput 或 ManualData）
 * @param constraintNode - 约束节点
 * @param nodes - 图中所有节点
 * @param updateNodeData - 更新节点数据的回调
 */
export async function validateForInlineSource(params: {
  sourceNodeId: string
  constraintNode: Node
  nodes: Node[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<void> {
  const { sourceNodeId, constraintNode, nodes, updateNodeData } = params

  const sourceNode = nodes.find((n) => n.id === sourceNodeId)
  if (!sourceNode) {
    logger.warn('❌ 未找到源节点:', sourceNodeId)
    return
  }

  // 从 TransformOutput / ManualData 节点提取行数据
  const sourceData = sourceNode.data as Record<string, unknown>
  const rawRows = (sourceData.rows as string[][]) || []
  const columnName = (sourceData.columnName as string) || 'Column1'

  const handler = getHandlerByNodeType(constraintNode.type)
  if (!handler) {
    logger.debug('ℹ️ 未找到约束处理器:', constraintNode.type)
    return
  }

  // ManualData 节点的 rows 是纯数据行（不含表头），
  // 但后端 inline 校验默认将第一行视为表头。
  // 因此需要在 rows 前添加表头行，使后端能正确识别列名。
  const isManualData = sourceNode.type === 'manualData'
  const inlineRows = isManualData && rawRows.length > 0
    ? [[columnName], ...rawRows]
    : rawRows

  // 构建带有 inlineRows 的校验上下文
  const ctx: ConstraintValidationContext = {
    nodes,
    schemaNode: sourceNode,
    constraintNode,
    edge: {} as Edge,
    columnId: '0',
    columnName,
    inlineRows,
  }

  const result = await handler.validate(ctx)

  updateNodeData(constraintNode.id, {
    ...(constraintNode.data as Record<string, unknown>),
    table: (sourceData.configName as string) || columnName,
    column: columnName,
    sourceRef: { nodeId: sourceNode.id, columnId: '0' },
    validationStatus: result.status,
    validationErrors: result.validationErrors,
    lastValidation: result.lastValidation,
  })
}
