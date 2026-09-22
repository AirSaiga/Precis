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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, ConstraintDockNodeData } from '@/types/graph'
import {
  createDockSyncModule,
  computeConstraintDockFingerprint,
  computeDockThreshold,
  computeDockExpandPlacement,
  collectDockEdgeColumns,
  deriveConstraintDocks,
  dockDisplayEdgeId,
  isDockDisplayEdge,
  DOCK_DISPLAY_EDGE_KIND,
  DOCK_DISPLAY_TARGET_HANDLE,
  CONSTRAINT_DOCK_CARD_HEIGHT_PX,
  CONSTRAINT_DOCK_THRESHOLD_MIN,
  CONSTRAINT_DOCK_THRESHOLD_MAX,
  CONSTRAINT_DOCK_FALLBACK_SCHEMA_HEIGHT,
  CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX,
  CONSTRAINT_DOCK_GAP_X,
  CONSTRAINT_DOCK_FALLBACK_SCHEMA_WIDTH,
  CONSTRAINT_DOCK_WIDTH_PX,
  DOCK_EXPAND_GRID_ROWS_PER_COLUMN,
  DOCK_EXPAND_GRID_COLUMN_GAP,
  DOCK_EXPAND_GRID_ROW_GAP,
} from '@/stores/graphStore/modules/dockSync'
import {
  constraintDockNodeId,
  createDockFactoryModule,
} from '@/stores/graphStore/modules/factories/dockFactory'
import { addNodes, removeNodes, addEdges, removeEdges } from '@/services/canvas/vueFlowApi'
import { buildV2ProjectView } from '@/services/builders/v2ProjectBuilder'

// mock vueFlowApi 边界：所有增删入口抛未初始化 → 走 dockSync/dockFactory 的
// 无头兜底路径（数组替换），store 数组即为断言面；同时保留 spy 断言入口纪律
vi.mock('@/services/canvas/vueFlowApi', () => {
  class VueFlowApiNotInitializedError extends Error {
    constructor(message = 'vueFlowApi 未初始化') {
      super(message)
      this.name = 'VueFlowApiNotInitializedError'
    }
  }
  const notReady = () => {
    throw new VueFlowApiNotInitializedError()
  }
  return {
    VueFlowApiNotInitializedError,
    addNodes: vi.fn(notReady),
    removeNodes: vi.fn(notReady),
    updateNode: vi.fn(),
    updateNodeData: vi.fn(),
    addEdges: vi.fn(notReady),
    removeEdges: vi.fn(notReady),
    updateNodeInternals: vi.fn(),
    fitView: vi.fn(),
    findNode: vi.fn(() => undefined),
    findEdge: vi.fn(() => undefined),
  }
})

function makeSchemaNode(
  id: string,
  overrides?: {
    columns?: unknown[]
    x?: number
    y?: number
    height?: number
    type?: 'schema' | 'jsonSchema'
  }
): CustomNode {
  return {
    id,
    type: overrides?.type ?? 'schema',
    position: { x: overrides?.x ?? 0, y: overrides?.y ?? 0 },
    data: {
      configName: `Schema_${id}`,
      tableName: id,
      ...(overrides?.height !== undefined ? { height: overrides.height } : {}),
      columns: overrides?.columns ?? [
        { id: 'col-a', columnName: 'a', dataType: 'string' },
        { id: 'col-b', columnName: 'b', dataType: 'string' },
      ],
      saveState: 'saved',
    } as CustomNodeData,
  }
}

function makeConstraintNode(
  id: string,
  kind: string,
  sourceRef?: { nodeId: string; columnId?: string }
): CustomNode {
  return {
    id,
    type: kind,
    position: { x: 500, y: 0 },
    data: {
      configName: `C_${id}`,
      ...(sourceRef ? { sourceRef } : {}),
      saveState: 'saved',
    } as CustomNodeData,
  }
}

