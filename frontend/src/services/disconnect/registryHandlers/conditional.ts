/**
 * Conditional 条件约束断开连接处理器
 *
 * 处理 schema → conditionalConstraint 断开的清理：
 * - 若断开的是 IF 输入端，从 ifConditions 列表中移除对应条件，保持首个条件
 * - 若断开的是 THEN 输入端，重置 thenRef/thenColumn
 * - 重置 validationStatus 为 idle
 */
import { registerDisconnectHandler } from '../registryCore'
import type { ConditionalConstraintNodeData } from '@/types/graph'

type IfCondition = NonNullable<ConditionalConstraintNodeData['ifConditions']>[number]

registerDisconnectHandler({
  priority: 50,
  match: (_edge, _source, target) => target.type === 'conditionalConstraint',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    const targetHandle = edge.targetHandle || ''
    const isIf = targetHandle.startsWith(`target-if-${target.id}`)
    const isThen =
      targetHandle === `target-then-${target.id}` || targetHandle === `target-input-${target.id}`

    const parseColumnId = (handle?: string | null) => {
      if (!handle) return undefined
      return handle.startsWith('source-right-') ? handle.replace('source-right-', '') : handle
    }

    if (isIf) {
      const removedColumnId = parseColumnId(edge.sourceHandle)
      const removedNodeId = edge.source

      const baseConditions: IfCondition[] =
        Array.isArray(data.ifConditions) && data.ifConditions.length > 0
          ? (data.ifConditions.slice() as IfCondition[])
          : [
              {
                operator: 'eq',
                value: (data.ifValue as string | undefined) || '',
                column: (data.ifColumn as string | undefined) || '',
                ref: data.ifRef
                  ? ({
                      nodeId: (data.ifRef as { nodeId?: string }).nodeId,
                      columnId: (data.ifRef as { columnId?: string }).columnId,
                    } as IfCondition['ref'])
                  : undefined,
              },
            ]

      const nextConditions = baseConditions.filter((c) => {
        if (c.edgeId && c.edgeId === edge.id) return false
        if (
          removedColumnId &&
          c.ref?.nodeId === removedNodeId &&
          c.ref?.columnId === removedColumnId
        )
          return false
        return true
      })

      const safeConditions: IfCondition[] =
        nextConditions.length > 0 ? nextConditions : [{ operator: 'eq', value: '' }]
      const first = safeConditions[0]

      ctx.updateNodeData(target.id, {
        ...data,
        ifConditions: safeConditions,
        ifLogic: (data.ifLogic as ConditionalConstraintNodeData['ifLogic']) || 'and',
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
