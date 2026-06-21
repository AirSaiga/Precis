/**
 * @file compositeHandler.ts
 * @description 复合约束验证处理器（结果聚合器）
 */

import { defaultReset, register } from '../validationRegistryCore'

function isConstraintNodeType(type: string | undefined): boolean {
  if (!type) return false
  return type.endsWith('Constraint') && type !== 'compositeConstraint'
}

register({
  kind: 'composite',
  validate: async (ctx) => {
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const logic = (nodeData.logic as string) || 'all'

    let targetIds: string[] = (nodeData.includedNodeIds || []) as string[]

    if (targetIds.length === 0) {
      const subGraph = (nodeData.subGraph || {}) as Record<string, unknown>
      const subNodes = (subGraph.nodes || []) as unknown[]
      targetIds = subNodes
        .filter((n) => {
          const nodeLike = n as Record<string, unknown>
          const t = String(nodeLike.type || '')
          return t.endsWith('Constraint') && t !== 'compositeConstraint'
        })
        .map((n) => String((n as Record<string, unknown>).id || ''))
        .filter((id) => id.length > 0)
    }

    if (targetIds.length === 0) {
      return {
        status: 'idle',
        validationErrors: [
          '\u8BF7\u5728\u5C5E\u6027\u9762\u677F\u4E2D\u9009\u62E9\u8981\u805A\u5408\u7684\u7EA6\u675F\u8282\u70B9',
        ],
        lastValidation: undefined,
      }
    }

    const subResults: Array<{
      status: 'idle' | 'pass' | 'error' | 'missing'
      errors: string[]
      lastValidation?: { totalRows: number; errorCount: number; matchCount: number }
    }> = []

    for (const targetId of targetIds) {
      const targetNode = ctx.nodes.find((n) => n.id === targetId)
      if (!targetNode || !isConstraintNodeType(targetNode.type)) continue

      const targetData = (targetNode.data || {}) as Record<string, unknown>
      const status =
        (targetData.validationStatus as 'idle' | 'pass' | 'error' | 'missing') || 'idle'
      const errors = (targetData.validationErrors || []) as string[]
      const lastValidation = targetData.lastValidation as
        | { totalRows: number; errorCount: number; matchCount: number }
        | undefined

      subResults.push({ status, errors, lastValidation })
    }

    if (subResults.length === 0) {
      return {
        status: 'missing',
        validationErrors: [
          '\u672A\u627E\u5230\u6709\u6548\u7684\u805A\u5408\u7EA6\u675F\u8282\u70B9',
        ],
        lastValidation: undefined,
      }
    }

    let finalStatus: 'pass' | 'error' | 'missing' = 'pass'
    const finalErrors: string[] = []
    let totalRows = 0
    let totalErrorCount = 0

    totalRows = Math.max(...subResults.map((s) => s.lastValidation?.totalRows || 0))

    if (logic === 'all') {
      const idleCount = subResults.filter((s) => s.status === 'idle').length
      if (idleCount > 0) {
        finalStatus = 'missing'
        finalErrors.push(
          `\u6709 ${idleCount} \u4E2A\u7EA6\u675F\u5C1A\u672A\u6267\u884C\uFF0C\u8BF7\u5148\u6267\u884C\u4E0A\u6E38\u7EA6\u675F\u6821\u9A8C`
        )
      }
      for (const s of subResults) {
        if (s.status === 'error') {
          finalStatus = 'error'
          finalErrors.push(...s.errors)
          totalErrorCount += s.lastValidation?.errorCount || s.errors.length
        }
      }
      if (finalErrors.length === 0 && finalStatus !== 'missing') {
        finalStatus = 'pass'
      }
    } else if (logic === 'any') {
      const passedCount = subResults.filter(
        (s) => s.status === 'pass' || s.status === 'missing'
      ).length
      const idleCount = subResults.filter((s) => s.status === 'idle').length

      if (idleCount === subResults.length) {
        finalStatus = 'missing'
        finalErrors.push('\u6240\u6709\u7EA6\u675F\u5C1A\u672A\u6267\u884C')
      } else if (passedCount === 0) {
        finalStatus = 'error'
        finalErrors.push(
          `\u590D\u5408\u7EA6\u675F\uFF08logic=any\uFF09\u8981\u6C42\u81F3\u5C11\u4E00\u4E2A\u5B50\u7EA6\u675F\u901A\u8FC7\uFF0C\u4F46\u5168\u90E8 ${subResults.length} \u4E2A\u5B50\u7EA6\u675F\u5747\u5931\u8D25`
        )
        totalErrorCount = subResults.reduce(
          (sum, s) => sum + (s.lastValidation?.errorCount || s.errors.length),
          0
        )
      } else {
        finalStatus = 'pass'
      }
    } else if (logic === 'none') {
      const failedCount = subResults.filter((s) => s.status === 'error').length
      const idleCount = subResults.filter((s) => s.status === 'idle').length

      if (idleCount === subResults.length) {
        finalStatus = 'missing'
        finalErrors.push('\u6240\u6709\u7EA6\u675F\u5C1A\u672A\u6267\u884C')
      } else if (failedCount < subResults.length - idleCount) {
        finalStatus = 'error'
        finalErrors.push(
          `\u590D\u5408\u7EA6\u675F\uFF08logic=none\uFF09\u8981\u6C42\u5168\u90E8\u5B50\u7EA6\u675F\u5931\u8D25\uFF0C\u4F46\u6709 ${subResults.length - failedCount - idleCount} \u4E2A\u5B50\u7EA6\u675F\u901A\u8FC7`
        )
        totalErrorCount = subResults.reduce(
          (sum, s) => sum + (s.lastValidation?.errorCount || s.errors.length),
          0
        )
      } else {
        finalStatus = 'pass'
      }
    }

    return {
      status: finalStatus,
      validationErrors: finalErrors,
      lastValidation: {
        totalRows,
        errorCount: totalErrorCount,
        matchCount: Math.max(0, totalRows - totalErrorCount),
      },
    }
  },
  resetOnDisconnect: (nodeData) => {
    const reset = defaultReset(nodeData)
    return {
      ...reset,
      includedNodeIds: [],
    }
  },
})
