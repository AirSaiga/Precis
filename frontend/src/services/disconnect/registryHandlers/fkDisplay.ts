/**
 * FK 展示边断开清理（priority 10）
 *
 * 处理 edge.data.kind === 'fkDisplay' 的边（FK 节点 → 目标 Schema）。
 * 由于 find() 是 first-match，priority 10 确保 fkDisplay 边优先于
 * fkColumn（priority 20）匹配，避免两者重叠时重复清理。
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 10,
  match: (edge) => edge.data?.kind === 'fkDisplay' && !!edge.data?.fkNodeId,
  cleanup: (edge, source, target, ctx) => {
    const fkNode = ctx.nodes.value.find((n) => n.id === edge.data.fkNodeId)
    if (!fkNode) return
    
    const fkData = (fkNode.data || {}) as Record<string, unknown>
    const config = (fkData.config || {}) as Record<string, unknown>
    
    ctx.updateNodeData(fkNode.id, {
      ...fkData,
      targetTable: undefined,
      targetRef: undefined,
      targetColumn: undefined,
      config: {
        ...config,
        ruleType: (config.ruleType as 'EXIST_IN' | 'REFERENCE_FROM') || 'EXIST_IN',
        targetNodeId: undefined,
        targetColumn: undefined,
      },
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
      saveState: 'draft',
    })
  },
})
