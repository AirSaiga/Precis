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
 * @fileoverview AI 指令画布操作助手：防抖 fitView、入场动画 class 清理、
 * 画布未就绪守卫与新节点放置位置计算（跨各指令 handler 共享）。
 */

import { logger } from '@/core/utils/logger'
import * as vueFlowApi from '@/services/canvas/vueFlowApi'
import { VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
import {
  FITVIEW_DURATION_MS,
  NODE_ENTER_DURATION_MS,
  NODE_ENTERING_CLASS,
} from '@/services/canvas/animationDurations'

/**
 * fitView 防抖
 *
 * 多个 handler 连续创建节点时（如 Schema + 子约束），各自触发 fitView 会导致画布
 * 连续跳动。防抖窗口内累加所有调用方传入的节点 id（取并集，而非覆盖），最终只执行
 * 一次 fitView，框住整批节点。
 *
 * 跨 handler 共享同一 timer，防抖窗口 500ms。
 *
 * 注意：入场动画与 fitView 不做时序拆分——曾尝试「先 fitView 再延迟加 enter class」，
 * 但节点创建时缺少 opacity:0 初始态，延迟加 class 反而造成「先可见→闪没→淡入」
 * 的闪现回归。改为节点创建即带 NODE_ENTERING_CLASS（详见 attachEnteringClass）。
 */
let fitViewTimer: ReturnType<typeof setTimeout> | null = null
let pendingFitViewNodes = new Set<string>()

/**
 * 防抖 fitView：累加节点 id，500ms 窗口结束后执行一次 fitView 框住全部节点
 *
 * @param nodes 本次调用要纳入视野的节点 id
 * @param options padding / duration 覆盖（最后一次生效）
 */
export function debouncedFitView(
  nodes: string[],
  options: { padding?: number; duration?: number } = {}
): void {
  for (const n of nodes) pendingFitViewNodes.add(n)
  if (fitViewTimer) {
    clearTimeout(fitViewTimer)
  }
  fitViewTimer = setTimeout(() => {
    fitViewTimer = null
    const nodeIds = [...pendingFitViewNodes]
    pendingFitViewNodes = new Set()
    if (nodeIds.length === 0) return
    // 画布可能正处于模式切换重建窗口期，fitView 失败时静默跳过（不记 error）
    try {
      vueFlowApi.fitView({
        nodes: nodeIds,
        padding: options.padding ?? 0.25,
        duration: options.duration ?? FITVIEW_DURATION_MS,
      })
    } catch (e) {
      if (e instanceof VueFlowApiNotInitializedError) {
        logger.warn('[AI Instruction] fitView 跳过（画布未就绪）')
      } else {
        throw e
      }
    }
  }, 500)
}

/**
 * 给 AI 新建的节点安排入场动画 class 的清理。
 *
 * 与 createBaseNodeFactory.clearNodeClass 同一模式：用 findNode 增量改 Vue Flow
 * 内部响应式 GraphNode 的 class，不能用 nodes.value = [...] 全量替换（会绕过 Vue Flow
 * 增量 hooks，在节点→边关联场景下可能引发隐性状态不一致）。
 *
 * 调用方在节点对象上预设 `class: NODE_ENTERING_CLASS`，再调用本助手在动画结束后清除。
 */
export function attachEnteringClass(nodeId: string): void {
  setTimeout(() => {
    const vfNode = vueFlowApi.findNode(nodeId)
    if (vfNode && vfNode.class === NODE_ENTERING_CLASS) {
      vfNode.class = undefined
    }
  }, NODE_ENTER_DURATION_MS)
}

/**
 * 执行画布操作，VueFlow 未就绪时（模式切换窗口期）静默跳过并记 warn。
 *
 * IDE ↔ Agent 模式切换时 NodeCanvas 会销毁重建，vueFlowApi 单例被 resetVueFlowApi 置空。
 * 此时飞行中的 AI 指令若调用 addNodes/addEdges/removeNodes 会抛 VueFlowApiNotInitializedError。
 * 这是可预期的降级——指令遇画布重建时不应崩溃，也不应记 error 制造噪音。
 * 节点可能少建（与"切换前中止 AI 任务"配合可将此场景压到极低概率），但不会污染新画布。
 *
 * 其他异常照常上抛，不吞错。
 */
export function guardCanvasOp<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (e) {
    if (e instanceof VueFlowApiNotInitializedError) {
      logger.warn('[AI Instruction] 画布未就绪（模式切换中），跳过指令:', e.message)
      return undefined
    }
    throw e
  }
}

/**
 * 计算新节点的放置位置
 *
 * 在当前画布视口中心偏移放置，避免与已有节点重叠。
 */
export function computePlacementPosition(graphStore: {
  nodes: Array<{ position: { x: number; y: number } }>
}) {
  const nodes = graphStore.nodes
  if (nodes.length === 0) {
    return { x: 100, y: 100 }
  }

  let maxX = 0
  let maxY = 0
  for (const node of nodes) {
    if (node.position.x > maxX) maxX = node.position.x
    if (node.position.y > maxY) maxY = node.position.y
  }

  return {
    x: maxX + 400,
    y: maxY,
  }
}
