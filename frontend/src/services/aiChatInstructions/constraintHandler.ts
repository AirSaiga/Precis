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
 * @fileoverview 约束指令 handler：按 isInline 分流内嵌约束（改列定义）与
 * 独立约束节点（建节点+连线），并镜像后端的删除动作到画布。
 */

import { logger } from '@/core/utils/logger'
import { toastError, toastSuccess } from '@/core/toast'
import { type Node as VueFlowNode } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import { nextTick } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { i18n } from '@/i18n'
import type { FrontendInstruction } from '@/stores/aiChatStore'
import type { CustomNodeData } from '@/types/graph'
import * as vueFlowApi from '@/services/canvas/vueFlowApi'
import { NODE_ENTERING_CLASS } from '@/services/canvas/animationDurations'
import { attachEnteringClass, debouncedFitView, guardCanvasOp } from './canvasOps'
import { AIInstructionError } from './errors'
import {
  addValidatedAIConnection,
  CONSTRAINT_TYPE_MAP,
  resolveColumnId,
  resolveTargetNode,
} from './connectionOps'

/**
 * 处理约束指令
 *
 * 根据 constraintSpec 中的 isInline 决定：
 * - 内嵌约束：修改目标节点的列定义
 * - 独立约束：在目标节点右侧创建约束节点并连线
 */
export async function handleConstraintInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const { constraintSpec } = instruction
  const { type, targetNodeId, tableName, targetColumn, constraintId, isInline } = constraintSpec

  // 解析目标节点：targetNodeId 精确匹配失败时，用 tableName 多策略兜底
  // 这是应对"AI 二手观察画布 + 后端双出口同步鸿沟"的最后一道防线
  const targetNode = resolveTargetNode(graphStore.nodes, targetNodeId, tableName)

  if (!targetNode) {
    logger.warn(`[AI Chat] 目标节点不存在: targetNodeId=${targetNodeId}, tableName=${tableName}`)
    toastError(t('aiChat.targetNodeNotFound'))
    return
  }

  // DELETE 分支：约束文件已由后端删除，此处镜像到画布
  if (instruction.actionType === 'DELETE_CONSTRAINT_NODE') {
    if (isInline) {
      // 内联删除：从目标列移除该约束（handleInlineConstraint 的逆操作）
      removeInlineConstraint(targetNode, type, targetColumn)
    } else {
      // 独立删除：按 (约束节点类型, table, column) 三元组定位节点
      // 独立约束节点 id 是前端 uuidv4()，与后端 constraintId 无关，故不能按 id 删
      const constraintKind = CONSTRAINT_TYPE_MAP[type]
      if (constraintKind) {
        const nodeType = `${constraintKind}Constraint`
        const toRemove = graphStore.nodes.filter((n) => {
          if (n.type !== nodeType) return false
          const d = n.data as Record<string, unknown>
          return d.table === tableName && d.column === targetColumn
        })
        if (toRemove.length > 0) {
          guardCanvasOp(() => vueFlowApi.removeNodes(toRemove.map((n) => n.id)))
          await nextTick()
          graphStore.reconcileAll()
          toastSuccess(t('aiChat.constraintDeleted', { table: tableName, column: targetColumn }))
        } else {
          logger.info(
            `[AI Chat] 画布上未找到匹配的约束节点: ${type} on ${tableName}.${targetColumn}`
          )
        }
      }
    }
    return
  }

  if (isInline) {
    handleInlineConstraint(targetNode, type, targetColumn, constraintId)
    toastSuccess(t('aiChat.inlineConstraintCreated', { table: tableName, column: targetColumn }))
    return
  }

  const constraintKind = CONSTRAINT_TYPE_MAP[type]
  if (!constraintKind) {
    logger.warn(`[AI Chat] 未知的约束类型: ${type}`)
    toastError(t('aiChat.unsupportedConstraintType', { type }))
    return
  }

  const nodePosition = {
    x: targetNode.position.x + 350,
    y: targetNode.position.y,
  }

  const constraintNodeId = uuidv4()
  const constraintNode: VueFlowNode = {
    id: constraintNodeId,
    type: `${constraintKind}Constraint`,
    position: nodePosition,
    // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
    class: NODE_ENTERING_CLASS,
    data: {
      configName: `${constraintId}`,
      table: tableName,
      column: targetColumn,
      constraintName: constraintId,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
      sourceRef: undefined,
    },
  }

  guardCanvasOp(() => vueFlowApi.addNodes(constraintNode))

  await nextTick()

  const columnId = constraintSpec.targetColumnId || resolveColumnId(targetNode, targetColumn)
  if (!columnId) {
    logger.warn(`[AI Chat] 无法解析目标列: ${targetColumn}`)
    toastError(t('aiChat.columnNotFound', { column: targetColumn }))
    return
  }

  try {
    addValidatedAIConnection({
      sourceNode: targetNode,
      sourceColumnId: columnId,
      targetNode: constraintNode,
      edges: graphStore.edges,
    })
  } catch (error) {
    if (error instanceof AIInstructionError) {
      logger.error(error.message)
      toastError(error.message)
    } else {
      throw error
    }
  }

  await nextTick()

  graphStore.reconcileAll()

  attachEnteringClass(constraintNodeId)
  debouncedFitView([constraintNodeId])

  toastSuccess(t('aiChat.constraintCreated', { table: tableName, column: targetColumn }))
}

