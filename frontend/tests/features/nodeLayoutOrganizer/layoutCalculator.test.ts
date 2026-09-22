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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LayoutCalculator } from '@/features/node-layout-organizer/core/layoutCalculator'
import {
  DEFAULT_ORGANIZE_OPTIONS,
  LAYOUT_CONSTANTS,
} from '@/features/node-layout-organizer/constants'
import { getFallbackDimension } from '@/features/node-layout-organizer/strategies/familyLayout'
import type { CustomNode } from '@/types/nodes'
import type { OrganizeOptions, ConnectionInfo } from '@/features/node-layout-organizer/types'

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  position = { x: 0, y: 0 },
  dimensions?: { width: number; height: number }
): CustomNode {
  return {
    id,
    type: type as CustomNode['type'],
    position,
    data: data as CustomNode['data'],
    dimensions,
  }
}

const defaultOptions: OrganizeOptions = {
  animate: false,
  animateDuration: 0,
  gap: 30,
  margin: 40,
}

describe('LayoutCalculator - basic', () => {
  beforeEach(() => {
    // 默认 mock navigator 为 Windows
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty position map for empty nodes', () => {
    const calc = new LayoutCalculator([], [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    expect(positions.size).toBe(0)
  })

  it('returns a position entry for each classified node', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema'), makeNode('node-s2', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    expect(positions.size).toBe(2)
    expect(positions.has('node-s1')).toBe(true)
    expect(positions.has('node-s2')).toBe(true)
  })

  it('returns positions snapped to grid (multiples of GRID_SIZE)', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    const pos = positions.get('node-s1')!
    // DEF-14 修复：对齐网格统一为 GRID_SIZE(20)，不再是 DEFAULT_GAP(30)
    expect(pos.x % LAYOUT_CONSTANTS.GRID_SIZE).toBe(0)
    expect(pos.y % LAYOUT_CONSTANTS.GRID_SIZE).toBe(0)
  })

  it('produces distinct positions for each node', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema'), makeNode('node-s2', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    const a = positions.get('node-s1')!
    const b = positions.get('node-s2')!
    expect(a.x === b.x && a.y === b.y).toBe(false)
  })

  it('exposes groups list after calculate', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    calc.calculate()
    const groups = calc.getGroups()
    expect(Array.isArray(groups)).toBe(true)
  })

  it('respects viewportZoom in constructor', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions, 0.5)
    expect(() => calc.calculate()).not.toThrow()
  })
})

describe('LayoutCalculator - node classification', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  it('classifies nodes by type into internal groups', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-cn1', 'notNullConstraint'),
      makeNode('node-cn2', 'uniqueConstraint'),
    ]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    calc.calculate()
    // 内部 classification 是私有，但 calculate 的输出反映了分类
    const positions = calc.calculate()
    expect(positions.size).toBe(3)
  })

  it('handles mixed constraint types', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-cn1', 'notNullConstraint'),
      makeNode('node-cn2', 'uniqueConstraint'),
      makeNode('node-cn3', 'rangeConstraint'),
    ]
    const calc = new LayoutCalculator(nodes, [], { width: 2000, height: 1000 }, defaultOptions)
    const positions = calc.calculate()
    expect(positions.size).toBe(4)
  })

  it('places root nodes in the reserved top row, above the schema family', () => {
    const nodes: CustomNode[] = [
      makeNode('node-root', 'projectRoot'),
      makeNode('node-s1', 'schema'),
    ]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    const rootPos = positions.get('node-root')
    const schemaPos = positions.get('node-s1')
    expect(rootPos).toBeDefined()
    expect(schemaPos).toBeDefined()
    expect(rootPos!.y).toBeLessThan(schemaPos!.y)
  })
})

describe('LayoutCalculator - with connections', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  it('processes connections without error', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema'), makeNode('node-s2', 'schema')]
    const connections: ConnectionInfo[] = [
      { source: 'node-s1', target: 'node-s2', sourceType: 'schema', targetType: 'schema' },
    ]
    const calc = new LayoutCalculator(
      nodes,
      connections,
      { width: 2000, height: 1000 },
      defaultOptions
    )
    const positions = calc.calculate()
    expect(positions.size).toBe(2)
  })
})

