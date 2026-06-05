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

    if (source?.type === 'schema' && edge.sourceHandle) {
      const columnId = edge.sourceHandle.startsWith('source-right-')
        ? edge.sourceHandle.replace('source-right-', '')
        : null
      if (!columnId) return

      const schemaData = (source.data || {}) as Record<string, unknown>
      const columns = (schemaData.columns || []) as Array<Record<string, unknown>>
      if (columns.length === 0) return

      const remainingErrors: string[] = []
      for (const node of ctx.nodes.value) {
        if (node.id === target.id) continue
        if (!isConstraintNodeType(node.type)) continue
        const nodeData = (node.data || {}) as Record<string, unknown>
        const sourceRef = nodeData.sourceRef as { nodeId: string; columnId: string } | undefined
        if (sourceRef?.nodeId === source.id && sourceRef?.columnId === columnId) {
          const errors = (nodeData.validationErrors as string[]) || []
          remainingErrors.push(...errors)
        }
      }

      const updatedColumns = columns.map((col) => {
        if ((col as Record<string, unknown>).id === columnId) {
          return { ...col, validationErrors: remainingErrors }
        }
        return col
      })
      ctx.updateNodeData(source.id, {
        ...schemaData,
        columns: updatedColumns as any[],
      })
    }
  },
})
