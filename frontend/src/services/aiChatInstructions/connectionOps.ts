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
 * @fileoverview AI 指令连接解析工具：列 ID / 目标 handle 解析、经连接规则验证的
 * 建边、目标节点多策略兜底匹配、约束类型大写下划线到 camelCase 的映射表。
 */

import { logger } from '@/core/utils/logger'
import { type Edge, type Node as VueFlowNode } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import { useConnectionValidator } from '@/composables/validation/useConnectionValidator'
import * as vueFlowApi from '@/services/canvas/vueFlowApi'
import { guardCanvasOp } from './canvasOps'
import { AIInstructionError } from './errors'

export interface AINodeConnectionInput {
  sourceNode: VueFlowNode
  sourceColumnId?: string
  targetNode: VueFlowNode
  edges: Edge[]
}

/**
 * 从 Schema/JsonSchema 节点中解析列 ID
 *
 * 优先使用 AI 直接提供的 targetColumnId；若未提供，则按 columnName 在 columns 中查找。
 * 无法解析时返回 undefined，避免用不存在的列名创建非法连接。
 */
export function resolveColumnId(node: VueFlowNode, columnNameOrId?: string): string | undefined {
  if (!columnNameOrId) return undefined

  const data = node.data as Record<string, unknown>
  const columns = data.columns as Array<{ id?: string; columnName?: string }> | undefined
  if (!columns || columns.length === 0) return undefined

  const byId = columns.find((c) => c.id === columnNameOrId)
  if (byId?.id) return byId.id

  const byName = columns.find((c) => c.columnName === columnNameOrId)
  if (byName?.id) return byName.id

  return undefined
}

/**
 * 根据目标节点类型解析目标 handle ID
 *
 * 与 connectionRules.ts 中的规则保持一致：
 * - Regex / Transform 使用固定输入 handle
 * - Schema/JsonSchema/ManualData/TransformOutput 使用 target-left
 * - CompositeConstraint 使用 target-left
 * - 其他约束节点使用 target-input-{nodeId}
 * - TemplateInstance 无输入 handle 且 connectionRules 无对应规则，落入 default 返回 undefined
 */
export function resolveTargetHandle(targetNode: VueFlowNode): string | undefined {
  switch (targetNode.type) {
    case 'regex':
      return 'regex-input'
    case 'transform':
      return 'transform-input'
    case 'schema':
    case 'jsonSchema':
    case 'manualData':
    case 'transformOutput':
      return 'target-left'
    case 'compositeConstraint':
      return 'target-left'
    default:
      if (targetNode.type?.endsWith('Constraint')) {
        return `target-input-${targetNode.id}`
      }
      return undefined
  }
}

/**
 * 创建 AI 生成的边，并在加入画布前通过连接规则验证
 *
 * 若验证失败，抛出 AIInstructionError，且不向 edges 添加非法边。
 */
export function addValidatedAIConnection(input: AINodeConnectionInput): Edge {
  const { sourceNode, sourceColumnId, targetNode, edges } = input
  // §3.13: 建边前强制 resolveColumnId 同款校验——陈旧/幻觉的列 ID 会拼出不存在的
  // source handle（边挂空、画布坏边、后续校验/保存才报错）。spec 直传的原始
  // targetColumnId 未经解析，在此统一拦截（不存在则拒绝该指令并按 AIInstructionError 上报）。
  // 仅对带列结构的源节点（schema 类）校验——manualData 等无 columns 的源不适用
  const sourceHasColumns = Array.isArray(
    (sourceNode.data as Record<string, unknown> | undefined)?.columns
  )
  if (sourceHasColumns && sourceColumnId && !resolveColumnId(sourceNode, sourceColumnId)) {
    throw new AIInstructionError(
      `[AI Chat] 目标列不存在: ${sourceColumnId}（节点 ${sourceNode.id}）`,
      'COLUMN_NOT_FOUND'
    )
  }
  const sourceHandle = sourceColumnId ? `source-right-${sourceColumnId}` : undefined
  const targetHandle = resolveTargetHandle(targetNode)

  const { validateConnection } = useConnectionValidator({ existingConnections: edges })
  const result = validateConnection(sourceNode, sourceHandle, targetNode, targetHandle)

  if (!result.isValid) {
    throw new AIInstructionError(
      `[AI Chat] 连接验证失败: ${result.message || result.errorCode}`,
      result.errorCode || 'CONNECTION_VALIDATION_FAILED'
    )
  }

  const edge: Edge = {
    id: uuidv4(),
    source: sourceNode.id,
    target: targetNode.id,
    sourceHandle,
    targetHandle,
  }

  // 画布未就绪（模式切换窗口期）时静默跳过，不抛错污染调用方
  guardCanvasOp(() => vueFlowApi.addEdges(edge))
  return edge
}

