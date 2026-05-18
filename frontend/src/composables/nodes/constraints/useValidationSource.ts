/**
 * @file useValidationSource.ts
 * @description 校验源信息解析工具
 *
 * 功能概述:
 * - 从 Schema 节点解析校验所需的源文件信息
 * - 解析文件路径、工作表名、表头行号、列名
 * - 处理 SourcePreview 节点的本地路径回退
 * - 被 Range/Charset/DateLogic 等约束节点共享使用
 *
 * 架构设计:
 * - 纯函数，无副作用（不更新 store）
 * - 返回 null 表示解析失败，由调用方处理错误状态
 */

import type { useGraphStore } from '@/stores/graphStore'

/**
 * 解析后的校验源信息
 */
export interface ResolvedValidationSource {
  /** 实际文件路径 */
  filePath: string
  /** 工作表名称 */
  sheetName?: string
  /** 表头行索引 */
  headerRow?: number
  /** 列名 */
  columnName: string
  /** Schema 节点 ID */
  sourceNodeId: string
  /** 列 ID */
  columnId: string
}

/**
 * 从连接信息解析校验源
 *
 * 解析流程:
 * 1. 查找源 Schema 节点
 * 2. 从 Schema 节点数据提取 sourceFilePath / localPath
 * 3. 通过 sourceNodeId 查找 SourcePreview 节点获取实际文件路径
 * 4. 验证 sourceFile 存在性（防止残留路径导致幽灵数据）
 * 5. 从 columns 数组查找列名
 * 6. 返回解析结果或 null
 *
 * @param store - graphStore 实例
 * @param sourceRef - 源引用 { nodeId, columnId }
 * @returns 解析成功返回 ResolvedValidationSource，失败返回 null
 */
export function resolveValidationSource(
  store: ReturnType<typeof useGraphStore>,
  sourceRef: { nodeId: string; columnId: string } | undefined
): ResolvedValidationSource | null {
  if (!sourceRef?.nodeId || !sourceRef?.columnId) return null

  const sourceNode = store.nodes.find((n) => n.id === sourceRef.nodeId)
  if (!sourceNode || sourceNode.type !== 'schema') return null

  const sourceSchemaData = sourceNode.data as unknown as Record<string, unknown>
  const sourceFilePath = sourceSchemaData.sourceFilePath
  const localPath = sourceSchemaData.localPath

  // 通过 sourcePreviewNode 获取本地文件路径回退
  const sourcePreviewNodeId = sourceSchemaData.sourceNodeId
  const sourcePreviewNode = store.nodes.find((n) => n.id === sourcePreviewNodeId)
  const sourceFileKey =
    (sourcePreviewNode?.type === 'sourcePreview'
      ? ((sourcePreviewNode.data as unknown as Record<string, unknown>)?.localPath as string)
      : undefined) || sourceFilePath

  // 检查是否显式连接了数据源（防止残留路径导致幽灵校验）
  if (!sourceSchemaData.sourceFile || !sourceFileKey) return null

  // 查找列名
  const columns = (sourceSchemaData.columns || []) as Array<{ id: string; columnName: string }>
  const col = columns.find((c) => c.id === sourceRef.columnId)
  if (!col) return null

  // 解析实际文件路径
  const actualFilePath = localPath || sourceFilePath
  if (!actualFilePath || String(actualFilePath) === 'undefined') return null

  return {
    filePath: String(actualFilePath),
    sheetName: sourceSchemaData.sheetName as string | undefined,
    headerRow: sourceSchemaData.headerRow as number | undefined,
    columnName: col.columnName,
    sourceNodeId: sourceRef.nodeId,
    columnId: sourceRef.columnId,
  }
}