/**
 * 处理内嵌约束指令
 *
 * 将约束直接附加到目标节点的列定义上，不创建独立节点和连线。
 * 约束数据存储在 column.constraints 字典中，键为约束类型小写，值为 { id, enabled }。
 */
function handleInlineConstraint(
  targetNode: VueFlowNode,
  constraintType: string,
  columnName: string,
  constraintId: string
) {
  const graphStore = useGraphStore()
  const { t } = i18n.global

  const nodeData = targetNode.data as unknown as Record<string, unknown>
  if (!nodeData.columns) {
    logger.warn(`[AI Chat] 目标节点没有 columns 数组`)
    return
  }

  // 预检目标列是否存在（不存在则提示，避免静默失败）
  const columnExists = (nodeData.columns as unknown[]).some(
    (c) => (c as Record<string, unknown>).columnName === columnName
  )
  if (!columnExists) {
    logger.warn(`[AI Chat] 目标节点没有列: ${columnName}`)
    toastError(t('aiChat.columnNotFound', { column: columnName }))
    return
  }

  // 构造更新后的 columns 数组（不可变更新，避免直接修改响应式 proxy）
  const constraintKey = constraintType.toLowerCase()
  const updatedColumns = (nodeData.columns as unknown[]).map((c) => {
    const col = c as Record<string, unknown>
    if (col.columnName !== columnName) return col
    // 命中目标列，添加约束
    const existingConstraints = (col.constraints as Record<string, unknown>) || {}
    return {
      ...col,
      constraints: {
        ...existingConstraints,
        [constraintKey]: { id: constraintId, enabled: true },
      },
    }
  })

  // 通过 updateNodeData 统一入口更新（触发 Vue 响应式 + VueFlow 同步）
  // 不直接操作 graphStore.nodes 数组下标，遵循 DAG 操作规范
  graphStore.updateNodeData(targetNode.id, {
    columns: updatedColumns,
  } as Partial<CustomNodeData>)
}

/**
 * 移除内嵌约束（handleInlineConstraint 的逆操作）
 *
 * 从目标列的 constraints 字典中删除指定类型的约束。
 */
function removeInlineConstraint(
  targetNode: VueFlowNode,
  constraintType: string,
  columnName: string
) {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const nodeData = targetNode.data as unknown as Record<string, unknown>
  if (!nodeData.columns) {
    logger.warn(`[AI Chat] 目标节点没有 columns 数组`)
    return
  }

  const constraintKey = constraintType.toLowerCase()
  let removed = false
  const updatedColumns = (nodeData.columns as unknown[]).map((c) => {
    const col = c as Record<string, unknown>
    if (col.columnName !== columnName) return col
    const existingConstraints = (col.constraints as Record<string, unknown>) || {}
    if (!(constraintKey in existingConstraints)) return col
    removed = true
    const next = { ...existingConstraints }
    delete next[constraintKey]
    return { ...col, constraints: next }
  })

  if (!removed) {
    logger.info(`[AI Chat] 内联约束不存在，无需删除: ${constraintType} on ${columnName}`)
    return
  }

  graphStore.updateNodeData(targetNode.id, {
    columns: updatedColumns,
  } as Partial<CustomNodeData>)
  toastSuccess(t('aiChat.inlineConstraintDeleted', { column: columnName }))
}