function makeDockNode(schemaNodeId: string): CustomNode {
  return {
    id: constraintDockNodeId(schemaNodeId),
    type: 'constraintDock',
    position: { x: 0, y: 0 },
    data: {
      configName: 'x',
      schemaNodeId,
      expanded: false,
      expandedAll: false,
      rows: [],
      saveState: 'saved',
    } as CustomNodeData,
  }
}

/** 测试替身：同步模拟 state.ts updateNodeData 的 store 回写语义 */
function makeUpdateNodeData(nodes: Ref<CustomNode[]>) {
  return (nodeId: string, patch: Record<string, unknown>) => {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    const { hidden, position, ...dataPatch } = patch as {
      hidden?: boolean
      position?: { x: number; y: number }
    }
    if (Object.keys(dataPatch).length > 0 && node.data) {
      Object.assign(node.data, dataPatch)
    }
    if (hidden !== undefined) node.hidden = hidden
    if (position) node.position = { ...position }
  }
}

function setup() {
  const nodes = ref<CustomNode[]>([])
  const edges = ref<Edge[]>([])
  const selectedNodeIds = ref<string[]>([])
  const updateNodeData = makeUpdateNodeData(nodes)
  const factory = createDockFactoryModule({ nodes })
  const module = createDockSyncModule({
    nodes,
    edges,
    updateNodeData,
    ensureConstraintDockForSchema: factory.ensureConstraintDockForSchema,
    selectedNodeIds,
  })
  return { nodes, edges, selectedNodeIds, module }
}

/**
 * 无头测试环境下的默认阈值：jsdom 无 .vue-flow 容器 → 视口走 800px 兜底，
 * schema 无实测尺寸 → 高度走 170px 兜底 → max(170, 560) = 560 → round(560/130) = 4
 */
const T = computeDockThreshold(
  CONSTRAINT_DOCK_FALLBACK_SCHEMA_HEIGHT,
  CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX
)

describe('computeDockThreshold', () => {
  it('小 schema / 小视口取下限 4（含 0 / NaN 兜底）', () => {
    expect(computeDockThreshold(0, 0)).toBe(CONSTRAINT_DOCK_THRESHOLD_MIN)
    // max(200, 300×0.7=210)=210 → round(210/130)=2 → clamp 下限 4
    expect(computeDockThreshold(200, 300)).toBe(CONSTRAINT_DOCK_THRESHOLD_MIN)
    expect(computeDockThreshold(Number.NaN, 800)).toBe(CONSTRAINT_DOCK_THRESHOLD_MIN)
  })

  it('中间值四舍五入正确（round half up）', () => {
    expect(computeDockThreshold(585, 0)).toBe(5) // 585/130 = 4.5 → 5
    expect(computeDockThreshold(650, 800)).toBe(5) // max(650,560)=650 → 5.0
    expect(computeDockThreshold(100, 2000)).toBe(11) // 视口主导：max(100,1400)=1400 → ≈10.77
    expect(computeDockThreshold(1300, 100)).toBe(10) // schema 高度主导：max(1300,70)=1300 → 10
  })

  it('大 schema / 大视口 clamp 到上限 16', () => {
    expect(computeDockThreshold(5000, 4000)).toBe(CONSTRAINT_DOCK_THRESHOLD_MAX)
    expect(computeDockThreshold(0, 4000)).toBe(CONSTRAINT_DOCK_THRESHOLD_MAX) // 2800/130 ≈ 21.5
  })

  it('卡片高度常量与公式约定一致（130px）', () => {
    expect(CONSTRAINT_DOCK_CARD_HEIGHT_PX).toBe(130)
  })
})

