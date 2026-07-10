/**
 * @file validationCollector.ts
 * @description 约束收集器 - 从图中收集约束信息
 *
 * 该模块负责从 Vue Flow 图中提取约束相关信息：
 * - 获取 SchemaNode 关联的数据源信息
 *
 * @module validationCollector
 */

import type { Edge, Node } from '@vue-flow/core'

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
 * 获取指定 SchemaNode 关联的数据源信息
 *
 * 该函数查找指向指定 SchemaNode 的输入边，
 * 从中提取数据源文件路径、工作表名称、表头行号等信息。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @returns 数据源信息对象，如果未找到连接则返回 null
 */
export function getSchemaNodeSourceInfo(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[]
): SchemaNodeSourceInfo | null {
  const schemaNode = nodes.find(
    (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
  )
  const schemaData = schemaNode?.data as Record<string, unknown>

  const schemaLocalPath = schemaData?.localPath as string | undefined
  const schemaSourceFilePath = schemaData?.sourceFilePath as string | undefined
  const schemaSheetName = schemaData?.sheetName as string | undefined
  const schemaHeaderRow = schemaData?.headerRow as number | undefined
  const schemaSourceMode = schemaData?.sourceMode as 'localfile' | undefined
  const schemaSourceFile = schemaData?.sourceFile as string | undefined
  const schemaSourceNodeId = schemaData?.sourceNodeId as string | undefined

  // 通过 SourcePreview 节点查找数据源（兼容 sourceNodeId 引用与入边两种连接方式）
  let sourcePreviewNode: Node | undefined

  if (schemaSourceNodeId) {
    sourcePreviewNode = nodes.find(
      (n) =>
        n.id === schemaSourceNodeId &&
        (n.type === 'sourcePreview' || n.type === 'jsonSourcePreview')
    )
    // Bug 2.1 防护：sourceNodeId 指向的节点已不存在（被删除或边已断开）时，
    // 不应回退到 Schema 缓存路径——否则会基于 stale 数据继续校验。
    // 但若 sourceNodeId 本身不存在（V2 导入的内联数据源，路径直接写入 Schema），
    // 则保留对缓存路径的信任。
  }

  if (!sourcePreviewNode && !schemaSourceNodeId) {
    // 无 sourceNodeId：尝试通过入边查找（旧连接方式）
    const incomingEdge = edges.find(
      (edge) =>
        edge.target === schemaNodeId &&
        (edge.targetHandle === undefined || edge.targetHandle === 'target-left')
    )

    if (!incomingEdge) {
      // 既无 sourceNodeId 也无入边：可能是 V2 导入的内联数据源，直接使用 Schema 缓存路径
      const hasInlineCachedPath = !!(schemaLocalPath || schemaSourceFilePath)
      if (hasInlineCachedPath) {
        return {
          sourceFilePath: schemaSourceFilePath || schemaLocalPath || '',
          sourceFile: schemaSourceFile || '',
          sheetName: schemaSheetName,
          sourceNodeId: schemaSourceNodeId,
          headerRow: schemaHeaderRow,
          sourceMode: schemaSourceMode || 'localfile',
          localPath: schemaLocalPath,
        }
      }
      return null
    }

    sourcePreviewNode = nodes.find(
      (n) =>
        n.id === incomingEdge.source &&
        (n.type === 'sourcePreview' || n.type === 'jsonSourcePreview')
    )
  }

  // 有 sourceNodeId 但对应节点不可达（被删除/边已断开）：视为未连接
  if (!sourcePreviewNode) {
    return null
  }

  const sourceData = (sourcePreviewNode.data as Record<string, unknown>) || {}

  return {
    sourceFilePath: (sourceData.localPath as string | undefined) || '',
    sourceFile:
      (sourceData.sourceName as string | undefined) ||
      (sourceData.fileName as string | undefined) ||
      '',
    sheetName: sourceData.currentSheet as string | undefined,
    sourceNodeId: sourcePreviewNode.id,
    headerRow: sourceData.headerRow as number | undefined,
    sourceMode: sourceData.sourceMode as 'localfile' | undefined,
    localPath: sourceData.localPath as string | undefined,
  }
}
