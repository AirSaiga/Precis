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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import {
  createConstraintDensityModule,
  computeConstraintDensityFingerprint,
  computeDensityThreshold,
  deriveConstraintFamilies,
  inlineConstraintRowId,
  DENSITY_CARD_HEIGHT_PX,
  DENSITY_THRESHOLD_MIN,
  DENSITY_THRESHOLD_MAX,
  DENSITY_FALLBACK_SCHEMA_HEIGHT,
  DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX,
} from '@/stores/graphStore/modules/constraintDensity'

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

/** 测试替身：同步模拟 state.ts updateNodeData 的原地合并语义 */
function makeUpdateNodeData(nodes: Ref<CustomNode[]>) {
  return (nodeId: string, patch: Record<string, unknown>) => {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node || !node.data) return
    Object.assign(node.data, patch)
  }
}

function setup() {
  const nodes = ref<CustomNode[]>([])
  const edges = ref<Edge[]>([])
  const updateNodeData = makeUpdateNodeData(nodes)
  const module = createConstraintDensityModule({ nodes, edges, updateNodeData })
  return { nodes, edges, module }
}

/**
 * 无头测试环境下的默认阈值：jsdom 无 .vue-flow 容器 → 视口走 800px 兜底，
 * schema 无实测尺寸 → 高度走 170px 兜底 → max(170, 560) = 560 → round(560/130) = 4
 */
const T = computeDensityThreshold(
  DENSITY_FALLBACK_SCHEMA_HEIGHT,
  DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX
)

describe('computeDensityThreshold', () => {
  it('小 schema / 小视口取下限 4（含 0 / NaN 兜底）', () => {
    expect(computeDensityThreshold(0, 0)).toBe(DENSITY_THRESHOLD_MIN)
    expect(computeDensityThreshold(200, 300)).toBe(DENSITY_THRESHOLD_MIN)
    expect(computeDensityThreshold(Number.NaN, 800)).toBe(DENSITY_THRESHOLD_MIN)
  })

  it('中间值四舍五入正确（round half up）', () => {
    expect(computeDensityThreshold(585, 0)).toBe(5) // 585/130 = 4.5 → 5
    expect(computeDensityThreshold(650, 800)).toBe(5) // max(650,560)=650 → 5.0
    expect(computeDensityThreshold(100, 2000)).toBe(11) // 视口主导
    expect(computeDensityThreshold(1300, 100)).toBe(10) // schema 高度主导
  })

  it('大 schema / 大视口 clamp 到上限 16', () => {
    expect(computeDensityThreshold(5000, 4000)).toBe(DENSITY_THRESHOLD_MAX)
    expect(computeDensityThreshold(0, 4000)).toBe(DENSITY_THRESHOLD_MAX)
  })

  it('公式分母与旧坞阈值语义一致（130px 全卡高）', () => {
    expect(DENSITY_CARD_HEIGHT_PX).toBe(130)
  })
})

