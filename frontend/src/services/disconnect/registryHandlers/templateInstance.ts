import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 70,
  match: (_edge, _source, target) => target.type === 'templateInstance',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    ctx.updateNodeData(target.id, {
      ...data,
      inputFromNode: undefined,
      saveState: 'draft',
    })
  },
})
