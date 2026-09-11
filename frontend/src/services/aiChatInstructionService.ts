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
 * @fileoverview AI 聊天前端指令分发器：按 actionType 把前端渲染指令分发到
 * aiChatInstructions/ 下的各 handler（约束/Schema/Regex/Transform/ADD_TO_CANVAS）。
 * 画布操作、连接解析与错误类型等具体能力由该目录内的模块提供，
 * 此处仅为分发入口 + 历史导出符号（debouncedFitView / AIInstructionError）的再导出。
 *
 * 指令类型：
 * - 约束节点（ADD/UPDATE/DELETE_CONSTRAINT_NODE）
 * - Schema 节点（ADD/UPDATE/DELETE_SCHEMA）
 * - Regex 节点（ADD/UPDATE/DELETE_REGEX）
 * - Transform 节点（ADD/UPDATE/DELETE_TRANSFORM）
 * - 项目设置（UPDATE_SETTINGS）
 * - 数据校验（VALIDATE_PROJECT）
 *
 * 所有 DAG 操作通过 vueFlowApi 增量 API，不直接 push。
 */

import { logger } from '@/core/utils/logger'
import type { FrontendInstruction } from '@/stores/aiChatStore'
// 动作类型分类集合由 codegen 从后端 registry 生成,消除前后端硬编码漂移
import {
  CONSTRAINT_ACTION_TYPES,
  SCHEMA_ACTION_TYPES,
  REGEX_ACTION_TYPES,
  TRANSFORM_ACTION_TYPES,
} from '@/types/generated/actions'
import { handleConstraintInstruction } from './aiChatInstructions/constraintHandler'
import { handleSchemaInstruction } from './aiChatInstructions/schemaHandler'
import { handleRegexInstruction } from './aiChatInstructions/regexHandler'
import { handleTransformInstruction } from './aiChatInstructions/transformHandler'
import { handleAddToCanvasInstruction } from './aiChatInstructions/addToCanvasHandler'

// 历史导出符号再导出（消费方仍从本模块导入，实现已拆分至 aiChatInstructions/）
export { debouncedFitView } from './aiChatInstructions/canvasOps'
export { AIInstructionError } from './aiChatInstructions/errors'

/**
 * 处理前端渲染指令，按 actionType 分发到对应 handler
 *
 * @param instructions - AI 返回的前端渲染指令数组
 */
export async function processFrontendInstructions(
  instructions: FrontendInstruction[]
): Promise<void> {
  if (!instructions || instructions.length === 0) return

  for (const instruction of instructions) {
    const { actionType } = instruction

    if (CONSTRAINT_ACTION_TYPES.has(actionType)) {
      await handleConstraintInstruction(instruction)
    } else if (SCHEMA_ACTION_TYPES.has(actionType)) {
      await handleSchemaInstruction(instruction)
    } else if (REGEX_ACTION_TYPES.has(actionType)) {
      await handleRegexInstruction(instruction)
    } else if (TRANSFORM_ACTION_TYPES.has(actionType)) {
      await handleTransformInstruction(instruction)
    } else if (actionType === 'ADD_TO_CANVAS') {
      await handleAddToCanvasInstruction(instruction)
    } else if (actionType === 'UPDATE_SETTINGS') {
      logger.info(`[AI Chat] Settings 指令: 无需画布操作`)
    } else if (actionType === 'VALIDATE_PROJECT') {
      logger.info(`[AI Chat] Validate 指令: 无需画布操作`)
    } else {
      logger.warn(`[AI Chat] 未知指令类型: ${actionType}`)
    }
  }
}
