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
 * @fileoverview Schema 指令 handler：ADD 创建节点并物化内嵌约束，UPDATE 刷新列
 * 结构，DELETE 移除画布节点（YAML 增删改已由后端完成，此处镜像画布状态）。
 */

import { logger } from '@/core/utils/logger'
import { toastSuccess } from '@/core/toast'
import { type Edge, type Node as VueFlowNode } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import { nextTick } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { i18n } from '@/i18n'
import type { FrontendInstruction } from '@/stores/aiChatStore'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import * as vueFlowApi from '@/services/canvas/vueFlowApi'
import { NODE_ENTERING_CLASS } from '@/services/canvas/animationDurations'
import { parseColumnSpecs } from '@/services/builders/parseColumnSpec'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import {
  attachEnteringClass,
  computePlacementPosition,
  debouncedFitView,
  guardCanvasOp,
} from './canvasOps'

/**
 * 处理 Schema 指令 — 在画布上创建/更新/删除 Schema 节点
 *
 * ADD_SCHEMA: 创建 Schema 节点，包含列定义
 * UPDATE_SCHEMA: 更新已有 Schema 节点的列（目前为日志提示，YAML 已由后端修改）
 * DELETE_SCHEMA: 移除画布上的 Schema 节点（YAML 已由后端删除）
 */
export async function handleSchemaInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const spec = instruction.schemaSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_SCHEMA') {
    const schemaId = spec.schemaId || spec.name || uuidv4()
    const schemaName = spec.name || schemaId
    const columns = spec.columns || []

    // AI 创建的 schema 节点无数据源文件，按普通 schema 解析列（isJsonSchema=false）
    const cols = parseColumnSpecs(
      columns.map((c) => ({ ...c, id: c.id || c.name })) as Array<{
        id: string
        name: string
        type: string | Record<string, unknown>
      }>,
      { isJsonSchema: false }
    ).map((col) => ({
      ...col,
      // 合并 AI spec 携带的列级内嵌约束（parseColumnSpecs 默认置空）
      constraints: columns.find((c) => c.name === col.columnName)?.constraints || {},
    }))

    const position = computePlacementPosition(graphStore)

    const schemaNode: VueFlowNode = {
      id: schemaId,
      type: 'schema',
      position,
      // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
      class: NODE_ENTERING_CLASS,
      data: {
        configName: `Schema_${schemaName}`,
        tableName: schemaName,
        columns: cols,
        saveState: 'saved',
      },
    }

    guardCanvasOp(() => vueFlowApi.addNodes(schemaNode))
    await nextTick()

    // 物化内嵌约束节点与边，行为与从资源树拖拽 Schema 保持一致
    const embeddedConstraints = spec.constraints || []
    if (embeddedConstraints.length > 0) {
      const createdSchemaNode = graphStore.nodes.find((n) => n.id === schemaId)
      if (createdSchemaNode) {
        const schemaData = createdSchemaNode.data as Record<string, unknown>
        const colNameToId = new Map<string, string>(
          ((schemaData.columns as Array<{ id?: string; columnName?: string }>) || []).map((c) => [
            c.columnName || '',
            c.id || '',
          ])
        )
        const createdConstraintIds: string[] = []
        materializeV2EmbeddedConstraints({
          schemaNode: createdSchemaNode as CustomNode,
          schemaTableName: String(schemaData.tableName || schemaName),
          embeddedConstraints,
          colNameToId,
          hasNode: (id: string) => graphStore.nodes.some((n) => n.id === id),
          addNode: (node: CustomNode) => {
            guardCanvasOp(() => vueFlowApi.addNodes(node as VueFlowNode))
            createdConstraintIds.push(node.id)
          },
          addConstraintEdge: (tableId: string, constraintId: string, columnId: string) => {
            const edgeId = `e-${tableId}-${constraintId}-${columnId}`
            if (graphStore.edges.some((e) => e.id === edgeId)) return
            guardCanvasOp(() =>
              vueFlowApi.addEdges({
                id: edgeId,
                source: tableId,
                target: constraintId,
                sourceHandle: `source-right-${columnId}`,
                targetHandle: `target-input-${constraintId}`,
                type: 'smoothstep',
              } as Edge)
            )
          },
        })
        await nextTick()
        graphStore.reconcileAll()
        // 内嵌约束节点入场动画清理 + 纳入防抖 fitView
        for (const cid of createdConstraintIds) {
          attachEnteringClass(cid)
          debouncedFitView([cid])
        }
      }
    }

    graphStore.reconcileAll()

    attachEnteringClass(schemaId)
    debouncedFitView([schemaId])

    toastSuccess(t('aiChat.schemaCreated', { name: schemaName }))
    return
  }

  if (actionType === 'DELETE_SCHEMA') {
    // schemaId 可能是 sc_xxx，AI 通常只知道 name；两者都尝试，并加 tableName/configName 兜底
    const schemaId = spec.schemaId || spec.name
    let existing = graphStore.nodes.find((n) => n.id === schemaId)
    if (!existing) {
      existing = graphStore.nodes.find((n) => {
        if (n.type !== 'schema') return false
        const d = n.data as Record<string, unknown>
        return d.tableName === spec.name || d.configName === spec.name || d.tableName === schemaId
      })
    }
    if (existing) {
      guardCanvasOp(() => vueFlowApi.removeNodes(existing.id))
      await nextTick()
      graphStore.reconcileAll()
      toastSuccess(t('aiChat.schemaDeleted', { name: spec.name || schemaId }))
    } else {
      logger.info(`[AI Chat] 画布上未找到 Schema 节点: ${schemaId}`)
    }
    return
  }

  if (actionType === 'UPDATE_SCHEMA') {
    // UPDATE：刷新画布节点的列结构（后端已合并，指令携带合并后的完整 columns）
    const schemaId = spec.schemaId || spec.name
    let existing = graphStore.nodes.find((n) => n.id === schemaId)
    if (!existing) {
      existing = graphStore.nodes.find((n) => {
        if (n.type !== 'schema') return false
        const d = n.data as Record<string, unknown>
        return d.tableName === spec.name || d.configName === spec.name
      })
    }
    if (existing && spec.columns) {
      // AI 更新：按普通 schema 解析列，并合并列级内嵌约束
      const cols = parseColumnSpecs(
        spec.columns.map((c) => ({ ...c, id: c.id || c.name })) as Array<{
          id: string
          name: string
          type: string | Record<string, unknown>
        }>,
        { isJsonSchema: false }
      ).map((col) => ({
        ...col,
        constraints: spec.columns!.find((c) => c.name === col.columnName)?.constraints || {},
      }))
      graphStore.updateNodeData(existing.id, { columns: cols } as Partial<CustomNodeData>)
      toastSuccess(t('aiChat.schemaUpdated', { name: spec.name || schemaId }))
    } else {
      logger.info(`[AI Chat] UPDATE_SCHEMA: 画布上无对应节点或无列数据: ${schemaId}`)
    }
    return
  }

  logger.warn(`[AI Chat] 未知的 Schema 动作类型: ${actionType}`)
}
