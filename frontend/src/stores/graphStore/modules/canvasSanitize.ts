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
 * @fileoverview 画布恢复态净化 —— 消费端一次性迁移（纯函数）
 *
 * 背景：约束坞（constraintDock）已退役，但旧项目的持久化状态里留着坞时代数据：
 * - view.json 的 nodeStates.hidden：坞聚合器曾把约束卡片 hidden:true 写盘，
 *   加载侧原样恢复后卡片永久不可见（聚合器已删，无人再解除）；
 * - 工作区快照（.precis/workspaces.json）的 nodes/edges：存着 constraintDock
 *   节点（类型已注销，Vue Flow 渲染为默认空壳）与 dock-edge-* 展示边。
 *
 * 净化规则（幂等，不改入参，返回新数组）：
 * 1. 剔除 type === 'constraintDock' 节点。刻意定向而非"未注册类型通用剔除"——
 *    后者会误伤未来版本的前向兼容节点（旧客户端打开新项目）；
 * 2. 剔除坞展示边（id 前缀 dock-edge- 或 data.kind === 'dockDisplay'，含虚拟
 *    锚点 proxy 副本）与孤儿边（source/target 引用净化后已不存在的节点，
 *    通用清理，顺带兜底其他历史残留）；
 * 3. 解除约束卡片（isConstraintNodeType）的 hidden:true —— 坞聚合语义已死，
 *    残留 hidden 只会让卡片消失。**排除模板折叠子节点**（parentNode 非空，
 *    templateExpand 的折叠语义依赖 hidden，误解除会把模板子节点摊在画布上）。
 *    用户经 viewFilter 主动隐藏的约束卡同样会被解除——viewFilter 的
 *    localStorage 所有权册（precis.canvas.viewFilter.v1）随后按册重应用
 *    （fingerprint 的 hidden 签名变化触发防抖重收敛），用户筛选语义自愈，
 *    与净化的先后顺序无关（净化幂等、viewFilter 只隐藏册内当前可见节点）。
 * 4. 剔除"内嵌物化 vs 独立文件"双持久化残留的约束节点（同一逻辑约束曾被
 *    同时写进 schema 内嵌段与 constraints/ 独立文件，恢复时双份物化；
 *    坞时代 hidden 掩盖，规则 3 解除后暴露为重复卡片）。保留 manifest 登记
 *    的独立副本，剔除 `<schemaId>_<独立id>` 前缀形式的内嵌侧节点，判定细则
 *    见 findEmbeddedStandaloneTwinIds。
 *
 * 接入点（两条恢复路径收敛）：
 * - v2/persistence/load.ts：view.json 位置与 hidden 应用之后、数组赋值之前；
 * - canvasTabStore.loadCanvasDataFromTab：快照深拷贝后返回前（覆盖启动恢复
 *   与 Tab 切换两路）。
 */

import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { isConstraintNodeType } from '@/services/constraints/constraintMeta'

/** 净化结果：新数组 + 变更审计（单测与诊断日志消费） */
export interface SanitizedCanvas {
  nodes: CustomNode[]
  edges: Edge[]
  /** 被剔除的坞节点 id */
  removedNodeIds: string[]
  /** 被剔除的边 id（坞展示边 + 孤儿边） */
  removedEdgeIds: string[]
  /** 被解除 hidden 的约束卡片 id */
  unhiddenNodeIds: string[]
  /** 被剔除的"内嵌物化 vs 独立文件"双持久化残留节点 id（保留独立副本） */
  removedTwinNodeIds: string[]
}

/** 坞展示边判定（id 确定性派生前缀 + data.kind 双保险，含虚拟锚点 proxy） */
function isDockDisplayEdge(edge: Edge): boolean {
  if (edge.id.startsWith('dock-edge-')) return true
  return (edge.data as { kind?: string } | undefined)?.kind === 'dockDisplay'
}