describe('computeConstraintDockFingerprint', () => {
  it('约束卡片 hidden / 校验状态变化不改变指纹（防聚合回环）', () => {
    const nodes = [
      makeSchemaNode('sc1'),
      makeConstraintNode('c1', 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' }),
    ]
    const before = computeConstraintDockFingerprint(nodes, [])
    nodes[1]!.hidden = true
    ;(nodes[1]!.data as Record<string, unknown>).validationStatus = 'error'
    ;(nodes[1]!.data as Record<string, unknown>).lastValidation = {
      totalRows: 10,
      errorCount: 3,
      matchCount: 7,
    }
    expect(computeConstraintDockFingerprint(nodes, [])).toBe(before)
  })

  it('schema 位置 / 列签名 / 约束挂靠 / 相关边变化改变指纹', () => {
    const base = [
      makeSchemaNode('sc1'),
      makeConstraintNode('c1', 'uniqueConstraint', { nodeId: 'sc1' }),
    ]
    const baseFp = computeConstraintDockFingerprint(base, [])

    const moved = [makeSchemaNode('sc1', { x: 100 }), base[1]!]
    expect(computeConstraintDockFingerprint(moved, [])).not.toBe(baseFp)

    const withInline = [
      makeSchemaNode('sc1', {
        columns: [
          { id: 'col-a', columnName: 'a', dataType: 'string', constraints: { notNull: true } },
          { id: 'col-b', columnName: 'b', dataType: 'string' },
        ],
      }),
      base[1]!,
    ]
    expect(computeConstraintDockFingerprint(withInline, [])).not.toBe(baseFp)

    const detached = [base[0]!, makeConstraintNode('c1', 'uniqueConstraint')]
    expect(computeConstraintDockFingerprint(detached, [])).not.toBe(baseFp)

    const edge: Edge = {
      id: 'e1',
      source: 'sc1',
      target: 'c1',
      sourceHandle: 'source-right-col-a',
    } as Edge
    expect(computeConstraintDockFingerprint(base, [edge])).not.toBe(baseFp)
  })

  it('坞节点自身不参与指纹', () => {
    const nodes = [makeSchemaNode('sc1')]
    const before = computeConstraintDockFingerprint(nodes, [])
    nodes.push(makeDockNode('sc1'))
    expect(computeConstraintDockFingerprint(nodes, [])).toBe(before)
  })

  it('坞展示边不参与指纹（防建边自触发回环）', () => {
    const nodes = [
      makeSchemaNode('sc1'),
      makeConstraintNode('c1', 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' }),
    ]
    const before = computeConstraintDockFingerprint(nodes, [])
    const dockEdge = {
      id: dockDisplayEdgeId('sc1', 'col-a'),
      source: 'sc1',
      target: constraintDockNodeId('sc1'),
      sourceHandle: 'source-right-col-a',
      targetHandle: DOCK_DISPLAY_TARGET_HANDLE,
      data: { kind: DOCK_DISPLAY_EDGE_KIND, transient: true },
    } as Edge
    expect(isDockDisplayEdge(dockEdge)).toBe(true)
    expect(computeConstraintDockFingerprint(nodes, [dockEdge])).toBe(before)
  })
})

describe('collectDockEdgeColumns', () => {
  it('取 rows 列集合与 Schema 列集的交集，按 Schema 列序输出', () => {
    const columns = [
      { id: 'col-a', columnName: 'a', dataType: 'string' },
      { id: 'col-b', columnName: 'b', dataType: 'string' },
      { id: 'col-c', columnName: 'c', dataType: 'string' },
    ]
    const rows = [
      {
        constraintId: 'inline-col-b-notNull',
        kind: 'notNull',
        columnId: 'col-b',
        label: 'notNull',
        embedded: true,
      },
      { constraintId: 'c1', kind: 'range', columnId: 'col-a', label: 'C_c1', embedded: false },
      {
        constraintId: 'c2',
        kind: 'scripted',
        columnId: 'col-dead',
        label: 'C_c2',
        embedded: false,
      },
      { constraintId: 'c3', kind: 'unique', label: 'C_c3', embedded: false },
    ]
    // col-dead（列已删）与表级行（无 columnId）不建边
    expect(collectDockEdgeColumns(columns, rows)).toEqual(['col-a', 'col-b'])
  })
})

describe('computeDockExpandPlacement', () => {
  const CARD = (id: string) => ({ id, width: 260, height: 130 })

  it('栅格布局：每列 6 个、行距 60、换列间距 = 列宽 + 420，origin 在坞右侧', () => {
    const cards = Array.from({ length: 7 }, (_, i) => CARD(`c${i}`))
    const positions = computeDockExpandPlacement({
      cards,
      dockPosition: { x: 420, y: 0 },
      dockWidth: CONSTRAINT_DOCK_WIDTH_PX,
      obstacles: [],
    })
    expect(DOCK_EXPAND_GRID_ROWS_PER_COLUMN).toBe(6)
    const originX = 420 + CONSTRAINT_DOCK_WIDTH_PX + CONSTRAINT_DOCK_GAP_X
    expect(positions.get('c0')).toEqual({ x: originX, y: 0 })
    expect(positions.get('c1')!.y).toBe(130 + DOCK_EXPAND_GRID_ROW_GAP)
    expect(positions.get('c1')!.x).toBe(originX)
    // 第 7 张换列：x 前进 列宽 260 + 列距 420，y 回到行首
    expect(positions.get('c6')!.x).toBe(originX + 260 + DOCK_EXPAND_GRID_COLUMN_GAP)
    expect(positions.get('c6')!.y).toBe(0)
  })

  it('与既有节点重叠时整体平移避让（computeClearanceShift 单调推进）', () => {
    // 障碍完全覆盖默认落点 (680,0)-(940,130)：四方向中"向上"位移最小
    const positions = computeDockExpandPlacement({
      cards: [CARD('c0')],
      dockPosition: { x: 420, y: 0 },
      dockWidth: CONSTRAINT_DOCK_WIDTH_PX,
      obstacles: [{ minX: 600, minY: -50, maxX: 1000, maxY: 200 }],
    })
    // up: union.minY - gap - block.maxY = -50 - 40 - 130 = -220
    expect(positions.get('c0')).toEqual({ x: 680, y: -220 })
  })

  it('空卡片集返回空 Map', () => {
    expect(
      computeDockExpandPlacement({
        cards: [],
        dockPosition: { x: 0, y: 0 },
        dockWidth: CONSTRAINT_DOCK_WIDTH_PX,
        obstacles: [],
      })
    ).toEqual(new Map())
  })
})

describe('deriveConstraintDocks', () => {
  it('按列序派生行：内嵌 + 独立 + 表级沉底', () => {
    const nodes = [
      makeSchemaNode('sc1', {
        columns: [
          {
            id: 'col-a',
            columnName: 'a',
            dataType: 'string',
            constraints: { notNull: true, allowedValues: ['x', 'y'] },
          },
          { id: 'col-b', columnName: 'b', dataType: 'string' },
        ],
      }),
      makeConstraintNode('c1', 'rangeConstraint', { nodeId: 'sc1', columnId: 'col-b' }),
      makeConstraintNode('c2', 'scriptedConstraint', { nodeId: 'sc1' }),
    ]
    const derivations = deriveConstraintDocks(
      nodes,
      [],
      CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX
    )
    const d = derivations.get('sc1')!
    expect(d).toBeDefined()
    expect(d.rows.map((r) => r.constraintId)).toEqual([
      'inline-col-a-notNull',
      'inline-col-a-allowedValues',
      'c1',
      'c2',
    ])
    expect(d.rows[0]).toMatchObject({ kind: 'notNull', columnId: 'col-a', embedded: true })
    expect(d.rows[2]).toMatchObject({
      kind: 'range',
      columnId: 'col-b',
      embedded: false,
      label: 'C_c1',
    })
    expect(d.rows[3]!.columnId).toBeUndefined()
    expect(d.standaloneIds).toEqual(['c1', 'c2'])
  })

  it(`阈值边界（动态阈值）：视口兜底 800px 下阈值=${T}，${T} 个不聚合、${T + 1} 个聚合`, () => {
    const makeMany = (count: number) => [
      makeSchemaNode('sc1'),
      ...Array.from({ length: count }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]
    expect(
      deriveConstraintDocks(makeMany(T), [], CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX).get(
        'sc1'
      )!.shouldAggregate
    ).toBe(false)
    expect(
      deriveConstraintDocks(makeMany(T + 1), [], CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX).get(
        'sc1'
      )!.shouldAggregate
    ).toBe(true)
  })

  it('高 schema 抬升阈值（data.height 尺寸候选链生效）', () => {
    const makeMany = (count: number, height?: number) => [
      makeSchemaNode('sc1', height !== undefined ? { height } : {}),
      ...Array.from({ length: count }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]
    // data.height=1300、小视口 100 → max(1300, 70) = 1300 → 阈值 10
    const d10 = deriveConstraintDocks(makeMany(10, 1300), [], 100).get('sc1')!
    expect(d10.schemaHeight).toBe(1300)
    expect(d10.threshold).toBe(10)
    expect(d10.shouldAggregate).toBe(false)
    const d11 = deriveConstraintDocks(makeMany(11, 1300), [], 100).get('sc1')!
    expect(d11.shouldAggregate).toBe(true)
  })

  it('无尺寸信息时 schemaHeight 走 170 兜底（阈值公式输入的兜底链）', () => {
    const d = deriveConstraintDocks([makeSchemaNode('sc1')], [], 100).get('sc1')!
    expect(d.schemaHeight).toBe(CONSTRAINT_DOCK_FALLBACK_SCHEMA_HEIGHT)
  })

  it('schema 与 jsonSchema 双类型支持', () => {
    const nodes = [
      makeSchemaNode('js1', { type: 'jsonSchema' }),
      makeConstraintNode('c1', 'notNullConstraint', { nodeId: 'js1', columnId: 'col-a' }),
      ...Array.from({ length: T }, (_, i) =>
        makeConstraintNode(`j${i}`, 'uniqueConstraint', { nodeId: 'js1' })
      ),
    ]
    const d = deriveConstraintDocks(nodes, [], CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX).get(
      'js1'
    )!
    expect(d).toBeDefined()
    expect(d.shouldAggregate).toBe(true)
    expect(d.rows).toHaveLength(T + 1)
  })

  it('边挂靠（无 sourceRef）解析 sourceHandle 列', () => {
    const nodes = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'rangeConstraint')]
    const edges: Edge[] = [
      { id: 'e1', source: 'sc1', target: 'c1', sourceHandle: 'source-right-col-b' } as Edge,
    ]
    const d = deriveConstraintDocks(nodes, edges, CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX).get(
      'sc1'
    )!
    expect(d.standaloneIds).toEqual(['c1'])
    expect(d.rows[0]).toMatchObject({ columnId: 'col-b' })
  })
})

describe('createDockSyncModule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('超过阈值建坞并隐藏全部独立卡片，坞位于 Schema 右侧', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1', { x: 10, y: 20 }),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]

    await module.syncDocks()

    const dock = nodes.value.find((n) => n.type === 'constraintDock')!
    expect(dock).toBeDefined()
    expect(dock.id).toBe(constraintDockNodeId('sc1'))
    expect(dock.position).toEqual({
      x: 10 + CONSTRAINT_DOCK_FALLBACK_SCHEMA_WIDTH + CONSTRAINT_DOCK_GAP_X,
      y: 20,
    })
    expect((dock.data as ConstraintDockNodeData).rows).toHaveLength(T + 1)
    expect((dock.data as ConstraintDockNodeData).saveState).toBe('saved')
    // 建坞即聚合：全部卡片 hidden（走 addNodes 增量入口 + updateNodeData hidden）
    for (let i = 0; i <= T; i++) {
      expect(nodes.value.find((n) => n.id === `c${i}`)!.hidden).toBe(true)
    }
    expect(vi.mocked(addNodes)).toHaveBeenCalledTimes(1)
  })

  it('回落阈值拆坞并恢复卡片', async () => {
    const { nodes, module } = setup()
    const constraintNodes = Array.from({ length: T + 1 }, (_, i) =>
      makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
    )
    nodes.value = [makeSchemaNode('sc1'), ...constraintNodes]
    await module.syncDocks()
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(true)

    // T+1 → T：删除一个约束回落到阈值内（模拟断连/删除后的全量状态，保留坞节点本体）
    const dockNode = nodes.value.find((n) => n.type === 'constraintDock')!
    nodes.value = [nodes.value[0]!, ...constraintNodes.slice(0, T), dockNode]
    await module.syncDocks()

    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(false)
    expect(vi.mocked(removeNodes)).toHaveBeenCalledTimes(1)
    for (let i = 0; i < T; i++) {
      expect(nodes.value.find((n) => n.id === `c${i}`)!.hidden).toBe(false)
    }
  })

  it('schema 移动后坞位置跟随，行内容随约束增加更新', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 2 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]
    await module.syncDocks()
    const dock = nodes.value.find((n) => n.type === 'constraintDock')!
    expect((dock.data as ConstraintDockNodeData).rows).toHaveLength(T + 2)
    const xBefore = dock.position.x

    // schema 移动 100px（updateNodeData 替身原地改写节点对象，先捕获旧值再比对）
    nodes.value = nodes.value.map((n) =>
      n.type === 'schema' ? { ...n, position: { x: n.position.x + 100, y: n.position.y } } : n
    )
    await module.syncDocks()
    const movedDock = nodes.value.find((n) => n.type === 'constraintDock')!
    expect(movedDock.position.x).toBe(xBefore + 100)
  })

  it('选中的卡片豁免聚合隐藏（L1 揭示保护）', async () => {
    const { nodes, selectedNodeIds, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]
    selectedNodeIds.value = ['c0']
    // 用户 L1 揭示 c0（un-hide + 选中）
    nodes.value[1]!.hidden = false

    await module.syncDocks()

    expect(nodes.value.find((n) => n.id === 'c0')!.hidden).toBe(false)
    expect(nodes.value.find((n) => n.id === 'c1')!.hidden).toBe(true)
  })

  it('undo 全量替换抹掉坞后自愈重建', async () => {
    const { nodes, module } = setup()
    const constraintNodes = Array.from({ length: T + 3 }, (_, i) =>
      makeConstraintNode(`c${i}`, 'uniqueConstraint', { nodeId: 'sc1' })
    )
    nodes.value = [makeSchemaNode('sc1'), ...constraintNodes]
    await module.syncDocks()
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(true)

    // 模拟 undo 恢复到建坞前的快照（坞不存在、卡片可见）
    nodes.value = [makeSchemaNode('sc1'), ...constraintNodes.map((n) => ({ ...n, hidden: false }))]
    await module.syncDocks()

    const dock = nodes.value.find((n) => n.type === 'constraintDock')!
    expect(dock).toBeDefined()
    expect((dock.data as ConstraintDockNodeData).rows).toHaveLength(T + 3)
    for (const c of constraintNodes) {
      expect(nodes.value.find((n) => n.id === c.id)!.hidden).toBe(true)
    }
  })

  it('schema 删除后坞拆解（无 manager 级联的兜底路径）', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]
    await module.syncDocks()
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(true)

    nodes.value = nodes.value.filter((n) => n.type !== 'schema')
    await module.syncDocks()
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(false)
  })

  it('schema hidden 镜像到坞', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]
    await module.syncDocks()

    nodes.value = nodes.value.map((n) => (n.type === 'schema' ? { ...n, hidden: true } : n))
    await module.syncDocks()
    expect(nodes.value.find((n) => n.type === 'constraintDock')!.hidden).toBe(true)
  })
})