describe('LayoutCalculator - schema family wiring (classifyNodes 回归)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forms the schema family with three-band ordering: source | schema | constraints', () => {
    // 回归守卫：classifyNodes 曾因 Map 条目未初始化而恒产空分类，
    // 导致 Schema 中心化策略整体退化为"未分组节点"流式缠绕布局。
    const schemaId = 'node-schema-1'
    const nodes: CustomNode[] = [
      makeNode('node-src', 'sourcePreview'),
      makeNode(schemaId, 'schema'),
      makeNode('node-cn1', 'rangeConstraint', { parent: schemaId }),
    ]
    const connections: ConnectionInfo[] = [
      { source: 'node-src', target: schemaId, sourceType: 'sourcePreview', targetType: 'schema' },
    ]
    const calc = new LayoutCalculator(
      nodes,
      connections,
      { width: 2000, height: 1000 },
      defaultOptions
    )
    const positions = calc.calculate()

    expect(calc.getGroups().some((g) => g.id === `fam-${schemaId}`)).toBe(true)
    expect(positions.get('node-src')!.x).toBeLessThan(positions.get(schemaId)!.x)
    expect(positions.get(schemaId)!.x).toBeLessThan(positions.get('node-cn1')!.x)
  })

  it('participates manualData/transform/transformOutput/templateInstance in layout (D5 回归)', () => {
    // 回归守卫：这四种类型曾缺席 NODE_TYPE_TO_CATEGORY，被判 unclassified 后
    // 整体排除出布局（buildExcludedNodeIds），整理时保持陈旧位置与新布局重叠。
    const nodes: CustomNode[] = [
      makeNode('node-md', 'manualData'),
      makeNode('node-tf', 'transform'),
      makeNode('node-to', 'transformOutput'),
      makeNode('node-ti', 'templateInstance'),
    ]
    const calc = new LayoutCalculator(nodes, [], { width: 2000, height: 1000 }, defaultOptions)
    const positions = calc.calculate()
    expect(positions.size).toBe(4)
    expect(positions.has('node-md')).toBe(true)
    expect(positions.has('node-ti')).toBe(true)
    // 位置两两不同，不再堆叠/遗留原位
    const unique = new Set(positions.values().map((p) => `${p.x},${p.y}`))
    expect(unique.size).toBe(4)
  })

  it('threads constraintGrouping option: default column affinity vs legacy type grouping', () => {
    // 列亲和是默认行为（quickOrganize 走默认即列亲和），type 为旧行为回归
    const schemaId = 'node-s1'
    const nodes: CustomNode[] = [
      makeNode(schemaId, 'schema', { columns: [{ id: 'col-a', columnName: 'email' }] }),
      makeNode('node-cn-nn', 'notNullConstraint', {
        parent: schemaId,
        sourceRef: { nodeId: schemaId, columnId: 'col-a' },
      }),
      makeNode('node-cn-rg', 'rangeConstraint', {
        parent: schemaId,
        sourceRef: { nodeId: schemaId, columnId: 'col-a' },
      }),
    ]

    const columnCalc = new LayoutCalculator(
      nodes,
      [],
      { width: 2000, height: 1000 },
      { ...DEFAULT_ORGANIZE_OPTIONS }
    )
    columnCalc.calculate()
    const columnSubNames = columnCalc
      .getGroups()
      .filter((g) => g.parentId === `fam-${schemaId}`)
      .map((g) => g.name)
    expect(columnSubNames).toEqual(['email'])

    const typeCalc = new LayoutCalculator(
      nodes,
      [],
      { width: 2000, height: 1000 },
      { ...DEFAULT_ORGANIZE_OPTIONS, constraintGrouping: 'type' }
    )
    typeCalc.calculate()
    const typeSubNames = typeCalc
      .getGroups()
      .filter((g) => g.parentId === `fam-${schemaId}`)
      .map((g) => g.name)
    expect(typeSubNames.sort()).toEqual(['区间约束', '非空约束'].sort())
  })
})

// ============================================================================
// DEF-14 回归：整理节点后相邻节点不得有边缘重叠
//
// 历史根因：
// 1. 两道独立网格对齐（LayoutCalculator 30 网格 + useNodeOrganizer 20 网格），
//    相邻节点对的相对偏移叠加可达 50px，吃掉全部 gap(30) 与尺寸安全系数；
// 2. 布局尺寸只依赖 DOM rect/zoom 换算与偏低的类型兜底（schema 320 宽 vs
//    实测 690，约束高 100 vs 实测 120）。
// 修复：尺寸三级候选（Vue Flow dimensions → schema 持久化尺寸 → DOM/zoom）
// + 全链路仅一道 GRID_SIZE(20) 对齐 + 兜底尺寸校准。
// ============================================================================

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 开区间矩形相交判定（共享边缘不算重叠） */
function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function expectNoOverlaps(rects: Array<{ id: string } & Rect>): void {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!
      const b = rects[j]!
      expect(
        rectsIntersect(a, b),
        `节点 ${a.id}(${JSON.stringify(a)}) 与 ${b.id}(${JSON.stringify(b)}) 重叠`
      ).toBe(false)
    }
  }
}

