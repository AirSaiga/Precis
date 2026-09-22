/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @file compositeHandler.ts
 * @description 复合约束验证处理器（结果聚合器）
 */

import { clientNoticeResult, defaultReset, register } from '../validationRegistryCore'
import type { RowLocalizedMessage } from '@/services/i18n/localizedMessage'

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
      return clientNoticeResult(
        'idle',
        'COMPOSITE_NO_SUB_CONSTRAINTS',
        '\u8BF7\u5728\u5C5E\u6027\u9762\u677F\u4E2D\u9009\u62E9\u8981\u805A\u5408\u7684\u7EA6\u675F\u8282\u70B9'
      )
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
        { totalRows: number; errorCount: number; matchCount: number } | undefined

      subResults.push({ status, errors, lastValidation })
    }

    if (subResults.length === 0) {
      return clientNoticeResult(
        'missing',
        'COMPOSITE_NO_VALID_SUB_CONSTRAINTS',
        '\u672A\u627E\u5230\u6709\u6548\u7684\u805A\u5408\u7EA6\u675F\u8282\u70B9'
      )
    }

    let finalStatus: 'pass' | 'error' | 'missing' = 'pass'
    const finalErrors: string[] = []
    // 与 finalErrors 平行的 key 化消息（i18n 治理）；子约束透传的原始错误串无法 key 化，不进此数组
    const finalLocalizedErrors: RowLocalizedMessage[] = []
    let totalRows = 0
    let totalErrorCount = 0

    totalRows = Math.max(...subResults.map((s) => s.lastValidation?.totalRows || 0))

    if (logic === 'all') {
      const idleCount = subResults.filter((s) => s.status === 'idle').length
      if (idleCount > 0) {
        finalStatus = 'missing'
        const idleMsg = `\u6709 ${idleCount} \u4E2A\u7EA6\u675F\u5C1A\u672A\u6267\u884C\uFF0C\u8BF7\u5148\u6267\u884C\u4E0A\u6E38\u7EA6\u675F\u6821\u9A8C`
        finalErrors.push(idleMsg)
        finalLocalizedErrors.push({
          key: 'validation.codes.COMPOSITE_SUB_CONSTRAINTS_IDLE',
          fallback: idleMsg,
          params: { count: idleCount },
        })
      }
      for (const s of subResults) {
        if (s.status === 'error') {
          finalStatus = 'error'
          // 子约束的历史错误串原样透传，无稳定 key，不生成 localizedErrors
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
        const allIdleMsg = '\u6240\u6709\u7EA6\u675F\u5C1A\u672A\u6267\u884C'
        finalErrors.push(allIdleMsg)
        finalLocalizedErrors.push({
          key: 'validation.codes.COMPOSITE_ALL_IDLE',
          fallback: allIdleMsg,
        })
      } else if (passedCount === 0) {
        finalStatus = 'error'
        const anyFailedMsg = `\u590D\u5408\u7EA6\u675F\uFF08logic=any\uFF09\u8981\u6C42\u81F3\u5C11\u4E00\u4E2A\u5B50\u7EA6\u675F\u901A\u8FC7\uFF0C\u4F46\u5168\u90E8 ${subResults.length} \u4E2A\u5B50\u7EA6\u675F\u5747\u5931\u8D25`
        finalErrors.push(anyFailedMsg)
        finalLocalizedErrors.push({
          key: 'validation.codes.COMPOSITE_ANY_ALL_FAILED',
          fallback: anyFailedMsg,
          // 与后端 composite.py 同码同参：COMPOSITE_ANY_ALL_FAILED { total }
          params: { total: subResults.length },
        })
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
        const allIdleMsg = '\u6240\u6709\u7EA6\u675F\u5C1A\u672A\u6267\u884C'
        finalErrors.push(allIdleMsg)
        finalLocalizedErrors.push({
          key: 'validation.codes.COMPOSITE_ALL_IDLE',
          fallback: allIdleMsg,
        })
      } else if (failedCount < subResults.length - idleCount) {
        finalStatus = 'error'
        const nonePassedMsg = `\u590D\u5408\u7EA6\u675F\uFF08logic=none\uFF09\u8981\u6C42\u5168\u90E8\u5B50\u7EA6\u675F\u5931\u8D25\uFF0C\u4F46\u6709 ${subResults.length - failedCount - idleCount} \u4E2A\u5B50\u7EA6\u675F\u901A\u8FC7`
        finalErrors.push(nonePassedMsg)
        finalLocalizedErrors.push({
          // 与后端 composite.py 同码同参：COMPOSITE_NONE_HAS_PASSED { passed }
          key: 'validation.codes.COMPOSITE_NONE_HAS_PASSED',
          fallback: nonePassedMsg,
          params: { passed: subResults.length - failedCount - idleCount },
        })
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
      localizedErrors: finalLocalizedErrors,
      lastValidation: {
        totalRows,
        errorCount: totalErrorCount,
        matchCount: Math.max(0, totalRows - totalErrorCount),
      },
    }
  },
  resetOnDisconnect: (nodeData) => {
    // 断连/防御性重置只清校验状态——includedNodeIds 是用户勾选的聚合成员配置，
    // 与其余 9 种约束的 reset 语义保持一致，不得随校验状态一起清空
    // （Schema 未连数据源时每次全表校验都会触发本 reset，清空会周期性销毁用户勾选）
    return defaultReset(nodeData)
  },
})
