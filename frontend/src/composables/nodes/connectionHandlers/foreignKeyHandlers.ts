/**
 * @file foreignKeyHandlers.ts
 * @description 外键连接处理（E7/E8/E9）
 *
 * - E7 sourcePreview → foreignKeyConstraint：防御性兜底警告（A4 已拦截，此处 no-op warn）
 * - E8 foreignKeyConstraint → schema(target-left)：FK 参照表连接
 * - E9 foreignKeyConstraint → schema(列)：FK 参照列连接
 *
 * E8/E9 调用 foreignKeyConnection 子 composable（内部直接调 store，绕过 tx——现状不改）。
 */

import { logger } from '@/core/utils/logger'
import type { SchemaNodeData } from '@/types/graph'
import type { ConnectionContext } from './types'

/**
 * 处理外键连接（E7/E8/E9）
 *
 * 类型条件互斥，串联执行安全。不匹配时 no-op。
 */
export function handleForeignKeyConnection(ctx: ConnectionContext): void {
  const { sourceNode, targetNode, targetHandle } = ctx

  // E7: sourcePreview → foreignKeyConstraint（防御性兜底 warn，无 return）
  // A4 已在边创建前拦截此连接；此处为事务内兜底（理论上不应触达，保留以防回归）
  if (sourceNode.type === 'sourcePreview' && targetNode.type === 'foreignKeyConstraint') {
    logger.warn('⚠️ 当前外键节点不支持从 SourcePreview 直接建立参照连接')
    return
  }

  // E8: foreignKeyConstraint → schema(target-left)：FK 参照表连接
  if (
    sourceNode.type === 'foreignKeyConstraint' &&
    targetNode.type === 'schema' &&
    targetHandle === 'target-left'
  ) {
    ctx.foreignKeyConnection.handleForeignKeyToSchemaConnection(
      sourceNode.id,
      targetNode.id,
      targetHandle || undefined
    )
    return
  }

  // E9: foreignKeyConstraint → schema(列)：FK 参照列连接
  if (
    sourceNode.type === 'foreignKeyConstraint' &&
    targetNode.type === 'schema' &&
    targetHandle?.startsWith('source-right-')
  ) {
    const targetColumnId = targetHandle.replace('source-right-', '')
    const targetSchemaData = targetNode.data as SchemaNodeData
    const targetColumn = targetSchemaData?.columns?.find((c) => c.id === targetColumnId)

    if (targetColumn) {
      ctx.foreignKeyConnection.handleForeignKeyToSchemaColumnConnection(
        sourceNode.id,
        targetNode.id,
        targetColumnId,
        targetColumn.columnName
      )
    }
    return
  }
}