/** DEF-14 GUI 实录：12 个混合节点（projectRoot/schema/8 约束/regex/manualData），
 * 尺寸差异极大（schema 690×383，约束 180×120），位置杂乱（部分视口外） */
function buildDef14Nodes(withDimensions: boolean): CustomNode[] {
  const measured = (w: number, h: number) => (withDimensions ? { width: w, height: h } : undefined)
  const constraintTypes = [
    'notNullConstraint',
    'uniqueConstraint',
    'allowedValuesConstraint',
    'rangeConstraint',
    'foreignKeyConstraint',
    'conditionalConstraint',
    'charsetConstraint',
    'dateLogicConstraint',
  ] as const
  return [
    makeNode('root-1', 'projectRoot', {}, { x: -300, y: 900 }, measured(240, 126)),
    makeNode(
      'schema-1',
      'schema',
      { width: 690, height: 383, columns: [] },
      { x: 2000, y: -800 },
      measured(690, 383)
    ),
    ...constraintTypes.map((type, i) =>
      makeNode(`cn-${i}`, type, {}, { x: 400 + i * 90, y: 1500 + i * 70 }, measured(180, 120))
    ),
    makeNode('regex-1', 'regex', {}, { x: -900, y: -400 }, measured(300, 110)),
    makeNode('manual-1', 'manualData', {}, { x: 3200, y: 2600 }, measured(160, 164)),
  ]
}

/** schema 与 8 种约束全部连线（约束挂到 schema 家族），regex/manualData 走孤儿组 */
function buildDef14Connections(): ConnectionInfo[] {
  const types = [
    'notNullConstraint',
    'uniqueConstraint',
    'allowedValuesConstraint',
    'rangeConstraint',
    'foreignKeyConstraint',
    'conditionalConstraint',
    'charsetConstraint',
    'dateLogicConstraint',
  ] as const
  return types.map((targetType, i) => ({
    source: 'schema-1',
    target: `cn-${i}`,
    sourceType: 'schema',
    targetType,
  }))
}

