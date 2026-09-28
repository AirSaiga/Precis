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
 * @fileoverview 水合 fallback 网格节点登记簿 — 水合期登记"view.json 无保存坐标的本次新建节点"，供加载适配一次性消费并纳入关系感知重排
 */

/**
 * 会话级登记簿：水合（hydrateResourcesFromConfig）时落入 fallback 网格位置
 * （view.json 无保存坐标）的新建节点 id。放 services/canvas 使 stores 与
 * features 双向可 import，避免 store → features 的反向分层依赖。
 */
const fallbackNodeIds = new Set<string>()

/**
 * 登记水合期使用 fallback 网格位置的节点 id（可多次累积调用）。
 */
export function markHydrationFallbackNodes(ids: Iterable<string>): void {
  for (const id of ids) {
    if (id) fallbackNodeIds.add(id)
  }
}

/**
 * 取出并清空登记簿（一次性消费语义）。
 *
 * 同一批 fallback 节点只参与一次加载适配重排：消费后登记清空，后续无关的
 * 适配触发（Tab 首次激活、其他项目加载等）不会对已整理内容重复重排。
 */
export function consumeHydrationFallbackNodeIds(): string[] {
  if (fallbackNodeIds.size === 0) return []
  const ids = [...fallbackNodeIds]
  fallbackNodeIds.clear()
  return ids
}
