import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 50,
  match: (_edge, _source, target) => target.type === 'conditionalConstraint',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    const targetHandle = edge.targetHandle || ''
    const isIf = targetHandle.startsWith(`target-if-${target.id}`)
    const isThen =
      targetHandle === `target-then-${target.id}` ||
      targetHandle === `target-input-${target.id}`

    const parseColumnId = (handle?: string | null) => {
      if (!handle) return undefined
      return handle.startsWith('source-right-') ? handle.replace('source-right-', '') : handle
    }

    if (isIf) {
      const removedColumnId = parseColumnId(edge.sourceHandle)
      const removedNodeId = edge.source

      const baseConditions =
        Array.isArray(data.ifConditions) && data.ifConditions.length > 0
          ? data.ifConditions.slice()
          : [
              {
                operator: 'eq' as const,
                value: data.ifValue || '',
                column: data.ifColumn || '',
                ref: data.ifRef
                  ? { nodeId: (data.ifRef as any).nodeId, columnId: (data.ifRef as any).columnId }
                  : undefined,
              },
            ]

      const nextConditions = baseConditions.filter((c: any) => {
        if (c.edgeId && c.edgeId === edge.id) return false
        if (
          removedColumnId &&
          c.ref?.nodeId === removedNodeId &&
          c.ref?.columnId === removedColumnId
        )
          return false
        return true
      })

      const safeConditions =
        nextConditions.length > 0 ? nextConditions : [{ operator: 'eq' as const, value: '' }]
      const first = safeConditions[0]

      ctx.updateNodeData(target.id, {
        ...data,
        ifConditions: safeConditions,
        ifLogic: (data.ifLogic as any) || 'and',
        ifRef: first?.ref,
        ifColumn: first?.column || '',
        ifValue: typeof first?.value === 'string' ? first.value : '',
        validationStatus: 'idle',
        validationErrors: [],
        lastValidation: undefined,
      })
      return
    }

    if (isThen) {
      ctx.updateNodeData(target.id, {
        ...data,
        thenRef: undefined,
        thenColumn: '',
        validationStatus: 'idle',
        validationErrors: [],
        lastValidation: undefined,
      })
    }
  },
})