describe('LayoutCalculator - 整理后不重叠（DEF-14 回归）', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  const CANVAS = { width: 1280, height: 800 }

  it('实测尺寸模式（Vue Flow dimensions）：真实渲染尺寸两两不相交', () => {
    const nodes = buildDef14Nodes(true)
    const calc = new LayoutCalculator(nodes, buildDef14Connections(), CANVAS, {
      ...DEFAULT_ORGANIZE_OPTIONS,
    })
    const positions = calc.calculate()

    const rects: Array<{ id: string } & Rect> = []
    for (const node of nodes) {
      const pos = positions.get(node.id)
      expect(pos, `节点 ${node.id} 应有布局位置`).toBeDefined()
      const dim = node.dimensions!
      rects.push({ id: node.id, x: pos!.x, y: pos!.y, width: dim.width, height: dim.height })
    }
    expectNoOverlaps(rects)
  })

  it('纯兜底模式（无 dimensions、无 DOM）：布局估算尺寸两两不相交', () => {
    const nodes = buildDef14Nodes(false)
    const calc = new LayoutCalculator(nodes, buildDef14Connections(), CANVAS, {
      ...DEFAULT_ORGANIZE_OPTIONS,
    })
    const positions = calc.calculate()

    const rects: Array<{ id: string } & Rect> = []
    for (const node of nodes) {
      const pos = positions.get(node.id)
      expect(pos, `节点 ${node.id} 应有布局位置`).toBeDefined()
      const dim = getFallbackDimension(node.type ?? '')
      rects.push({ id: node.id, x: pos!.x, y: pos!.y, width: dim.width, height: dim.height })
    }
    expectNoOverlaps(rects)
  })

  it('schema 持久化尺寸兜底：未渲染时 data.width 仍约束右侧列起点', () => {
    const nodes = buildDef14Nodes(false)
    const calc = new LayoutCalculator(nodes, buildDef14Connections(), CANVAS, {
      ...DEFAULT_ORGANIZE_OPTIONS,
    })
    const positions = calc.calculate()

    const schemaPos = positions.get('schema-1')!
    const schemaRight = schemaPos.x + 690
    for (let i = 0; i < 4; i++) {
      const pos = positions.get(`cn-${i}`)!
      expect(
        pos.x,
        `约束 cn-${i} 起点应在 schema 实际右缘（${schemaRight}）之后`
      ).toBeGreaterThanOrEqual(schemaRight)
    }
  })

  it('同列约束堆叠的最小净间距不低于 gap - GRID_SIZE', () => {
    // 单道 GRID_SIZE(20) 网格对齐的数学保证：相邻节点相对偏移 ≤ GRID_SIZE，
    // 布局 gap(30) 扣除后仍应留 ≥ 10px 真实净距（历史双道对齐时可为负）
    const nodes = buildDef14Nodes(true)
    const calc = new LayoutCalculator(nodes, buildDef14Connections(), CANVAS, {
      ...DEFAULT_ORGANIZE_OPTIONS,
    })
    const positions = calc.calculate()

    const rects = nodes
      .filter((n) => n.type?.endsWith('Constraint'))
      .map((n) => {
        const pos = positions.get(n.id)!
        return {
          id: n.id,
          x: pos.x,
          y: pos.y,
          width: n.dimensions!.width,
          height: n.dimensions!.height,
        }
      })

    const byColumn = new Map<number, typeof rects>()
    for (const r of rects) {
      const list = byColumn.get(r.x) ?? []
      list.push(r)
      byColumn.set(r.x, list)
    }
    const minNetGap = DEFAULT_ORGANIZE_OPTIONS.gap - LAYOUT_CONSTANTS.GRID_SIZE
    for (const [, column] of byColumn) {
      column.sort((a, b) => a.y - b.y)
      for (let i = 1; i < column.length; i++) {
        const prev = column[i - 1]!
        const cur = column[i]!
        const netGap = cur.y - (prev.y + prev.height)
        expect(netGap, `同列 ${prev.id}→${cur.id} 净间距应 ≥ ${minNetGap}`).toBeGreaterThanOrEqual(
          minNetGap
        )
      }
    }
  })

  /** 列亲和场景：6 列 Schema，多列挂混合类型约束（每列 2-3 个）+ 2 个表级约束。
   * 矮视口 + 行对齐下拉（COLUMN_ALIGN_MAX_SLACK_PX）同时生效，验证不重叠不变量 */
  function buildColumnAffinityNodes(withDimensions: boolean): CustomNode[] {
    const measured = (w: number, h: number) =>
      withDimensions ? { width: w, height: h } : undefined
    const columns = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => ({
      id,
      columnName: `col_${i}`,
    }))
    const columnConstraints = [
      { col: 'c0', types: ['notNullConstraint', 'uniqueConstraint'] },
      { col: 'c2', types: ['rangeConstraint', 'charsetConstraint', 'dateLogicConstraint'] },
      { col: 'c4', types: ['allowedValuesConstraint', 'conditionalConstraint'] },
      { col: 'c5', types: ['scriptedConstraint'] },
    ]
    let seq = 0
    const constraintNodes = columnConstraints.flatMap(({ col, types }) =>
      types.map((type) => {
        const id = `cn-${seq++}`
        return makeNode(
          id,
          type,
          { parent: 'schema-1', sourceRef: { nodeId: 'schema-1', columnId: col } },
          { x: 0, y: 0 },
          measured(180, 120)
        )
      })
    )
    return [
      makeNode(
        'schema-1',
        'schema',
        { width: 400, height: 420, columns },
        { x: 0, y: 0 },
        measured(400, 420)
      ),
      ...constraintNodes,
      // 表级约束（无列引用）：ForeignKey / Composite 沉底
      makeNode(
        'fk-1',
        'foreignKeyConstraint',
        { parent: 'schema-1' },
        { x: 0, y: 0 },
        measured(200, 140)
      ),
      makeNode(
        'cp-1',
        'compositeConstraint',
        { parent: 'schema-1' },
        { x: 0, y: 0 },
        measured(200, 140)
      ),
    ]
  }

  it('列亲和模式（行对齐下拉生效）：整理后节点两两不相交（DEF-14 不变量）', () => {
    for (const withDimensions of [true, false]) {
      const nodes = buildColumnAffinityNodes(withDimensions)
      const calc = new LayoutCalculator(nodes, [], CANVAS, {
        ...DEFAULT_ORGANIZE_OPTIONS,
      })
      const positions = calc.calculate()

      const rects: Array<{ id: string } & Rect> = []
      for (const node of nodes) {
        const pos = positions.get(node.id)
        expect(pos, `节点 ${node.id} 应有布局位置`).toBeDefined()
        const dim = node.dimensions ?? getFallbackDimension(node.type ?? '')
        rects.push({ id: node.id, x: pos!.x, y: pos!.y, width: dim.width, height: dim.height })
      }
      expectNoOverlaps(rects)

      // 列节 + 表级节分组框完整：每个约束恰好归属一个 sub 分组
      const subGroups = calc.getGroups().filter((g) => g.parentId === 'fam-schema-1')
      const constraintIds = nodes.filter((n) => n.type?.endsWith('Constraint')).map((n) => n.id)
      const groupedIds = subGroups.flatMap((g) => g.nodeIds)
      expect(groupedIds.sort()).toEqual([...constraintIds].sort())
      expect(subGroups.some((g) => g.name === '表级约束')).toBe(true)
      expect(subGroups.some((g) => g.name === 'col_0')).toBe(true)
    }
  })
})
