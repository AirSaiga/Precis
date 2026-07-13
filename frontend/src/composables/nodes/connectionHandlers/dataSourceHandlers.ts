/**
 * @file dataSourceHandlers.ts
 * @description 数据源连接处理（E1/E2：ManualData 与 Schema 之间的数据流转）
 *
 * - E1 manualData → schema：ManualData 作为 Schema 数据源，自动建列
 * - E2 schema → manualData：从 Schema 关联的 SourcePreview 提取列数据到 ManualData
 *
 * 这两个分支都通过 tx.patchNodeData 写入数据（事务内）。
 * 类型条件天然互斥，串联执行安全。
 */

import type { CustomNodeData } from '@/types/graph'
import type { ConnectionContext } from './types'

/**
 * 处理数据源连接（E1/E2）
 *
 * 类型条件互斥（E1 是 manualData→schema，E2 是 schema→manualData），串联执行安全。
 * 不匹配任何条件时直接返回（no-op）。
 */
export function handleDataSourceConnection(ctx: ConnectionContext): void {
  const { sourceNode, targetNode, sourceHandle, tx } = ctx

  // E1: manualData → schema（ManualData 作为数据源，自动建列）
  if (sourceNode.type === 'manualData' && targetNode.type === 'schema') {
    const manualData = sourceNode.data as unknown as Record<string, unknown>
    // 重新查找最新 schema 节点（原代码也是 store.nodes.find，读取最新快照）
    const schemaNode = ctx.store.nodes.find((n) => n.id === targetNode.id)
    if (schemaNode) {
      const columnName = (manualData.columnName as string) || 'Column1'
      const existingCols =
        ((schemaNode.data as unknown as Record<string, unknown>).columns as Array<
          Record<string, unknown>
        >) || []
      if (existingCols.length === 0) {
        tx.patchNodeData(targetNode.id, {
          ...schemaNode.data,
          columns: [
            {
              id: 'col-0',
              columnName,
              dataType: 'String',
              validationErrors: [],
              constraints: {},
            },
          ],
          tableName: (manualData.configName as string) || 'ManualData',
          sourceNodeId: sourceNode.id,
        } as unknown as Partial<CustomNodeData>)
      }
    }
    return
  }

  // E2: schema → manualData（从 Schema 关联的 SourcePreview 提取列数据）
  if (sourceNode.type === 'schema' && targetNode.type === 'manualData') {
    extractColumnDataToManualData(ctx, sourceHandle)
    return
  }
}

// ============================================================================
// E2: schema → manualData 列提取
// ============================================================================

/**
 * 从 Schema 关联的 SourcePreview 提取指定列数据，写入 ManualData 节点
 *
 * 提取逻辑：
 * 1. 从 sourceHandle 解析列 ID
 * 2. 查 Schema 的 sourceNodeId 关联的 SourcePreview
 * 3. 从 SourcePreview 的 dataMatrix 按 headerRow 定位列，提取数据行（跳过表头）
 * 4. 无数据时用默认 3 行
 */
function extractColumnDataToManualData(
  ctx: ConnectionContext,
  sourceHandle: string | null | undefined
): void {
  const { sourceNode, targetNode, tx } = ctx
  const schemaData = sourceNode.data as unknown as Record<string, unknown>
  const columns =
    (schemaData.columns as Array<{ id: string; columnName: string; dataType?: string }>) || []

  // 从 sourceHandle 解析列 ID，例如 "source-right-col-0" → "col-0"
  let columnId = ''
  if (sourceHandle && sourceHandle.startsWith('source-right-')) {
    columnId = sourceHandle.replace('source-right-', '')
  }

  const column = columns.find((c) => c.id === columnId)
  const columnName = column?.columnName || 'Column1'
  const columnDataType = column?.dataType

  // 尝试从关联的 SourcePreview 提取该列数据
  let extractedRows: string[][] = []
  const sourceNodeId = schemaData.sourceNodeId as string | undefined
  if (sourceNodeId) {
    extractedRows = extractRowsFromSourcePreview(ctx, sourceNodeId, columnName)
  }

  // 如果没有提取到数据，使用默认行
  if (extractedRows.length === 0) {
    extractedRows = [['value1'], ['value2'], ['value3']]
  }

  tx.patchNodeData(targetNode.id, {
    columnName,
    columnDataType,
    rows: extractedRows,
    configName: columnName,
    saveState: 'draft',
  } as unknown as Partial<CustomNodeData>)
}

/**
 * 从 SourcePreview 节点的 dataMatrix 提取指定列的数据行
 */
function extractRowsFromSourcePreview(
  ctx: ConnectionContext,
  sourcePreviewId: string,
  columnName: string
): string[][] {
  const rows: string[][] = []
  const previewNode = ctx.store.nodes.find((n) => n.id === sourcePreviewId)
  if (!previewNode || previewNode.type !== 'sourcePreview') return rows

  const previewData = previewNode.data as unknown as Record<string, unknown>
  const dataMatrix = (previewData.data as string[][]) || []
  const headerRow = (previewData.headerRow as number) ?? 0

  if (dataMatrix.length > 0 && headerRow >= 0 && headerRow < dataMatrix.length) {
    const headers = dataMatrix[headerRow] ?? []
    const colIndex = headers.indexOf(columnName)
    if (colIndex >= 0) {
      // 提取数据行（跳过表头行）
      for (let i = 0; i < dataMatrix.length; i++) {
        if (i === headerRow) continue
        const row = dataMatrix[i] ?? []
        rows.push([row[colIndex] ?? ''])
      }
    }
  }
  return rows
}