describe('computeConstraintDensityFingerprint', () => {
  it('约束卡片 density / 校验状态 / 位置变化不改变指纹（防收敛回环）；钉住改变指纹（取消钉住后触发再收敛）', () => {
    const nodes = [
      makeSchemaNode('sc1'),
      makeConstraintNode('c1', 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' }),
    ]
    const before = computeConstraintDensityFingerprint(nodes, [])
    Object.assign(nodes[1]!.data as Record<string, unknown>, {
      density: 'compact',
      validationStatus: 'error',
      lastValidation: { totalRows: 10, errorCount: 3, matchCount: 7 },
    })
    nodes[1]!.position = { x: 999, y: 999 }
    expect(computeConstraintDensityFingerprint(nodes, [])).toBe(before)

    // 用户钉住：指纹变化 → watcher 触发一次再收敛（钉住节点被跳过，无写放大）
    Object.assign(nodes[1]!.data as Record<string, unknown>, { densityPinned: true })
    expect(computeConstraintDensityFingerprint(nodes, [])).not.toBe(before)
  })

  it('schema 列签名 / 约束挂靠 / 挂靠边变化改变指纹', () => {
    const base = [
      makeSchemaNode('sc1'),
      makeConstraintNode('c1', 'uniqueConstraint', { nodeId: 'sc1' }),
    ]
    const baseFp = computeConstraintDensityFingerprint(base, [])

    const withInline = [
      makeSchemaNode('sc1', {
        columns: [
          { id: 'col-a', columnName: 'a', dataType: 'string', constraints: { notNull: true } },
          { id: 'col-b', columnName: 'b', dataType: 'string' },
        ],
      }),
      base[1]!,
    ]
    expect(computeConstraintDensityFingerprint(withInline, [])).not.toBe(baseFp)

    const detached = [base[0]!, makeConstraintNode('c1', 'uniqueConstraint')]
    expect(computeConstraintDensityFingerprint(detached, [])).not.toBe(baseFp)

    const edge: Edge = {
      id: 'e1',
      source: 'sc1',
      target: 'c1',
      sourceHandle: 'source-right-col-a',
    } as Edge
    expect(computeConstraintDensityFingerprint(base, [edge])).not.toBe(baseFp)
  })
})

describe('deriveConstraintFamilies', () => {
  it('按列序派生行：内嵌 + 独立 + 表级沉底（概览弹层地基，行为与旧坞派生一致）', () => {
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
    const families = deriveConstraintFamilies(nodes, [], DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX)
    const d = families.get('sc1')!
    expect(d).toBeDefined()
    expect(d.rows.map((r) => r.constraintId)).toEqual([
      inlineConstraintRowId('col-a', 'notNull'),
      inlineConstraintRowId('col-a', 'allowedValues'),
      'c1',
      'c2',
    ])
    expect(d.rows[0]).toMatchObject({
      kind: 'notNull',
      columnId: 'col-a',
      embedded: true,
    })
    expect(d.rows[2]).toMatchObject({
      kind: 'range',
      columnId: 'col-b',
      embedded: false,
      label: 'C_c1',
    })
    expect(d.rows[3]!.columnId).toBeUndefined()
    expect(d.standaloneIds).toEqual(['c1', 'c2'])
  })

  it(`阈值边界（动态阈值）：视口兜底 800px 下阈值=${T}，${T} 个不紧凑、${T + 1} 个紧凑`, () => {
    const makeMany = (count: number) => [
      makeSchemaNode('sc1'),
      ...Array.from({ length: count }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]
    expect(
      deriveConstraintFamilies(makeMany(T), [], DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX).get('sc1')!
        .shouldCompact
    ).toBe(false)
    expect(
      deriveConstraintFamilies(makeMany(T + 1), [], DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX).get('sc1')!
        .shouldCompact
    ).toBe(true)
  })

  it('高 schema 抬升阈值（data.height 尺寸候选链生效）', () => {
    const makeMany = (count: number, height?: number) => [
      makeSchemaNode('sc1', height !== undefined ? { height } : {}),
      ...Array.from({ length: count }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]
    const d10 = deriveConstraintFamilies(makeMany(10, 1300), [], 100).get('sc1')!
    expect(d10.threshold).toBe(10)
    expect(d10.shouldCompact).toBe(false)
    const d11 = deriveConstraintFamilies(makeMany(11, 1300), [], 100).get('sc1')!
    expect(d11.shouldCompact).toBe(true)
  })

  it('schema 与 jsonSchema 双类型支持', () => {
    const nodes = [
      makeSchemaNode('js1', { type: 'jsonSchema' }),
      makeConstraintNode('c1', 'notNullConstraint', { nodeId: 'js1', columnId: 'col-a' }),
      ...Array.from({ length: T }, (_, i) =>
        makeConstraintNode(`j${i}`, 'uniqueConstraint', { nodeId: 'js1' })
      ),
    ]
    const d = deriveConstraintFamilies(nodes, [], DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX).get('js1')!
    expect(d).toBeDefined()
    expect(d.shouldCompact).toBe(true)
    expect(d.rows).toHaveLength(T + 1)
  })

  it('边挂靠（无 sourceRef）解析 sourceHandle 列', () => {
    const nodes = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'rangeConstraint')]
    const edges: Edge[] = [
      { id: 'e1', source: 'sc1', target: 'c1', sourceHandle: 'source-right-col-b' } as Edge,
    ]
    const d = deriveConstraintFamilies(nodes, edges, DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX).get(
      'sc1'
    )!
    expect(d.standaloneIds).toEqual(['c1'])
    expect(d.rows[0]).toMatchObject({ columnId: 'col-b' })
  })
})

describe('createConstraintDensityModule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('超过阈值 → 家族全部约束 density=compact', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1', columnId: 'col-a' })
      ),
    ]

    await module.syncDensity()

    for (let i = 0; i <= T; i++) {
      expect(
        (nodes.value.find((n) => n.id === `c${i}`)!.data as CustomNodeData & { density?: string })
          .density
      ).toBe('compact')
    }
    // schema 节点不受影响
    expect(
      (nodes.value.find((n) => n.id === 'sc1')!.data as CustomNodeData & { density?: string })
        .density
    ).toBeUndefined()
  })

  it('回落阈值内 → 清除 compact（undefined），用户钉住（densityPinned）豁免', async () => {
    const { nodes, module } = setup()
    const constraintNodes = Array.from({ length: T + 1 }, (_, i) =>
      makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
    )
    nodes.value = [makeSchemaNode('sc1'), ...constraintNodes]
    await module.syncDensity()
    expect(
      (nodes.value.find((n) => n.id === 'c0')!.data as CustomNodeData & { density?: string })
        .density
    ).toBe('compact')

    // 用户钉住 c1 为全卡
    Object.assign(nodes.value.find((n) => n.id === 'c1')!.data as Record<string, unknown>, {
      density: 'full',
      densityPinned: true,
    })

    // 约束数回落到阈值内（删一个）→ 未钉住的清除 compact，钉住的保留 full
    nodes.value = [nodes.value[0]!, ...constraintNodes.slice(0, T)]
    await module.syncDensity()

    expect(
      (nodes.value.find((n) => n.id === 'c0')!.data as CustomNodeData & { density?: string })
        .density
    ).toBeUndefined()
    const pinned = nodes.value.find((n) => n.id === 'c1')!.data as CustomNodeData & {
      density?: string
      densityPinned?: boolean
    }
    expect(pinned.density).toBe('full')
    expect(pinned.densityPinned).toBe(true)
  })

  it('钉住紧凑（用户显式 compact + pinned）不被阈值覆写', async () => {
    const { nodes, module } = setup()
    // 单约束（家族 ≤ 阈值，默认全卡），用户钉住为紧凑
    nodes.value = [
      makeSchemaNode('sc1'),
      (() => {
        const n = makeConstraintNode('c0', 'notNullConstraint', { nodeId: 'sc1' })
        Object.assign(n.data as Record<string, unknown>, {
          density: 'compact',
          densityPinned: true,
        })
        return n
      })(),
    ]
    await module.syncDensity()
    const data = nodes.value.find((n) => n.id === 'c0')!.data as CustomNodeData & {
      density?: string
    }
    expect(data.density).toBe('compact')
  })

  it('不挂靠任何家族的孤儿约束 → 全卡（清 compact）', async () => {
    const { nodes, module } = setup()
    const orphan = makeConstraintNode('cX', 'uniqueConstraint')
    Object.assign(orphan.data as Record<string, unknown>, { density: 'compact' })
    nodes.value = [makeSchemaNode('sc1'), orphan]
    await module.syncDensity()
    expect(
      (nodes.value.find((n) => n.id === 'cX')!.data as CustomNodeData & { density?: string })
        .density
    ).toBeUndefined()
  })

  it('幂等：无变化时不产生写入（updateNodeData spy 计数为零）', async () => {
    const { nodes, module } = setup()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]
    await module.syncDensity()

    const calls: string[] = []
    const nodes2 = nodes
    const spyModule = createConstraintDensityModule({
      nodes: nodes2,
      edges: ref<Edge[]>([]),
      updateNodeData: (id) => calls.push(id),
    })
    await spyModule.syncDensity()
    expect(calls).toHaveLength(0)
  })

  it('fingerprint 变化经 300ms 防抖触发收敛', async () => {
    vi.useFakeTimers()
    const { nodes, module } = setup()
    expect(module).toBeDefined()
    nodes.value = [
      makeSchemaNode('sc1'),
      ...Array.from({ length: T + 1 }, (_, i) =>
        makeConstraintNode(`c${i}`, 'notNullConstraint', { nodeId: 'sc1' })
      ),
    ]

    await nextTick()
    expect(
      (nodes.value.find((n) => n.id === 'c0')!.data as CustomNodeData & { density?: string })
        .density
    ).toBeUndefined()

    await vi.advanceTimersByTimeAsync(310)
    expect(
      (nodes.value.find((n) => n.id === 'c0')!.data as CustomNodeData & { density?: string })
        .density
    ).toBe('compact')
    vi.useRealTimers()
  })
})
