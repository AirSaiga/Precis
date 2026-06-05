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
  const schemaNode = nodes.find((n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema'))
  const schemaData = schemaNode?.data as Record<string, any>

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
      (n) => n.id === schemaData.sourceNodeId && (n.type === 'sourcePreview' || n.type === 'jsonSourcePreview')
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
      (n) => n.id === incomingEdge.source && (n.type === 'sourcePreview' || n.type === 'jsonSourcePreview')
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
