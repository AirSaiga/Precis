/**
 * FK 列引用边断开清理（priority 20）
 *
 * 处理 foreignKeyConstraint → schema 的非 fkDisplay 边（手工连线的列引用）。
 * fkDisplay 边（priority 10）会先匹配，此 handler 仅处理非 fkDisplay 的场景。
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 20,
  match: (edge, source, target) => {
    if (!source) return false
    return (
      source.type === 'foreignKeyConstraint' &&
      (target.type === 'schema' || target.type === 'jsonSchema') &&
      !!edge.targetHandle?.startsWith('source-right-')
    )
  },
  cleanup: (edge, source, target, ctx) => {
    if (!source) return
    const fkData = (source.data || {}) as Record<string, unknown>
    const config = (fkData.config || {}) as Record<string, unknown>
    const targetRef = (fkData.targetRef || {}) as Record<string, unknown>

    ctx.updateNodeData(source.id, {
      ...fkData,
      targetColumn: undefined,
      targetRef: {
        nodeId: (targetRef.nodeId as string) || '',
        columnId: undefined,
      },
      config: {
        ruleType: (config.ruleType as 'EXIST_IN' | 'REFERENCE_FROM') || 'EXIST_IN',
        targetColumn: undefined,
      },
      saveState: 'draft',
    })
  },
})
