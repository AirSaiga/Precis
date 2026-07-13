/**
 * @file regexHandlers.ts
 * @description 正则连接处理（E3/E4/E11-E14）
 *
 * - E3 manualData → regex：手动数据作为正则校验数据源
 * - E4 manualData → regexExtract：手动数据作为正则提取数据源
 * - E11 schema/jsonSchema → regexExtract：Schema 列作为正则提取输入
 * - E12 schema/jsonSchema → regex：Schema 列作为正则校验输入（异步，调子 composable）
 * - E13 transformOutput → regexExtract：Transform 输出作为正则提取输入
 * - E14 transformOutput → regex：Transform 输出作为正则校验输入
 *
 * E3/E4/E11/E13/E14 用 tx.patchNodeData；E12 调 regexConnection 子 composable（绕过 tx）。
 */

import { logger } from '@/core/utils/logger'
import type { CustomNodeData } from '@/types/graph'
import type { ConnectionContext } from './types'

/**
 * 处理正则连接（E3/E4/E11-E14）
 *
 * 各分支类型条件互斥，串联执行安全。不匹配时 no-op。
 */
export async function handleRegexConnection(ctx: ConnectionContext): Promise<void> {
  const { sourceNode, targetNode, sourceHandle, connection, tx } = ctx

  // E3: manualData → regex
  if (sourceNode.type === 'manualData' && targetNode.type === 'regex') {
    const manualData = sourceNode.data as unknown as Record<string, unknown>
    const columnName = (manualData.columnName as string) || 'Column1'
    tx.patchNodeData(targetNode.id, {
      sourceRef: { nodeId: connection.source, columnId: '0' },
      configName: `Regex on ${columnName}`,
      saveState: 'draft',
    })
    logger.debug(
      `[ManualData→Regex] 已将 manualData '${sourceNode.id}' 连接到 regex 节点 '${targetNode.id}'`
    )
    return
  }

  // E4: manualData → regexExtract
  if (sourceNode.type === 'manualData' && targetNode.type === 'regexExtract') {
    const manualData = sourceNode.data as unknown as Record<string, unknown>
    const columnName = (manualData.columnName as string) || 'Column1'
    tx.patchNodeData(targetNode.id, {
      sourceRef: { nodeId: connection.source, columnId: '0' },
      configName: `RegexExtract on ${columnName}`,
      saveState: 'draft',
      validationStatus: 'idle',
    })
    logger.debug(
      `[ManualData→RegexExtract] 已将 manualData '${sourceNode.id}' 连接到 regexExtract 节点 '${targetNode.id}'`
    )
    return
  }

  // E11: schema/jsonSchema → regexExtract
  if (
    (sourceNode.type === 'schema' || sourceNode.type === 'jsonSchema') &&
    targetNode.type === 'regexExtract'
  ) {
    if (sourceHandle) {
      const sourceColumnId = sourceHandle.replace('source-right-', '')
      tx.patchNodeData(targetNode.id, {
        sourceRef: { nodeId: connection.source, columnId: sourceColumnId },
        saveState: 'draft',
        validationStatus: 'idle',
      })
    }
    return
  }

  // E12: schema/jsonSchema → regex（异步，调子 composable）
  if (
    (sourceNode.type === 'schema' || sourceNode.type === 'jsonSchema') &&
    targetNode.type === 'regex'
  ) {
    if (sourceHandle) {
      await ctx.regexConnection.handleSchemaToRegexConnection(
        sourceNode.id,
        targetNode.id,
        sourceHandle
      )
    }
    return
  }

  // E13: transformOutput → regexExtract
  if (sourceNode.type === 'transformOutput' && targetNode.type === 'regexExtract') {
    tx.patchNodeData(targetNode.id, {
      inputFromNode: connection.source,
      inputColumn: '0',
      saveState: 'draft',
      validationStatus: 'idle',
    } as unknown as Partial<CustomNodeData>)
    return
  }

  // E14: transformOutput → regex
  if (sourceNode.type === 'transformOutput' && targetNode.type === 'regex') {
    tx.patchNodeData(targetNode.id, {
      sourceRef: { nodeId: connection.source, columnId: '0' },
      saveState: 'draft',
      validationStatus: 'idle',
    })
    return
  }
}