/**
 * 识别"内嵌物化 vs 独立文件"双持久化残留的约束节点（纯函数）。
 *
 * 背景：同一逻辑约束曾被同时写进 schema 文件内嵌段与 constraints/ 独立文件，
 * 恢复时两条路各物化一个节点——内嵌侧 id 为 `<schemaId>_<独立id>` 前缀形式
 * 且 embedded:true；独立侧 id 即 manifest 登记的约束 id。坞时代全部 hidden
 * 不可见，坞退役解除 hidden 后重复卡片暴露（2026-09-28 实证）。
 *
 * 孪生认定（全部满足才剔除内嵌侧，保守防误删）：
 * 1. 约束节点且 embedded === true（内嵌物化标志）；
 * 2. sourceRef.nodeId 存在且 id 以 `<nodeId>_` 为前缀（确定性派生形式）；
 * 3. 去前缀后的裸 id 命中另一个同类型约束节点，且该节点 embedded !== true
 *    （独立副本）。
 *
 * @returns 应剔除的内嵌侧节点 id 集合（保留独立副本）
 */
export function findEmbeddedStandaloneTwinIds(nodes: ReadonlyArray<CustomNode>): Set<string> {
  const byId = new Map<string, CustomNode>()
  for (const node of nodes) byId.set(node.id, node)

  const twins = new Set<string>()
  for (const node of nodes) {
    if (!isConstraintNodeType(node.type)) continue
    const data = (node.data || {}) as {
      embedded?: boolean
      sourceRef?: { nodeId?: string }
    }
    if (data.embedded !== true) continue
    const schemaId = data.sourceRef?.nodeId
    if (!schemaId) continue
    const prefix = `${schemaId}_`
    if (!node.id.startsWith(prefix)) continue
    const stripped = node.id.slice(prefix.length)
    if (!stripped || stripped === node.id) continue

    const twin = byId.get(stripped)
    if (!twin || twin.type !== node.type || !isConstraintNodeType(twin.type)) continue
    const twinData = (twin.data || {}) as { embedded?: boolean }
    if (twinData.embedded === true) continue
    twins.add(node.id)
  }
  return twins
}

/**
 * 净化恢复出的画布快照（纯函数，幂等）。
 *
 * @param nodes 恢复出的节点数组（view.json 水合产物或工作区快照深拷贝）
 * @param edges 恢复出的边数组
 * @returns 新数组 + 变更审计；无变更时返回的数组与入参内容等价
 */
export function sanitizeRestoredCanvas(
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>
): SanitizedCanvas {
  const removedNodeIds: string[] = []
  const removedEdgeIds: string[] = []
  const unhiddenNodeIds: string[] = []
  const removedTwinNodeIds: string[] = []

  // 规则 4（先于边清理计算）：内嵌物化 vs 独立文件的双持久化残留——
  // 剔除内嵌侧节点，其关联边随孤儿边规则一并清除
  const twinIds = findEmbeddedStandaloneTwinIds(nodes)

  // 规则 1：剔除坞节点与双持久化孪生节点（定向，见模块头注释）
  const keptNodes: CustomNode[] = []
  for (const node of nodes) {
    if (node.type === 'constraintDock') {
      removedNodeIds.push(node.id)
      continue
    }
    if (twinIds.has(node.id)) {
      removedTwinNodeIds.push(node.id)
      continue
    }
    keptNodes.push(node)
  }

  // 规则 2：剔除坞展示边；孤儿边按净化后节点集判定（通用清理）
  const liveNodeIds = new Set(keptNodes.map((n) => n.id))
  const keptEdges: Edge[] = []
  for (const edge of edges) {
    if (isDockDisplayEdge(edge)) {
      removedEdgeIds.push(edge.id)
      continue
    }
    if (!liveNodeIds.has(edge.source) || !liveNodeIds.has(edge.target)) {
      removedEdgeIds.push(edge.id)
      continue
    }
    keptEdges.push(edge)
  }

  // 规则 3：解除约束卡片的聚合残留 hidden（模板折叠子节点除外）
  const sanitizedNodes: CustomNode[] = keptNodes.map((node) => {
    if (node.hidden === true && !node.parentNode && isConstraintNodeType(node.type)) {
      unhiddenNodeIds.push(node.id)
      return { ...node, hidden: false }
    }
    return node
  })

  return {
    nodes: sanitizedNodes,
    edges: keptEdges,
    removedNodeIds,
    removedEdgeIds,
    unhiddenNodeIds,
    removedTwinNodeIds,
  }
}
