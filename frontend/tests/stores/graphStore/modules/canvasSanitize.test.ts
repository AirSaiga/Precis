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
import { describe, it, expect } from 'vitest'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { sanitizeRestoredCanvas } from '@/stores/graphStore/modules/canvasSanitize'

function makeNode(
  id: string,
  type: string,
  overrides?: { hidden?: boolean; parentNode?: string; data?: Record<string, unknown> }
): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    ...(overrides?.hidden !== undefined ? { hidden: overrides.hidden } : {}),
    ...(overrides?.parentNode !== undefined ? { parentNode: overrides.parentNode } : {}),
    data: (overrides?.data ?? { configName: `N_${id}` }) as CustomNodeData,
  } as CustomNode
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  data?: Record<string, unknown>
): Edge {
  return { id, source, target, ...(data ? { data } : {}) } as Edge
}

describe('sanitizeRestoredCanvas：坞退役迁移净化', () => {
  it('剔除 constraintDock 节点（定向，不误伤其他未注册类型）', () => {
    const nodes = [
      makeNode('sc1', 'schema'),
      makeNode('c1', 'notNullConstraint'),
      makeNode('constraint-dock-sc1', 'constraintDock'),
      makeNode('future-unknown-type', 'someFutureType'),
    ]
    const result = sanitizeRestoredCanvas(nodes, [])
    expect(result.removedNodeIds).toEqual(['constraint-dock-sc1'])
    expect(result.nodes.map((n) => n.id)).toEqual(['sc1', 'c1', 'future-unknown-type'])
  })

  it('剔除坞展示边（id 前缀与 data.kind 双判，含虚拟锚点 proxy 副本）', () => {
    const nodes = [makeNode('sc1', 'schema'), makeNode('c1', 'notNullConstraint')]
    const edges = [
      makeEdge('dock-edge-sc1-col-a', 'sc1', 'constraint-dock-sc1'),
      makeEdge('dock-edge-sc1-col-a__vaTop', 'sc1', 'constraint-dock-sc1'),
      makeEdge('e-legacy-kind', 'sc1', 'c1', { kind: 'dockDisplay' }),
      makeEdge('e-normal', 'sc1', 'c1'),
    ]
    const result = sanitizeRestoredCanvas(nodes, edges)
    expect(result.removedEdgeIds).toEqual([
      'dock-edge-sc1-col-a',
      'dock-edge-sc1-col-a__vaTop',
      'e-legacy-kind',
    ])
    expect(result.edges.map((e) => e.id)).toEqual(['e-normal'])
  })

  it('剔除孤儿边：source/target 引用已不存在的节点（通用兜底）', () => {
    const nodes = [makeNode('sc1', 'schema'), makeNode('c1', 'notNullConstraint')]
    const edges = [
      makeEdge('e-ok', 'sc1', 'c1'),
      makeEdge('e-ghost-src', 'ghost', 'c1'),
      makeEdge('e-ghost-dst', 'sc1', 'ghost'),
    ]
    const result = sanitizeRestoredCanvas(nodes, edges)
    expect(result.edges.map((e) => e.id)).toEqual(['e-ok'])
    expect(result.removedEdgeIds).toEqual(['e-ghost-src', 'e-ghost-dst'])
  })

  it('解除约束卡片的残留 hidden（10 种约束类型覆盖）', () => {
    const nodes = [
      makeNode('c1', 'notNullConstraint', { hidden: true }),
      makeNode('c2', 'scriptedConstraint', { hidden: true }),
      makeNode('c3', 'dateLogicConstraint', { hidden: true }),
    ]
    const result = sanitizeRestoredCanvas(nodes, [])
    expect(result.unhiddenNodeIds).toEqual(['c1', 'c2', 'c3'])
    for (const node of result.nodes) {
      expect(node.hidden).toBe(false)
    }
  })

  it('模板折叠子节点（parentNode 非空的约束卡）保留 hidden', () => {
    const nodes = [
      makeNode('tpl-1', 'templateInstance'),
      makeNode('c-inner', 'notNullConstraint', { hidden: true, parentNode: 'tpl-1' }),
      makeNode('c-outer', 'uniqueConstraint', { hidden: true }),
    ]
    const result = sanitizeRestoredCanvas(nodes, [])
    expect(result.unhiddenNodeIds).toEqual(['c-outer'])
    expect(result.nodes.find((n) => n.id === 'c-inner')!.hidden).toBe(true)
  })

  it('非约束节点的 hidden 不动（schema 折叠、数据源隐藏等语义保留）', () => {
    const nodes = [
      makeNode('sc1', 'schema', { hidden: true }),
      makeNode('src1', 'sourcePreview', { hidden: true }),
      makeNode('c1', 'notNullConstraint', { hidden: true }),
    ]
    const result = sanitizeRestoredCanvas(nodes, [])
    expect(result.unhiddenNodeIds).toEqual(['c1'])
    expect(result.nodes.find((n) => n.id === 'sc1')!.hidden).toBe(true)
    expect(result.nodes.find((n) => n.id === 'src1')!.hidden).toBe(true)
  })

  it('幂等：净化产物再净化零变更', () => {
    const nodes = [
      makeNode('sc1', 'schema'),
      makeNode('c1', 'notNullConstraint', { hidden: true }),
      makeNode('constraint-dock-sc1', 'constraintDock'),
    ]
    const edges = [
      makeEdge('dock-edge-sc1-col-a', 'sc1', 'constraint-dock-sc1'),
      makeEdge('e-normal', 'sc1', 'c1'),
    ]
    const first = sanitizeRestoredCanvas(nodes, edges)
    const second = sanitizeRestoredCanvas(first.nodes, first.edges)
    expect(second.removedNodeIds).toEqual([])
    expect(second.removedEdgeIds).toEqual([])
    expect(second.unhiddenNodeIds).toEqual([])
    expect(second.nodes).toEqual(first.nodes)
    expect(second.edges).toEqual(first.edges)
  })

  it('不改入参（纯函数）：调用后原数组保持原样', () => {
    const nodes = [makeNode('c1', 'notNullConstraint', { hidden: true })]
    const edges = [makeEdge('dock-edge-x', 'a', 'b')]
    sanitizeRestoredCanvas(nodes, edges)
    expect(nodes[0]!.hidden).toBe(true)
    expect(edges).toHaveLength(1)
  })

  it('现代快照（无残留）原样通过', () => {
    const nodes = [makeNode('sc1', 'schema'), makeNode('c1', 'notNullConstraint')]
    const edges = [makeEdge('e1', 'sc1', 'c1')]
    const result = sanitizeRestoredCanvas(nodes, edges)
    expect(result.removedNodeIds).toEqual([])
    expect(result.removedEdgeIds).toEqual([])
    expect(result.unhiddenNodeIds).toEqual([])
    expect(result.nodes.map((n) => n.id)).toEqual(['sc1', 'c1'])
    expect(result.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('剔除"内嵌物化 vs 独立文件"双持久化孪生（保留独立副本，关联边随孤儿规则清除）', () => {
    // 复刻 2026-09-28 实证场景：同一逻辑约束同时存于 schema 内嵌段（物化为
    // `<schemaId>_<独立id>` 前缀节点，embedded:true）与 constraints/ 独立文件
    const embeddedTwin = makeNode('sc1_notnull_email', 'notNullConstraint', {
      hidden: true,
      data: {
        configName: 'NotNull',
        embedded: true,
        sourceRef: { nodeId: 'sc1', columnId: 'email', columnName: 'email' },
      },
    })
    const standalone = makeNode('notnull_email', 'notNullConstraint', {
      hidden: true,
      data: {
        configName: 'NotNull',
        sourceRef: { nodeId: 'sc1', columnId: 'email', columnName: 'email' },
      },
    })
    const nodes = [makeNode('sc1', 'schema'), embeddedTwin, standalone]
    const edges = [
      makeEdge('e-embedded', 'sc1', 'sc1_notnull_email'),
      makeEdge('e-standalone', 'sc1', 'notnull_email'),
    ]
    const result = sanitizeRestoredCanvas(nodes, edges)
    expect(result.removedTwinNodeIds).toEqual(['sc1_notnull_email'])
    expect(result.nodes.map((n) => n.id)).toEqual(['sc1', 'notnull_email'])
    // 孪生节点的边成为孤儿边被一并清除；独立副本的边保留
    expect(result.edges.map((e) => e.id)).toEqual(['e-standalone'])
    // 独立副本的 hidden 仍按规则 3 解除
    expect(result.unhiddenNodeIds).toEqual(['notnull_email'])
  })

  it('孪生认定的保守边界：无独立副本/类型不符/非前缀 id/缺 sourceRef 时保留', () => {
    const mkEmbedded = (id: string, type: string, sourceNodeId?: string) =>
      makeNode(id, type, {
        data: {
          embedded: true,
          ...(sourceNodeId ? { sourceRef: { nodeId: sourceNodeId } } : {}),
        },
      })
    const nodes = [
      makeNode('sc1', 'schema'),
      // 无独立孪生（裸 id 不存在）→ 保留
      mkEmbedded('sc1_notnull_lonely', 'notNullConstraint', 'sc1'),
      // 裸 id 存在但类型不同（脚本 vs 非空）→ 保留
      mkEmbedded('sc1_scripted_email', 'scriptedConstraint', 'sc1'),
      makeNode('scripted_email', 'notNullConstraint'),
      // embedded 但 id 不带 schemaId 前缀（非派生形式）→ 保留
      mkEmbedded('bare-embedded', 'uniqueConstraint', 'sc1'),
      // embedded:true 但缺 sourceRef → 保留
      mkEmbedded('sc1_range_age', 'rangeConstraint'),
      // 独立节点 embedded 也是 true（双内嵌互指）→ 不互删
      mkEmbedded('sc1_unique_id', 'uniqueConstraint', 'sc1'),
      mkEmbedded('unique_id', 'uniqueConstraint', 'sc1'),
    ]
    const result = sanitizeRestoredCanvas(nodes, [])
    expect(result.removedTwinNodeIds).toEqual([])
    expect(result.nodes).toHaveLength(nodes.length)
  })
})
