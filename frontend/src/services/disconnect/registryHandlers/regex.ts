/**
 * Regex 正则节点断开连接处理器（edge-driven）
 *
 * 处理 schema → regex 断开的清理：
 * - 重置 sourceRef 和校验状态
 * - 清理 Schema 列上的 regex 校验错误（当无其他节点引用该列时）
 */
import { registerDisconnectHandler } from '../registryCore'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import type { SchemaColumn } from '@/types/graph'

registerDisconnectHandler({
  priority: 50,
  match: (_edge, _source, target) => target.type === 'regex',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    ctx.updateNodeData(target.id, {
      ...data,
      sourceRef: undefined,
      validationStatus: 'idle',
      errorCount: undefined,
      totalRows: undefined,
      matchCount: undefined,
      lastValidationTime: undefined,
      saveState: 'draft',
    })

    // 列级错误聚合：移除本 regex 节点的错误后，重新计算 schema 列上的 validationErrors
    if ((source?.type === 'schema' || source?.type === 'jsonSchema') && edge.sourceHandle) {
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
        if (node.type === 'regex') {
          const nodeData = (node.data || {}) as Record<string, unknown>
          const sourceRef = nodeData.sourceRef as { nodeId: string; columnId: string } | undefined
          if (sourceRef?.nodeId === source.id && sourceRef?.columnId === columnId) {
            const errorCount = nodeData.errorCount as number | undefined
            if (errorCount) {
              remainingErrors.push(`Regex: ${errorCount} errors`)
            }
          }
        } else if (isConstraintNodeType(node.type)) {
          const nodeData = (node.data || {}) as Record<string, unknown>
          const sourceRef = nodeData.sourceRef as { nodeId: string; columnId: string } | undefined
          if (sourceRef?.nodeId === source.id && sourceRef?.columnId === columnId) {
            const errors = (nodeData.validationErrors as string[]) || []
            remainingErrors.push(...errors)
          }
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
        columns: updatedColumns as unknown as SchemaColumn[],
      })
    }
  },
})
