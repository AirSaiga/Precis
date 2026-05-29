/**
 * @file tryInlineValidation.ts
 * @description 内联数据源校验的统一入口
 *
 * 功能概述:
 * - 判断约束节点的源节点是否为 manualData / transformOutput
 * - 如果是，调用 validateForInlineSource 执行行内校验
 * - 被所有约束类型（7种）共享使用，避免重复代码
 *
 * 使用方式:
 *   const handled = await tryInlineValidation(store, sourceRef, constraintNodeId)
 *   if (handled) return emptyResult
 */

import type { useGraphStore } from '@/stores/graphStore'
import { validateForInlineSource } from '@/services/constraints/validationRegistryCore'

export async function tryInlineValidation(
  store: ReturnType<typeof useGraphStore>,
  sourceRef: { nodeId: string; columnId: string } | undefined,
  constraintNodeId: string
): Promise<boolean> {
  if (!sourceRef?.nodeId) return false

  const sourceNode = store.nodes.find((n) => n.id === sourceRef.nodeId)
  if (!sourceNode) return false
  if (sourceNode.type !== 'manualData' && sourceNode.type !== 'transformOutput') return false

  const constraintNode = store.nodes.find((n) => n.id === constraintNodeId)
  if (!constraintNode) return false

  await validateForInlineSource({
    sourceNodeId: sourceRef.nodeId,
    constraintNode,
    nodes: store.nodes,
    updateNodeData: store.updateNodeData,
  })
  return true
}
