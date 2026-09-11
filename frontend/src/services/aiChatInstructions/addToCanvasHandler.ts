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
 * @fileoverview ADD_TO_CANVAS 指令 handler：把已存在的配置资源经
 * importV2ResourceToCanvas 显示到画布（幂等，跳过相关约束确认弹窗）。
 */

import { logger } from '@/core/utils/logger'
import { toastError, toastSuccess } from '@/core/toast'
import { nextTick } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { i18n } from '@/i18n'
import type { FrontendInstruction } from '@/stores/aiChatStore'
import type { ProjectResourceKind } from '@/stores/graphStore/modules/v2/import/importV2ResourceToCanvas'
import { computePlacementPosition, debouncedFitView } from './canvasOps'

/**
 * canvasSpec.resourceKind → importV2ResourceToCanvas 的 ProjectResourceKind 映射
 *
 * pattern/regex_node 归一为 regex（与 importV2ResourceToCanvas 内部归一一致）。
 */
function normalizeResourceKind(kind: string): ProjectResourceKind {
  if (kind === 'pattern' || kind === 'regex_node') return 'regex'
  return kind as ProjectResourceKind
}

/**
 * 处理 ADD_TO_CANVAS 指令 — 把已存在的配置资源显示到画布上
 *
 * 与 ADD_*（创建节点对象）不同：本指令委托 graphStore.importV2ResourceToCanvas，
 * 由它从后端重读真实配置、构建规范节点数据、建立连接边（幂等，节点已存在则跳过）。
 *
 * 关键：传 skipRelatedConstraints=true，避免 AI 流程中弹出无人响应的确认对话框。
 */
export async function handleAddToCanvasInstruction(
  instruction: FrontendInstruction
): Promise<void> {
  const { t } = i18n.global
  const graphStore = useGraphStore()

  const spec = instruction.canvasSpec
  if (!spec) {
    logger.warn(`[AI Chat] ADD_TO_CANVAS 指令缺少 canvasSpec`)
    return
  }

  const resourceKind = normalizeResourceKind(spec.resourceKind || '')
  const resourceId = spec.resourceId || ''
  const displayName = spec.name || resourceId

  if (!resourceId) {
    logger.warn(`[AI Chat] ADD_TO_CANVAS 缺少 resourceId`)
    toastError(t('aiChat.targetNodeNotFound'))
    return
  }

  // 幂等检查：若画布已有同 id 节点，直接跳过（避免重复创建）
  if (graphStore.nodes.some((n) => n.id === resourceId)) {
    logger.info(`[AI Chat] ADD_TO_CANVAS: 节点 ${resourceId} 已在画布，跳过`)
    toastSuccess(t('aiChat.constraintCreated', { table: displayName, column: '' }))
    return
  }

  const position = computePlacementPosition(graphStore)

  try {
    const nodeId = await graphStore.importV2ResourceToCanvas(resourceKind, resourceId, position, {
      includeDeps: false,
      moveIfExists: false,
      // AI 流程跳过相关约束确认弹窗（无人响应会永久挂起）
      skipRelatedConstraints: true,
    })

    if (nodeId) {
      await nextTick()
      debouncedFitView([nodeId])
      toastSuccess(t('aiChat.schemaCreated', { name: displayName }))
    } else {
      logger.warn(`[AI Chat] ADD_TO_CANVAS: 导入失败（资源不存在或已被过滤）: ${resourceId}`)
      toastError(t('aiChat.targetNodeNotFound'))
    }
  } catch (error) {
    logger.error(`[AI Chat] ADD_TO_CANVAS 导入异常: ${resourceId}`, error)
    toastError(t('aiChat.targetNodeNotFound'))
  }
}
