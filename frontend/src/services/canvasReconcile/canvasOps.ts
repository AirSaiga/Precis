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
 * @fileoverview 对账链路画布操作助手：防抖 fitView 与新节点放置位置计算
 * （rebuild 执行路径共享）。画布未就绪（模式切换窗口期）的静默降级由
 * executor 捕获 VueFlowApiNotInitializedError 实现，无需独立 guard 包装。
 */

import { logger } from '@/core/utils/logger'
import * as vueFlowApi from '@/services/canvas/vueFlowApi'
import { VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
import { FITVIEW_DURATION_MS } from '@/services/canvas/animationDurations'

/**
 * fitView 防抖
 *
 * 连续重建多个节点时（如 Schema + 子约束），各自触发 fitView 会导致画布
 * 连续跳动。防抖窗口内累加所有调用方传入的节点 id（取并集，而非覆盖），最终只执行
 * 一次 fitView，框住整批节点。
 *
 * 跨调用方共享同一 timer，防抖窗口 500ms。
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
        logger.warn('[canvasReconcile] fitView 跳过（画布未就绪）')
      } else {
        throw e
      }
    }
  }, 500)
}

/**
 * 计算新节点的放置位置
 *
 * 在当前画布既有节点右外侧放置，避免与已有节点重叠；
 * 连续多次调用时随画布增长自然右移错开（每次都基于最新节点集计算）。
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
