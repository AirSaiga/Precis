import { registerDisconnectHandler } from '../registryCore'
import { isConstraintNodeType, buildDisconnectReset } from '@/services/constraints/validationRegistry'

registerDisconnectHandler({
  priority: 60,
  match: (_edge, _source, target) =>
    isConstraintNodeType(target.type) && target.type !== 'conditionalConstraint',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    const reset: Record<string, unknown> = {
      ...buildDisconnectReset(target.type, data),
      sourceRef: undefined,
      table: target.type === 'scriptedConstraint' ? String(data.table || '') : '',
      column: target.type === 'scriptedConstraint' ? undefined : '',
      saveState: 'draft',
    }
    if (target.type === 'foreignKeyConstraint') {
      reset.sourceTable = undefined
      reset.sourceColumn = undefined
      reset.sourceInfo = undefined
    }
    ctx.updateNodeData(target.id, reset)
  },
})