describe('createDockSyncModule L2 展开全部/收回', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expandDockAll：卡片全部 un-hide 并栅格落在坞右侧（同列行距 190、满 6 换列）', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1', { x: 0, y: 0 }),
      ...Array.from({ length: T + 3 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]
    await module.syncDocks()
    const dock = nodes.value.find((n) => n.type === 'constraintDock')!
    expect((dock.data as ConstraintDockNodeData).expandedAll).toBe(false)

    module.expandDockAll(dock.id)

    const cards = nodes.value.filter((n) => n.type === 'notNullConstraint')
    expect(cards).toHaveLength(T + 3)
    for (const card of cards) {
      expect(card.hidden).toBe(false)
      // 全部落在坞右侧
      expect(card.position.x).toBeGreaterThanOrEqual(dock.position.x + CONSTRAINT_DOCK_WIDTH_PX)
    }
    expect((dock.data as ConstraintDockNodeData).expandedAll).toBe(true)
    // 栅格纵向步进 = 卡高 130 + 行距 60；前 6 张同列
    expect(cards[1]!.position.y - cards[0]!.position.y).toBe(130 + DOCK_EXPAND_GRID_ROW_GAP)
    expect(cards[1]!.position.x).toBe(cards[0]!.position.x)
    // 第 7 张（index 6）换列，列距 = 列宽 260 + 420
    expect(cards[6]!.position.x - cards[0]!.position.x).toBe(260 + DOCK_EXPAND_GRID_COLUMN_GAP)
    expect(cards[6]!.position.y).toBe(cards[0]!.position.y)
  })

  it('collapseDockAll：重新聚合隐藏，选中卡片豁免（与 hideAggregatedCards 语义一致）', async () => {
    const { nodes, selectedNodeIds, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]
    await module.syncDocks()
    const dockId = constraintDockNodeId('sc1')
    module.expandDockAll(dockId)

    selectedNodeIds.value = ['c2']
    module.collapseDockAll(dockId)

    for (let i = 0; i <= T; i++) {
      expect(nodes.value.find((n) => n.id === `c${i}`)!.hidden).toBe(i === 2 ? false : true)
    }
    expect(
      (nodes.value.find((n) => n.id === dockId)!.data as ConstraintDockNodeData).expandedAll
    ).toBe(false)
  })

  it('新增约束进入已展开的坞：保持展开语义（不隐藏、落栅格下一空位）', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]
    await module.syncDocks()
    const dock = nodes.value.find((n) => n.type === 'constraintDock')!
    module.expandDockAll(dock.id)

    nodes.value = [
      ...nodes.value,
      makeConstraintNode('cNew', 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' }),
    ]
    await module.syncDocks()

    const newCard = nodes.value.find((n) => n.id === 'cNew')!
    expect(newCard.hidden).toBe(false)
    // 下一空位 = 第 6 槽（0 基）：列 0 行 5，紧接既有 5 张之下
    expect(newCard.position.x).toBe(
      dock.position.x + CONSTRAINT_DOCK_WIDTH_PX + CONSTRAINT_DOCK_GAP_X
    )
    expect(newCard.position.y).toBe(dock.position.y + 5 * (130 + DOCK_EXPAND_GRID_ROW_GAP))
    // 坞行快照已含新约束
    expect((dock.data as ConstraintDockNodeData).rows).toHaveLength(T + 2)
  })
})

