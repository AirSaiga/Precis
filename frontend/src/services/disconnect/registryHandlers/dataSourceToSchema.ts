import { registerDisconnectHandler } from '../registryCore'
import type { DisconnectContext } from '../types'
import { isConstraintNodeType, buildDisconnectReset } from '@/services/constraints/validationRegistry'

/**
 * 重置 Schema 节点的数据源元数据字段
 */
function resetSchemaSourceMetadata(schemaNodeId: string, ctx: DisconnectContext) {
  const node = ctx.nodes.value.find((n) => n.id === schemaNodeId)
  if (!node || (node.type !== 'schema' && node.type !== 'jsonSchema')) return
  const data = (node.data || {}) as Record<string, unknown>
  const reset: Record<string, unknown> = {
    ...data,
    sourceNodeId: undefined,
    sourceFile: undefined,
    sourceFilePath: undefined,
    sourceType: undefined,
    headerRow: undefined,
    sheetName: undefined,
    sourceMode: undefined,
    localPath: undefined,
    sourcePathMode: undefined,
    saveState: 'draft',
  }
  if (node.type === 'jsonSchema') {
    reset.jsonPath = undefined
    reset.recordPath = undefined
    reset.format = undefined
  }
  ctx.updateNodeData(schemaNodeId, reset)
}

/**
 * 重置 Schema 下游所有约束节点的校验状态（不重置 sourceRef/table/column 等结构映射）
 */
function resetDownstreamValidationStatus(schemaNodeId: string, ctx: DisconnectContext) {
  const schemaEdges = ctx.edges.value.filter((e) => e.source === schemaNodeId)
  for (const ce of schemaEdges) {
    const constraintNode = ctx.nodes.value.find((n) => n.id === ce.target)
    if (!constraintNode || !isConstraintNodeType(constraintNode.type)) continue
    const data = (constraintNode.data || {}) as unknown as Record<string, unknown>
    ctx.updateNodeData(constraintNode.id, {
      ...buildDisconnectReset(constraintNode.type, data),
    })
  }
}

registerDisconnectHandler({
  priority: 10,
  match: (edge, source, target) => {
    if (target.type !== 'schema' && target.type !== 'jsonSchema') return false
    if (edge.targetHandle !== 'target-left' && edge.targetHandle !== undefined) return false
    if (source) {
      return ['sourcePreview', 'jsonSourcePreview', 'manualData'].includes(source.type || '')
    }
    // source 节点已删除时，仅根据 targetHandle 和 target 类型匹配
    return true
  },
  cleanup: (edge, source, target, ctx) => {
    ctx.clearAllValidationErrors(target.id)
    resetSchemaSourceMetadata(target.id, ctx)
    resetDownstreamValidationStatus(target.id, ctx)
  },
})
