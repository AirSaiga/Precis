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
 * 独立约束节点（建节点+连线），并镜像后端的更新/删除动作到画布。
 *
 * 类型契约：后端指令生成器已把 constraintSpec.type 标准化为 PascalCase 正名
 * （LLM 也可能直接回大写下划线），CONSTRAINT_TYPE_MAP（codegen 生成）两种键都收。
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
import { buildConstraintParamsData } from './constraintNodeData'
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
 * - 内嵌约束：修改目标节点的列定义（键为 camelCase ConstraintKind，
 *   NotNull/Unique 存布尔 true、AllowedValues 存值数组，与手动连接/
 *   Inspector 写入的契约一致）
 * - 独立约束：创建/更新约束节点并连线，params 须落进节点 data
 *   （否则保存链路会用空 params 覆盖后端已写入的参数）
 */
export async function handleConstraintInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const { constraintSpec } = instruction
  const { type, targetNodeId, tableName, targetColumn, constraintId, isInline, params } =
    constraintSpec

  // 解析目标节点：targetNodeId 精确匹配失败时，用 tableName 多策略兜底
  // 这是应对"AI 二手观察画布 + 后端双出口同步鸿沟"的最后一道防线
  const targetNode = resolveTargetNode(graphStore.nodes, targetNodeId, tableName)

  if (!targetNode) {
    logger.warn(`[AI Chat] 目标节点不存在: targetNodeId=${targetNodeId}, tableName=${tableName}`)
    toastError(t('aiChat.targetNodeNotFound'))
    return
  }

  // 约束类型解析（PascalCase 正名与大写下划线别名均可）：
  // 内联键、独立节点 type、按三元组定位删除/更新全都依赖它，故提前统一拦截未知类型
  const constraintKind = CONSTRAINT_TYPE_MAP[type]
  if (!constraintKind) {
    logger.warn(`[AI Chat] 未知的约束类型: ${type}`)
    toastError(t('aiChat.unsupportedConstraintType', { type }))
    return
  }

  const nodeType = `${constraintKind}Constraint`

  // §2.2: UPDATE/DELETE 匹配收窄——同列双同类型约束时三元组过滤会一起改/一起删。
  // constraintId 经指令透传写入节点 configName（52662373 契约），优先按它精确命中。
  const dataOf = (n: VueFlowNode) => n.data as Record<string, unknown>
  const findByConstraintId = (): VueFlowNode | null => {
    if (!constraintId) return null
    return (
      graphStore.nodes.find(
        (n) =>
          n.type === nodeType &&
          (dataOf(n).configName === constraintId || dataOf(n).constraintName === constraintId)
      ) ?? null
    )
  }
  const findByTriple = (): VueFlowNode[] =>
    graphStore.nodes.filter(
      (n) =>
        n.type === nodeType && dataOf(n).table === tableName && dataOf(n).column === targetColumn
    )

  // DELETE 分支：约束文件已由后端删除，此处镜像到画布
  if (instruction.actionType === 'DELETE_CONSTRAINT_NODE') {
    if (isInline) {
      // 内联删除：从目标列移除该约束（handleInlineConstraint 的逆操作）
      removeInlineConstraint(targetNode, constraintKind, targetColumn)
    } else {
      // 独立删除：constraintId 精确命中优先；回退三元组（多匹配时提示不动作，§2.2）
      const exact = findByConstraintId()
      let toRemove: VueFlowNode[]
      if (exact) {
        toRemove = [exact]
      } else {
        const triple = findByTriple()
        if (triple.length > 1) {
          toastError(
            t('aiChat.constraintAmbiguous', {
              table: tableName,
              column: targetColumn,
              count: triple.length,
            })
          )
          return
        }
        toRemove = triple
      }
      if (toRemove.length > 0) {
        guardCanvasOp(() => vueFlowApi.removeNodes(toRemove.map((n) => n.id)))
        await nextTick()
        graphStore.reconcileAll()
        toastSuccess(t('aiChat.constraintDeleted', { table: tableName, column: targetColumn }))
      } else {
        logger.info(`[AI Chat] 画布上未找到匹配的约束节点: ${type} on ${tableName}.${targetColumn}`)
      }
    }
    return
  }

  if (isInline) {
    // ADD/UPDATE 对内联语义相同：都是幂等写入列约束定义
    handleInlineConstraint(targetNode, constraintKind, targetColumn, params ?? {})
    return
  }

  // UPDATE 分支（独立约束）：constraintId 精确命中优先，回退三元组定位已有节点并刷新
  // data，而不是再建一个副本（旧实现的漂移：同一约束在画布上出现两个节点）
  if (instruction.actionType === 'UPDATE_CONSTRAINT_NODE') {
    const exact = findByConstraintId()
    let matched: VueFlowNode[]
    if (exact) {
      matched = [exact]
    } else {
      matched = findByTriple()
      if (matched.length > 1) {
        // §2.2: 多候选不再静默全改——提示用户提供 constraintId
        toastError(
          t('aiChat.constraintAmbiguous', {
            table: tableName,
            column: targetColumn,
            count: matched.length,
          })
        )
        return
      }
    }
    if (matched.length > 0) {
      const patches = {
        ...buildConstraintParamsData(constraintKind, params ?? {}),
        constraintName: constraintId,
        configName: `${constraintId}`,
        // 参数已变更，上一次校验结果失效，重置为待校验
        validationStatus: 'idle',
        lastValidation: undefined,
      }
      for (const node of matched) {
        graphStore.updateNodeData(node.id, patches as Partial<CustomNodeData>)
      }
      toastSuccess(t('aiChat.constraintUpdated', { table: tableName, column: targetColumn }))
      return
    }
    // 画布上尚无该约束（如未保存的新项目）：回退为创建，保证后端已落盘的结果可见
    logger.info(
      `[AI Chat] UPDATE 未找到已有约束节点，回退为创建: ${type} on ${tableName}.${targetColumn}`
    )
  }

  const nodePosition = {
    x: targetNode.position.x + 350,
    y: targetNode.position.y,
  }

  const constraintNodeId = uuidv4()
  const constraintNode: VueFlowNode = {
    id: constraintNodeId,
    type: nodeType,
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
      // params 落进节点 data：保存链路（persistence builders）从节点 data 重建约束文件，
      // 缺失会导致后端已写入的参数在下次保存时被空值覆盖（静默数据丢失）
      ...buildConstraintParamsData(constraintKind, params ?? {}),
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
      // 建边失败：约束节点已入画布但没有连接边，仍 reconcile 保持画布连接状态一致，
      // 然后早退——不能落到下方 toastSuccess（否则同一操作先报错再报成功）
      await nextTick()
      graphStore.reconcileAll()
      return
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
 * 处理内嵌约束指令（ADD/UPDATE 同义，幂等写入）
 *
 * 契约与手动连接/Inspector 写入完全一致（见 useSchemaInteractions/SchemaNodeInspector）：
 * - 键为 camelCase ConstraintKind（notNull/unique/allowedValues）
 * - NotNull/Unique 存布尔 true；AllowedValues 存值数组
 * 其余约束类型没有内联表示，拒绝写入并提示改用独立约束（旧实现会写死数据）。
 */
function handleInlineConstraint(
  targetNode: VueFlowNode,
  constraintKind: string,
  columnName: string,
  params: Record<string, unknown>
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

  // 计算内联约束值（契约外类型/缺参在此拦截）
  let constraintValue: unknown
  if (constraintKind === 'notNull' || constraintKind === 'unique') {
    constraintValue = true
  } else if (constraintKind === 'allowedValues') {
    const raw = params.allowedValues
    if (!Array.isArray(raw) || raw.length === 0) {
      logger.warn(`[AI Chat] 内联 AllowedValues 缺少 allowedValues 参数`)
      toastError(t('aiChat.inlineAllowedValuesMissing'))
      return
    }
    constraintValue = raw.map((v) => String(v))
  } else {
    logger.warn(`[AI Chat] 约束类型 ${constraintKind} 不支持内联存储`)
    toastError(t('aiChat.inlineConstraintUnsupported', { type: constraintKind }))
    return
  }

  // 构造更新后的 columns 数组（不可变更新，避免直接修改响应式 proxy）
  const updatedColumns = (nodeData.columns as unknown[]).map((c) => {
    const col = c as Record<string, unknown>
    if (col.columnName !== columnName) return col
    // 命中目标列，添加约束
    const existingConstraints = (col.constraints as Record<string, unknown>) || {}
    return {
      ...col,
      constraints: {
        ...existingConstraints,
        [constraintKind]: constraintValue,
      },
    }
  })

  // 通过 updateNodeData 统一入口更新（触发 Vue 响应式 + VueFlow 同步）
  // 不直接操作 graphStore.nodes 数组下标，遵循 DAG 操作规范
  graphStore.updateNodeData(targetNode.id, {
    columns: updatedColumns,
  } as Partial<CustomNodeData>)

  toastSuccess(
    t('aiChat.inlineConstraintCreated', { table: nodeData.tableName, column: columnName })
  )
}

/**
 * 移除内嵌约束（handleInlineConstraint 的逆操作）
 *
 * 键与写入侧一致（camelCase ConstraintKind），跨大小写的 ADD/DELETE
 * （如 ADD 用 NotNull、DELETE 用 NOT_NULL）经 CONSTRAINT_TYPE_MAP 归一后均可命中。
 */
function removeInlineConstraint(
  targetNode: VueFlowNode,
  constraintKind: string,
  columnName: string
) {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const nodeData = targetNode.data as unknown as Record<string, unknown>
  if (!nodeData.columns) {
    logger.warn(`[AI Chat] 目标节点没有 columns 数组`)
    return
  }

  let removed = false
  const updatedColumns = (nodeData.columns as unknown[]).map((c) => {
    const col = c as Record<string, unknown>
    if (col.columnName !== columnName) return col
    const existingConstraints = (col.constraints as Record<string, unknown>) || {}
    if (!(constraintKind in existingConstraints)) return col
    removed = true
    const next = { ...existingConstraints }
    delete next[constraintKind]
    return { ...col, constraints: next }
  })

  if (!removed) {
    logger.info(`[AI Chat] 内联约束不存在，无需删除: ${constraintKind} on ${columnName}`)
    return
  }

  graphStore.updateNodeData(targetNode.id, {
    columns: updatedColumns,
  } as Partial<CustomNodeData>)
  toastSuccess(t('aiChat.inlineConstraintDeleted', { column: columnName }))
}
