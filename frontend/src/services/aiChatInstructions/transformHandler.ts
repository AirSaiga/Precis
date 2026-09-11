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
 * @fileoverview Transform 指令 handler：ADD 创建 transform 节点，UPDATE 刷新
 * params/outputColumns/description，DELETE 移除画布节点。
 */

import { logger } from '@/core/utils/logger'
import { toastSuccess } from '@/core/toast'
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

/**
 * 处理 Transform 指令 — 在画布上创建 Transform 节点
 *
 * ADD_TRANSFORM: 创建 Transform 节点
 * UPDATE/DELETE: 后端已处理 YAML
 */
export async function handleTransformInstruction(instruction: FrontendInstruction): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const spec = instruction.transformSpec
  if (!spec) return

  const actionType = instruction.actionType

  if (actionType === 'ADD_TRANSFORM') {
    const transformId = spec.transformId || uuidv4()
    const transformType = spec.type || 'CastType'

    const position = computePlacementPosition(graphStore)

    const transformNode: VueFlowNode = {
      id: transformId,
      type: 'transform',
      position,
      // 入场动画：创建即带 class，动画结束后由 attachEnteringClass 清除
      class: NODE_ENTERING_CLASS,
      data: {
        configName: `${transformType}_${transformId}`,
        transformType,
        description: spec.description || '',
        enabled: true,
        params: spec.params || {},
        outputColumns: spec.outputColumns || [],
        inputFromNode: spec.inputFromNode,
        inputColumn: spec.inputColumn,
        saveState: 'saved',
      },
    }

    guardCanvasOp(() => vueFlowApi.addNodes(transformNode))
    await nextTick()
    graphStore.reconcileAll()

    attachEnteringClass(transformId)
    debouncedFitView([transformId])

    toastSuccess(t('aiChat.transformCreated', { name: transformType }))
    return
  }

  // DELETE/UPDATE：定位现有 Transform 节点（按 id；无 name 字段，兜底用 configName 前缀）
  const transformId = spec.transformId || ''
  let existing = graphStore.nodes.find((n) => n.id === transformId)
  if (!existing && transformId) {
    existing = graphStore.nodes.find(
      (n) =>
        n.type === 'transform' &&
        typeof (n.data as Record<string, unknown>).configName === 'string' &&
        ((n.data as Record<string, unknown>).configName as string).includes(transformId)
    )
  }

  if (existing && actionType === 'DELETE_TRANSFORM') {
    guardCanvasOp(() => vueFlowApi.removeNodes(existing.id))
    await nextTick()
    graphStore.reconcileAll()
    toastSuccess(t('aiChat.transformDeleted', { name: transformId }))
    return
  }

  if (existing && actionType === 'UPDATE_TRANSFORM') {
    // 刷新 params/outputColumns/description（数据来自后端重读的真实结果）
    graphStore.updateNodeData(existing.id, {
      params: spec.params,
      outputColumns: spec.outputColumns,
      description: spec.description,
    } as Partial<CustomNodeData>)
    toastSuccess(t('aiChat.transformUpdated', { name: transformId }))
    return
  }

  logger.info(`[AI Chat] Transform ${actionType}: 画布上无对应节点 (${transformId})`)
}