/**
 * AI 返回的约束类型到前端 ConstraintKind 的映射表
 *
 * 由 codegen 从后端 registry（CONSTRAINT_TYPES + CONSTRAINT_TYPE_ALIASES）生成，
 * 单一事实源在后端；key 同时含 PascalCase 正名与大写下划线别名（LLM 两种写法都可能回），
 * value 为 camelCase 的 ConstraintKind（如 notNull）。
 */
export { CONSTRAINT_TYPE_MAP } from '@/types/generated/actions'

/**
 * 解析约束指令的目标节点（前端兜底）
 *
 * 优先级：
 * 1. targetNodeId 精确匹配（后端解析出的确定性 ID）
 * 2. tableName 匹配节点的 data.tableName / data.configName / id
 * 3. tableName 大小写不敏感包含匹配（宽松兜底）
 *
 * 应对"AI 二手观察画布 + 后端双出口"同步鸿沟的最后一道防线：
 * 即使后端解析的 ID 与画布真实节点 ID 不同步（如未保存的新建节点、
 * 多轮对话间画布状态变化），前端仍能用 tableName 找到正确节点。
 */
export function resolveTargetNode(
  nodes: VueFlowNode[],
  targetNodeId: string,
  tableName?: string
): VueFlowNode | undefined {
  // 策略 1：精确 ID 匹配
  if (targetNodeId) {
    const exact = nodes.find((n) => n.id === targetNodeId)
    if (exact) return exact
  }

  // 无 tableName 则无法兜底
  if (!tableName) return undefined
  const query = tableName.toLowerCase()

  // 策略 2：tableName 精确匹配节点的 tableName / configName / id
  const byTableField = nodes.find((n) => {
    const data = n.data as Record<string, unknown>
    const candidates = [data.tableName, data.configName, n.id]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.toLowerCase())
    return candidates.includes(query)
  })
  if (byTableField) {
    logger.info(
      `[AI Chat] targetNodeId=${targetNodeId} 未命中，用 tableName=${tableName} 兜底匹配到节点 ${byTableField.id}`
    )
    return byTableField
  }

  // 策略 3：tableName 包含匹配（处理 "Orders Table" vs "orders" 等命名差异）
  // 收紧原则：宁可漏匹配（最终返回 undefined 让上层报"节点未找到"），
  // 也不要错匹配——错匹配会把约束加到错误的表上，后果比"没匹配到"严重得多。
  // - 只保留"节点名包含 query"方向（query 来自 AI，通常较完整），
  //   去掉危险的"query 包含节点名"方向（节点名仅 "a" 时会匹配所有含 a 的表）。
  // - 要求 query 至少 3 字符，避免 "a"/"or" 这类过短词误命中大量表。
  const MIN_FUZZY_LEN = 3
  const byContain =
    query.length >= MIN_FUZZY_LEN
      ? nodes.find((n) => {
          const data = n.data as Record<string, unknown>
          const candidates = [data.tableName, data.configName]
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.toLowerCase())
          // 仅节点名包含 query；且节点名本身也要够长，否则短名噪声大
          return candidates.some((v) => v.length >= MIN_FUZZY_LEN && v.includes(query))
        })
      : undefined
  if (byContain) {
    logger.info(
      `[AI Chat] targetNodeId=${targetNodeId} 未命中，用 tableName=${tableName} 包含匹配到节点 ${byContain.id}`
    )
    return byContain
  }

  return undefined
}
