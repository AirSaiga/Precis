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
 * @file validateNode.ts
 * @description 一键校验当前选中 Schema 节点处理器
 *
 * 核心约束：本函数在全局键盘事件监听器中执行，**不在 Vue setup 上下文中**。
 * 因此严禁调用 useVueFlow()、useI18n() 等 setup-only 的 composable。
 * 只允许使用：Pinia Store、模块级纯函数、全局状态工具。
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { validateAllConstraints } from '@/services/constraints/orchestration/globalValidation'
import type { SchemaNodeData } from '@/types/graph'

export interface ValidationResultSummary {
  total: number
  valid: number
  invalid: number
  errors: number
  /** 未实际执行（idle/missing：缺数据源等）的约束数 */
  skipped: number
}

export async function validateSelectedNode(): Promise<{
  success: boolean
  message?: string
  summary?: ValidationResultSummary
}> {
  const graphStore = useGraphStore()

  // ---- 前置检查 ----
  if (!graphStore.selectedNodeId) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  const selectedNode = graphStore.nodes.find((n) => n.id === graphStore.selectedNodeId)
  if (!selectedNode || selectedNode.type !== 'schema') {
    return { success: false, message: 'shortcuts.feedback.schemaOnly' }
  }

  const schemaData = selectedNode.data as SchemaNodeData
  if (!schemaData.columns || schemaData.columns.length === 0) {
    return { success: false, message: 'shortcuts.feedback.noColumnsToValidate' }
  }

  logger.debug(`[validateNode] 开始校验节点: ${selectedNode.id}`)

  // ---- 执行全表校验 ----
  try {
    const result = await validateAllConstraints(
      selectedNode.id,
      graphStore.nodes,
      graphStore.edges,
      (nodeId: string, data: Record<string, unknown>) => graphStore.updateNodeData(nodeId, data)
    )

    const {
      totalConstraints,
      validConstraints,
      invalidConstraints,
      totalErrors,
      skippedConstraints,
    } = result
    const summary: ValidationResultSummary = {
      total: totalConstraints,
      valid: validConstraints,
      invalid: invalidConstraints,
      errors: totalErrors,
      skipped: skippedConstraints,
    }

    if (totalConstraints === 0) {
      return {
        success: true,
        message: 'shortcuts.feedback.validationNoConstraints',
        summary,
      }
    }

    // 误报红线：idle/missing 约束不算通过。全部未执行（无数据源等）时
    // 不得报"校验全部通过"，改用中性提示告知用户校验没有发生
    if (validConstraints + invalidConstraints === 0) {
      return {
        success: true,
        message: 'shortcuts.feedback.validationNotExecuted',
        summary,
      }
    }

    // 有任何约束被跳过时不报"全部通过"，落入通用"校验完成"
    const messageKey =
      invalidConstraints === 0 && skippedConstraints === 0
        ? 'shortcuts.feedback.validationAllPassed'
        : 'shortcuts.feedback.validationCompleted'

    logger.debug(
      `[validateNode] 校验完成: ${validConstraints}/${totalConstraints} 通过, ${totalErrors} 个错误`
    )

    return { success: true, message: messageKey, summary }
  } catch (error) {
    logger.error('[validateNode] 校验失败:', error)
    return { success: false, message: 'shortcuts.feedback.validationFailed' }
  }
}
