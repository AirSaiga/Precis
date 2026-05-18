/**
 * @file validationCollector.ts
 * @description 约束收集器 - 从图中收集约束信息
 *
 * 该模块负责从 Vue Flow 图中提取约束相关信息：
 * - 收集从 SchemaNode 出发的所有约束连接
 * - 提取每个约束的 columnId、列名和约束类型
 * - 获取 SchemaNode 关联的数据源信息
 *
 * @module validationCollector
 */

import { logger } from '@/core/utils/logger'
import type { Edge, Node } from '@vue-flow/core'
import { getConstraintKindByNodeType } from '@/services/constraints/validationRegistry'

/**
 * 约束信息接口
 * 描述从 SchemaNode 的列连接到约束节点的详细信息
 */
export interface ConstraintInfo {
  /** 列的唯一标识符 */
  columnId: string
  /** 列的名称 */
  columnName: string
  /** 约束类型：非空、唯一、外键、允许值、区间、条件、脚本 */
  constraintType:
    | 'notNull'
    | 'unique'
    | 'foreignKey'
    | 'allowedValues'
    | 'range'
    | 'conditional'
    | 'scripted'
    | 'charset'
    | 'dateLogic'
  /** 约束节点的 ID */
  constraintNodeId: string
}

/**
 * SchemaNode 数据源信息接口
 * 描述 SchemaNode 关联的数据源详细信息
 */
export interface SchemaNodeSourceInfo {
  /** 数据源文件的完整路径（可能是展示名或 UUID） */
  sourceFilePath: string
  /** 数据源显示名称（用于判断是否显式连接） */
  sourceFile?: string
  /** Excel 工作表名称（可选） */
  sheetName?: string
  /** 数据源预览节点的 ID（可选） */
  sourceNodeId?: string
  /** 表头行号（可选，默认为 0） */
  headerRow?: number
  /** 数据来源模式：localfile */
  sourceMode?: 'localfile'
  /** 本地文件路径（Electron 环境专用，为真实路径） */
  localPath?: string
}

/**
 * 收集从指定 SchemaNode 出发的所有约束连接信息
 *
 * 该函数遍历从 SchemaNode 出发的所有边，识别连接到约束节点的边，
 * 并提取每个约束的详细信息（列 ID、列名、约束类型、约束节点 ID）。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @returns 约束信息数组，如果未找到 SchemaNode 则返回空数组
 *
 * @example
 * ```typescript
 * const constraints = collectConnectedConstraints('schema-1', nodes, edges);
 * // 返回: [{ columnId: 'col-1', columnName: 'email', constraintType: 'unique', constraintNodeId: 'unique-1' }]
 * ```
 */
export function collectConnectedConstraints(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[]
): ConstraintInfo[] {
  const constraints: ConstraintInfo[] = []
  /**
   * 用于去重的键集合：避免“边连接收集”与“列内约束收集”产生重复条目
   * key 格式：`${constraintType}:${columnId}`
   */
  const constraintKeys = new Set<string>()

  const schemaNode = nodes.find((n) => n.id === schemaNodeId && n.type === 'schema')
  if (!schemaNode) {
    logger.warn('❌ 未找到 SchemaNode:', schemaNodeId)
    return constraints
  }

  const schemaData = schemaNode.data as Record<string, any>
  const columns = schemaData.columns || []

  const outgoingEdges = edges.filter((e) => e.source === schemaNodeId)

  for (const edge of outgoingEdges) {
    const targetNodeId = edge.target
    const targetNode = nodes.find((n) => n.id === targetNodeId)

    if (!targetNode) continue

    const constraintType = getConstraintTypeFromNodeType(targetNode.type)
    if (!constraintType) continue

    const sourceHandle = edge.sourceHandle
    if (!sourceHandle || !sourceHandle.startsWith('source-right-')) continue

    const columnId = sourceHandle.replace('source-right-', '')
    const column = columns.find((col: any) => col.id === columnId)

    if (!column) {
      logger.warn('❌ 未找到列:', columnId)
      continue
    }

    constraints.push({
      columnId,
      columnName: column.columnName,
      constraintType,
      constraintNodeId: targetNodeId,
    })
    constraintKeys.add(`${constraintType}:${columnId}`)
  }

  /**
   * 额外收集列内约束（column.constraints）
   * - 用于支持“Unique/NotNull 连接后变成列内徽章、节点自动消失”的交互形态
   * - 避免全表校验依赖约束节点是否存在
   */
  for (const column of columns) {
    // Step 1: 只处理结构完整的列定义，保证后续校验可定位到 columnId/columnName
    const constraintsInColumn = column?.constraints || {}
    const columnId = column?.id as string | undefined
    const columnName = column?.columnName as string | undefined
    if (!columnId || !columnName) continue

    // Step 2: notNull/unique 分别生成“虚拟约束条目”，constraintNodeId 仅用于标识，不参与校验计算
    if (constraintsInColumn.notNull === true && !constraintKeys.has(`notNull:${columnId}`)) {
      constraints.push({
        columnId,
        columnName,
        constraintType: 'notNull',
        constraintNodeId: `inline_notNull_${schemaNodeId}_${columnId}`,
      })
      constraintKeys.add(`notNull:${columnId}`)
    }

    if (constraintsInColumn.unique === true && !constraintKeys.has(`unique:${columnId}`)) {
      constraints.push({
        columnId,
        columnName,
        constraintType: 'unique',
        constraintNodeId: `inline_unique_${schemaNodeId}_${columnId}`,
      })
      constraintKeys.add(`unique:${columnId}`)
    }
  }

  logger.debug(`🔍 收集到 ${constraints.length} 个约束:`, constraints)
  return constraints
}