describe('createDockSyncModule 展示边生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('建坞即为有约束的每一列建展示边（确定性 id、transient、单 handle 汇聚）', async () => {
    const { nodes, edges, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', {
          nodeId: 'sc1',
          columnId: i % 2 === 0 ? 'col-a' : 'col-b',
        })
      ),
    ]
    await module.syncDocks()

    expect(edges.value).toHaveLength(2)
    for (const columnId of ['col-a', 'col-b']) {
      const edge = edges.value.find((e) => e.id === dockDisplayEdgeId('sc1', columnId))!
      expect(edge).toBeDefined()
      expect(edge.source).toBe('sc1')
      expect(edge.sourceHandle).toBe(`source-right-${columnId}`)
      expect(edge.target).toBe(constraintDockNodeId('sc1'))
      expect(edge.targetHandle).toBe(DOCK_DISPLAY_TARGET_HANDLE)
      expect(edge.animated).toBe(false)
      const data = edge.data as Record<string, unknown>
      expect(data.kind).toBe(DOCK_DISPLAY_EDGE_KIND)
      expect(data.transient).toBe(true)
      expect(data.columnId).toBe(columnId)
    }
    expect(vi.mocked(addEdges)).toHaveBeenCalled()
  })

  it('列约束清零移除对应展示边，其余列保留', async () => {
    const { nodes, edges, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 2 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', {
          nodeId: 'sc1',
          columnId: i === 0 ? 'col-b' : 'col-a',
        })
      ),
    ]
    await module.syncDocks()
    expect(edges.value.map((e) => e.id).sort()).toEqual(
      [dockDisplayEdgeId('sc1', 'col-a'), dockDisplayEdgeId('sc1', 'col-b')].sort()
    )

    // col-b 的唯一约束被删除 → 该列展示边移除，col-a 保留
    nodes.value = nodes.value.filter((n) => n.id !== 'c0')
    await module.syncDocks()

    expect(edges.value).toHaveLength(1)
    expect(edges.value[0]!.id).toBe(dockDisplayEdgeId('sc1', 'col-a'))
    expect(vi.mocked(removeEdges)).toHaveBeenCalled()
  })

  it('拆坞（回落阈值 / schema 消失）时展示边一并清理', async () => {
    const { nodes, edges, module } = setup()
    const constraintNodes = Array.from({ length: T + 1 }, (_, i) =>
      makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
    )
    nodes.value = [makeSchemaNode('sc1'), ...constraintNodes]
    await module.syncDocks()
    expect(edges.value).toHaveLength(1)

    const dockNode = nodes.value.find((n) => n.type === 'constraintDock')!
    nodes.value = [nodes.value[0]!, ...constraintNodes.slice(0, T), dockNode]
    await module.syncDocks()
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(false)
    expect(edges.value).toHaveLength(0)

    // schema 消失路径：重建 sc1 聚合态后删除 schema，边同样清理
    nodes.value = [makeSchemaNode('sc1'), ...constraintNodes]
    await module.syncDocks()
    expect(edges.value).toHaveLength(1)
    nodes.value = nodes.value.filter((n) => n.type !== 'schema')
    await module.syncDocks()
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(false)
    expect(edges.value).toHaveLength(0)
  })

  it('快照恢复出的孤儿展示边被清理（target 坞不存在）', async () => {
    const { nodes, edges, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]
    await module.syncDocks()
    // 模拟 undo/多 Tab 恢复出孤儿边（target 为不存在的坞）
    edges.value = [
      ...edges.value,
      {
        id: dockDisplayEdgeId('sc9', 'col-x'),
        source: 'sc9',
        target: constraintDockNodeId('sc9'),
        sourceHandle: 'source-right-col-x',
        data: { kind: DOCK_DISPLAY_EDGE_KIND, transient: true },
      } as Edge,
    ]
    await module.syncDocks()
    expect(edges.value.some((e) => e.id === dockDisplayEdgeId('sc9', 'col-x'))).toBe(false)
    expect(edges.value).toHaveLength(1)
  })

  it('展示边与坞节点均不进 view.json（buildV2ProjectView 无死键/无边载荷）', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]
    await module.syncDocks()
    // L2 展开后同样不落盘
    module.expandDockAll(constraintDockNodeId('sc1'))

    const view = buildV2ProjectView(nodes.value)
    const raw = JSON.stringify(view)
    expect(Object.keys(view.nodes)).not.toContain(constraintDockNodeId('sc1'))
    expect(raw).not.toContain('constraint-dock-')
    expect(raw).not.toContain('dock-edge-')
    expect(raw).not.toContain('expandedAll')
  })
})

describe('createDockSyncModule watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fingerprint 变化经 300ms 防抖触发同步', async () => {
    const { nodes, module } = setup()
    expect(module).toBeDefined()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]

    await nextTick()
    // 防抖窗口内尚未建坞
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(false)

    await vi.advanceTimersByTimeAsync(310)
    expect(nodes.value.some((n) => n.type === 'constraintDock')).toBe(true)
  })
})
