import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 70,
  match: (_edge, _source, target) => target.type === 'transformOutput',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    ctx.updateNodeData(target.id, {
      ...data,
      parentTransformId: undefined,
      saveState: 'draft',
    })

    // 清理 Transform 源节点的 outputNodeIds
    if (source && source.type === 'transform') {
      const sourceData = (source.data || {}) as Record<string, unknown>
      const outputNodeIds = (sourceData.outputNodeIds || []) as string[]
      const nextIds = outputNodeIds.filter((id) => id !== target.id)
      if (nextIds.length !== outputNodeIds.length) {
        ctx.updateNodeData(source.id, {
          ...sourceData,
          outputNodeIds: nextIds,
          saveState: 'draft',
        })
      }
    }
  },
})