/**
 * 获取指定 SchemaNode 关联的数据源信息
 *
 * 该函数查找指向指定 SchemaNode 的输入边，
 * 从中提取数据源文件路径、工作表名称、表头行号等信息。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @returns 数据源信息对象，如果未找到连接则返回 null
 *
 * @example
 * ```typescript
 * const sourceInfo = getSchemaNodeSourceInfo('schema-1', nodes, edges);
 * if (sourceInfo) {
 *   logger.debug('文件路径:', sourceInfo.sourceFilePath);
 *   logger.debug('工作表:', sourceInfo.sheetName);
 * }
 * ```
 */
export function getSchemaNodeSourceInfo(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[]
): SchemaNodeSourceInfo | null {
  const schemaNode = nodes.find((n) => n.id === schemaNodeId && n.type === 'schema')
  const schemaData = schemaNode?.data as Record<string, any>

  // 优先从 Schema 节点自身读取数据源信息（bindDataSource / 手动同步后都会写入）
  const schemaLocalPath = schemaData?.localPath as string | undefined
  const schemaSourceFilePath = schemaData?.sourceFilePath as string | undefined
  const schemaSheetName = schemaData?.sheetName as string | undefined
  const schemaHeaderRow = schemaData?.headerRow as number | undefined
  const schemaSourceMode = schemaData?.sourceMode as 'localfile' | undefined
  const schemaSourceFile = schemaData?.sourceFile as string | undefined

  const hasPathFromSchema = !!(schemaLocalPath || schemaSourceFilePath)
  if (hasPathFromSchema) {
    return {
      sourceFilePath: schemaSourceFilePath || schemaLocalPath || '',
      sourceFile: schemaSourceFile || '',
      sheetName: schemaSheetName,
      sourceNodeId: schemaData?.sourceNodeId,
      headerRow: schemaHeaderRow,
      sourceMode: schemaSourceMode || 'localfile',
      localPath: schemaLocalPath,
    }
  }

  // 回退：通过 SourcePreview 节点查找（兼容旧连接方式）
  let sourcePreviewNode: Node | undefined

  if (schemaData?.sourceNodeId) {
    sourcePreviewNode = nodes.find(
      (n) => n.id === schemaData.sourceNodeId && n.type === 'sourcePreview'
    )
  }

  if (!sourcePreviewNode) {
    const incomingEdge = edges.find(
      (edge) =>
        edge.target === schemaNodeId &&
        (edge.targetHandle === undefined || edge.targetHandle === 'target-left')
    )

    if (!incomingEdge) {
      return null
    }

    sourcePreviewNode = nodes.find(
      (n) => n.id === incomingEdge.source && n.type === 'sourcePreview'
    )
  }

  if (!sourcePreviewNode) {
    return null
  }

  const sourceData = (sourcePreviewNode.data as Record<string, any>) || {}

  return {
    sourceFilePath: sourceData.localPath || '',
    sourceFile: sourceData.sourceName || sourceData.fileName || '',
    sheetName: sourceData.currentSheet,
    sourceNodeId: sourcePreviewNode.id,
    headerRow: sourceData.headerRow,
    sourceMode: sourceData.sourceMode,
    localPath: sourceData.localPath,
  }
}

/**
 * 根据节点类型获取对应的约束类型
 *
 * 内部辅助函数，将 Vue Flow 节点类型字符串转换为约束类型枚举。
 *
 * @param nodeType - 节点类型字符串
 * @returns 对应的约束类型，如果无法识别则返回 null
 *
 * @example
 * ```typescript
 * getConstraintTypeFromNodeType('notNullConstraint')  // 返回 'notNull'
 * getConstraintTypeFromNodeType('unique-constraint') // 返回 'unique'
 * ```
 */
function getConstraintTypeFromNodeType(
  nodeType: string | undefined
): ConstraintInfo['constraintType'] | null {
  const kind = getConstraintKindByNodeType(nodeType)
  return (kind || null) as ConstraintInfo['constraintType'] | null
}
