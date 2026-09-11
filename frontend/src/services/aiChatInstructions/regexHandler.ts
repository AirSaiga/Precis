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
 * @fileoverview Regex 指令 handler：ADD 创建 regex/regexExtract 节点并按 spec 连线，
 * UPDATE 刷新节点字段，DELETE 移除画布节点。
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
import {
  attachEnteringClass,
  computePlacementPosition,
  debouncedFitView,
  guardCanvasOp,
} from './canvasOps'
import { AIInstructionError } from './errors'
import { addValidatedAIConnection, resolveColumnId } from './connectionOps'

/**
 * 处理 Regex 指令 — 在画布上创建 Regex 节点
 *
 * ADD_REGEX: 创建 Regex 节点，如有 targetNodeId 则自动连线
 * UPDATE/DELETE: 后端已处理 YAML，前端暂不做画布操作
 */
export async function handleRegexInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const spec = instruction.regexSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_REGEX') {
    const regexId = spec.regexId || spec.name || uuidv4()
    const regexName = spec.name || regexId
    const isExtract = spec.matchMode === 'extract'

    const position = computePlacementPosition(graphStore)

    const regexNode: VueFlowNode = {
      id: regexId,
      type: isExtract ? 'regexExtract' : 'regex',
      position,
      // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
      class: NODE_ENTERING_CLASS,
      data: isExtract
        ? {
            configName: regexName,
            description: spec.description || '',
            pattern: spec.pattern || '',
            flags: '',
            caseSensitive: spec.caseSensitive || false,
            enabled: true,
            captureGroups: [],
            outputColumns: [],
            validationStatus: 'idle',
            saveState: 'saved',
          }
        : {
            configName: regexName,
            description: spec.description || '',
            pattern: spec.pattern || '',
            matchMode: spec.matchMode || 'full',
            caseSensitive: spec.caseSensitive || false,
            enabled: true,
            validationStatus: 'idle',
            saveState: 'saved',
          },
    }

    guardCanvasOp(() => vueFlowApi.addNodes(regexNode))
    await nextTick()

    // 如果有关联的 Schema 节点，创建边（方向：Schema 列 -> Regex）
    if (spec.targetNodeId && spec.targetColumn) {
      const sourceNode = graphStore.nodes.find((n) => n.id === spec.targetNodeId)
      if (sourceNode) {
        const columnId = resolveColumnId(sourceNode, spec.targetColumn)
        if (columnId) {
          try {
            addValidatedAIConnection({
              sourceNode,
              sourceColumnId: columnId,
              targetNode: regexNode,
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
        } else {
          logger.warn(`[AI Chat] 无法解析 Regex 目标列: ${spec.targetColumn}`)
          toastError(t('aiChat.columnNotFound', { column: spec.targetColumn }))
        }
        await nextTick()
      }
    }

    graphStore.reconcileAll()

    attachEnteringClass(regexId)
    debouncedFitView([regexId])

    toastSuccess(t('aiChat.regexCreated', { name: regexName }))
    return
  }

  // DELETE/UPDATE：定位现有 Regex 节点（按 id 或 configName=name）
  const regexId = spec.regexId || spec.name
  let existing = graphStore.nodes.find((n) => n.id === regexId)
  if (!existing) {
    existing = graphStore.nodes.find(
      (n) => n.type === 'regex' && (n.data as Record<string, unknown>).configName === spec.name
    )
  }

  if (existing && actionType === 'DELETE_REGEX') {
    guardCanvasOp(() => vueFlowApi.removeNodes(existing.id))
    await nextTick()
    graphStore.reconcileAll()
    toastSuccess(t('aiChat.regexDeleted', { name: spec.name || regexId }))
    return
  }

  if (existing && actionType === 'UPDATE_REGEX') {
    // 刷新 pattern/matchMode/caseSensitive/description（数据来自后端重读的真实结果）
    graphStore.updateNodeData(existing.id, {
      pattern: spec.pattern,
      matchMode: spec.matchMode,
      caseSensitive: spec.caseSensitive,
      description: spec.description,
    } as Partial<CustomNodeData>)
    toastSuccess(t('aiChat.regexUpdated', { name: spec.name || regexId }))
    return
  }

  logger.info(`[AI Chat] Regex ${actionType}: 画布上无对应节点 (${spec.name || regexId})`)
}
