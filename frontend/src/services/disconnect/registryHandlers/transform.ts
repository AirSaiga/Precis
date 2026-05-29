import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 70,
  match: (_edge, _source, target) => target.type === 'transform',
  cleanup: (edge, source, target, ctx) => {
    ctx.updateNodeData(target.id, {
      inputFromNode: undefined,
      inputColumn: undefined,
      saveState: 'draft',
    })
  },
})
