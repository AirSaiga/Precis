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
import type { CustomNode, CustomNodeData } from '@/types/graph'
import {
  createViewFilterModule,
  getNodeFilterGroup,
  computeFocusClosure,
  shouldHideByErrorsOnly,
  computeViewFilterHiddenIds,
  computeViewFilterFingerprint,
  isDockAggregatedNode,
  parsePersistedViewFilter,
  loadPersistedViewFilter,
  persistViewFilter,
  VIEW_FILTER_STORAGE_KEY,
  NODE_FILTER_GROUPS,
} from '@/stores/graphStore/modules/viewFilter'

// ---------------------------------------------------------------------------
// 测试数据工厂（make* 惯例，禁止内联硬编码完整节点）
// ---------------------------------------------------------------------------

let idSeq = 0
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}-${idSeq}`
}

function makeNode(
  type: string,
  overrides?: { id?: string; data?: Record<string, unknown> }
): CustomNode {
  return {
    id: overrides?.id ?? nextId(type),
    type,
    position: { x: 0, y: 0 },
    data: { configName: `N_${type}`, ...(overrides?.data ?? {}) } as CustomNodeData,
  }
}

function makeSchemaNode(id: string): CustomNode {
  return makeNode('schema', {
    id,
    data: {
      tableName: id,
      columns: [{ id: 'col-a', columnName: 'a', dataType: 'string' }],
      saveState: 'saved',
    },
  })
}

function makeConstraintNode(
  id: string,
  validationStatus?: string,
  sourceRef?: { nodeId: string; columnId?: string }
): CustomNode {
  return makeNode('notNullConstraint', {
    id,
    data: {
      configName: `C_${id}`,
      saveState: 'saved',
      ...(sourceRef ? { sourceRef } : {}),
      ...(validationStatus ? { validationStatus } : {}),
    },
  })
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

function makeDockNode(schemaNodeId: string, standaloneIds: string[]): CustomNode {
  return makeNode('constraintDock', {
    id: `constraint-dock-${schemaNodeId}`,
    data: {
      configName: 'dock',
      schemaNodeId,
      expanded: false,
      expandedAll: false,
      rows: standaloneIds.map((cid) => ({
        constraintId: cid,
        kind: 'notNull',
        columnId: 'col-a',
        label: cid,
        embedded: false,
      })),
    },
  })
}

/** 测试替身：同步模拟 state.ts updateNodeData 的 hidden node 级 patch 语义 */
function makeUpdateNodeData(nodes: Ref<CustomNode[]>) {
  return (nodeId: string, patch: Record<string, unknown>) => {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    if (patch.hidden !== undefined) node.hidden = patch.hidden
  }
}

function hiddenIds(nodes: Ref<CustomNode[]>): string[] {
  return nodes.value
    .filter((n) => n.hidden === true)
    .map((n) => n.id)
    .sort()
}

function setup(configPath?: string) {
  const nodes = ref<CustomNode[]>([])
  const edges = ref<Edge[]>([])
  const selectedNodeId = ref<string | null>(null)
  const selectedNodeIds = ref<string[]>([])
  const clearSelection = vi.fn(() => {
    selectedNodeId.value = null
    selectedNodeIds.value = []
  })
  const configPathRef = ref<string | undefined>(configPath)
  const module = createViewFilterModule({
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    clearSelection,
    updateNodeData: makeUpdateNodeData(nodes),
    getEffectiveProjectConfigPath: () => configPathRef.value,
  })
  return { nodes, edges, selectedNodeId, selectedNodeIds, clearSelection, configPathRef, module }
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe('getNodeFilterGroup', () => {
  it('按大类映射节点类型，未知类型归 other', () => {
    expect(getNodeFilterGroup('schema')).toBe('schema')
    expect(getNodeFilterGroup('jsonSchema')).toBe('schema')
    expect(getNodeFilterGroup('sourcePreview')).toBe('source')
    expect(getNodeFilterGroup('jsonSourcePreview')).toBe('source')
    expect(getNodeFilterGroup('manualData')).toBe('source')
    expect(getNodeFilterGroup('transform')).toBe('transform')
    expect(getNodeFilterGroup('transformOutput')).toBe('transform')
    expect(getNodeFilterGroup('notNullConstraint')).toBe('constraint')
    expect(getNodeFilterGroup('compositeConstraint')).toBe('constraint')
    expect(getNodeFilterGroup('regex')).toBe('regex')
    expect(getNodeFilterGroup('regexExtract')).toBe('regex')
    expect(getNodeFilterGroup('templateInstance')).toBe('other')
    expect(getNodeFilterGroup('patternToolbox')).toBe('other')
    expect(getNodeFilterGroup('future-unknown-type')).toBe('other')
    expect(getNodeFilterGroup(undefined)).toBe('other')
  })

  it('projectRoot 与 constraintDock 永不受筛（null）', () => {
    expect(getNodeFilterGroup('projectRoot')).toBeNull()
    expect(getNodeFilterGroup('constraintDock')).toBeNull()
  })
})

describe('computeFocusClosure', () => {
  it('闭包 = 锚点 + 直接连边邻居 + sourceRef 挂靠约束（含无边挂靠）', () => {
    const schema = makeSchemaNode('sc1')
    const edgeConstraint = makeConstraintNode('c-edge', undefined, { nodeId: 'other-schema' })
    const refConstraint = makeConstraintNode('c-ref', undefined, {
      nodeId: 'sc1',
      columnId: 'col-a',
    })
    const source = makeNode('sourcePreview', { id: 'src1' })
    const stranger = makeConstraintNode('c-stranger', undefined, { nodeId: 'sc2' })
    const nodes = [schema, edgeConstraint, refConstraint, source, stranger, makeSchemaNode('sc2')]
    const edges = [
      makeEdge('e1', 'sc1', 'c-edge'),
      makeEdge('e2', 'src1', 'sc1'),
      // 与锚点无关的边不扩闭包
      makeEdge('e3', 'sc2', 'c-stranger'),
    ]
    const closure = computeFocusClosure('sc1', nodes, edges)
    expect(closure).not.toBeNull()
    expect([...closure!].sort()).toEqual(['c-edge', 'c-ref', 'sc1', 'src1'].sort())
  })

  it('转换伴生对：transform 聚焦时不孤立 outputNodeIds 引用的输出卡', () => {
    const transform = makeNode('transform', {
      id: 'tf1',
      data: { outputNodeIds: ['tf-out1'], configName: 'T' },
    })
    const output = makeNode('transformOutput', { id: 'tf-out1' })
    const stranger = makeNode('manualData', { id: 'md1' })
    const closure = computeFocusClosure('tf1', [transform, output, stranger], [])
    expect([...closure!].sort()).toEqual(['tf-out1', 'tf1'].sort())
  })

  it('锚点不存在 / 不可聚焦返回 null', () => {
    const nodes = [makeSchemaNode('sc1'), makeNode('projectRoot', { id: 'root' })]
    expect(computeFocusClosure('missing', nodes, [])).toBeNull()
    expect(computeFocusClosure('root', nodes, [])).toBeNull()
    expect(computeFocusClosure(null, nodes, [])).toBeNull()
  })
})

describe('shouldHideByErrorsOnly', () => {
  it('隐藏 pass / idle / undefined（未校验），显示 error / missing / 未知新状态', () => {
    expect(shouldHideByErrorsOnly(makeConstraintNode('a', 'pass'))).toBe(true)
    expect(shouldHideByErrorsOnly(makeConstraintNode('b', 'idle'))).toBe(true)
    expect(shouldHideByErrorsOnly(makeConstraintNode('c'))).toBe(true)
    expect(shouldHideByErrorsOnly(makeConstraintNode('d', 'error'))).toBe(false)
    expect(shouldHideByErrorsOnly(makeConstraintNode('e', 'missing'))).toBe(false)
    // 未来若引入 'warning' 状态则天然显示（不在隐藏集合）
    expect(shouldHideByErrorsOnly(makeConstraintNode('f', 'warning'))).toBe(false)
  })

  it('非约束节点不受影响', () => {
    expect(shouldHideByErrorsOnly(makeSchemaNode('sc'))).toBe(false)
    expect(shouldHideByErrorsOnly(makeNode('sourcePreview'))).toBe(false)
  })
})

describe('computeViewFilterHiddenIds', () => {
  it('三维度 conjunction：任一维度说隐藏即隐藏；dock/projectRoot 豁免', () => {
    const nodes = [
      makeNode('projectRoot', { id: 'root' }),
      makeSchemaNode('sc-in'),
      makeSchemaNode('sc-out'),
      makeConstraintNode('c-pass', 'pass', { nodeId: 'sc-in' }),
      makeNode('regex', { id: 're1' }),
      makeDockNode('sc-in', []),
    ]
    const edges = [makeEdge('e1', 'sc-in', 'c-pass')]
    const hidden = computeViewFilterHiddenIds(nodes, edges, {
      viewMode: 'focus',
      focusAnchorId: 'sc-in',
      errorsOnly: true,
      hiddenGroups: new Set(['regex'] as const),
    })
    expect(hidden.has('root')).toBe(false)
    expect(hidden.has('sc-in')).toBe(false)
    // 闭包内的 pass 卡仍被仅异常维度隐藏（三维度 conjunction，见下一用例）
    expect(hidden.has('c-pass')).toBe(true)
    expect(hidden.has('sc-out')).toBe(true) // 闭包外
    expect(hidden.has('re1')).toBe(true) // 分组隐藏
    expect(hidden.has('constraint-dock-sc-in')).toBe(false)
  })

  it('闭包内节点仍受分组/仅异常维度约束（叠加为交集语义）', () => {
    const nodes = [makeSchemaNode('sc1'), makeConstraintNode('c-err', 'error', { nodeId: 'sc1' })]
    const hidden = computeViewFilterHiddenIds(nodes, [], {
      viewMode: 'focus',
      focusAnchorId: 'sc1',
      errorsOnly: false,
      hiddenGroups: new Set(['schema'] as const),
    })
    // 分组维度隐藏 Schema，即使它是聚焦锚点（用户显式取消勾选优先）
    expect(hidden.has('sc1')).toBe(true)
    expect(hidden.has('c-err')).toBe(false)
  })

  it('全景 + 无分组 + 非仅异常 → 空集合', () => {
    const nodes = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'pass')]
    expect(
      computeViewFilterHiddenIds(nodes, [], {
        viewMode: 'panorama',
        focusAnchorId: null,
        errorsOnly: false,
        hiddenGroups: new Set(),
      }).size
    ).toBe(0)
  })
})

describe('computeViewFilterFingerprint', () => {
  it('约束校验状态 / 边拓扑 / hidden 签名变化均改变指纹', () => {
    const c = makeConstraintNode('c1', 'idle')
    const nodes = () => [makeSchemaNode('sc1'), c]
    const base = computeViewFilterFingerprint(nodes(), [])
    ;(c.data as Record<string, unknown>).validationStatus = 'error'
    expect(computeViewFilterFingerprint(nodes(), [])).not.toBe(base)
    ;(c.data as Record<string, unknown>).validationStatus = 'idle'
    c.hidden = true
    expect(computeViewFilterFingerprint(nodes(), [])).not.toBe(base)
    c.hidden = false
    expect(computeViewFilterFingerprint(nodes(), [makeEdge('e1', 'sc1', 'c1')])).not.toBe(base)
  })
})

describe('isDockAggregatedNode', () => {
  it('rows 收编且未 L2 全展开 → true；expandedAll 坞 / 无坞 → false', () => {
    const dock = makeDockNode('sc1', ['c1'])
    const expandedDock = {
      ...makeDockNode('sc1x', ['c2']),
      data: { ...(makeDockNode('sc1x', ['c2']).data as object), expandedAll: true },
    } as CustomNode
    const nodes = [dock, expandedDock]
    expect(isDockAggregatedNode('c1', nodes)).toBe(true)
    expect(isDockAggregatedNode('c2', nodes)).toBe(false)
    expect(isDockAggregatedNode('c3', [makeSchemaNode('sc2')])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

describe('viewFilter 持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('parsePersistedViewFilter：合法载荷通过，非法字段容错归默认/拒绝', () => {
    expect(
      parsePersistedViewFilter({
        viewMode: 'focus',
        focusAnchorId: 'sc1',
        errorsOnly: true,
        hiddenGroups: ['schema', 'bogus'],
        hiddenIds: ['n1', 42, 'n2'],
      })
    ).toEqual({
      viewMode: 'focus',
      focusAnchorId: 'sc1',
      errorsOnly: true,
      hiddenGroups: ['schema'],
      hiddenIds: ['n1', 'n2'],
    })
    expect(parsePersistedViewFilter({ viewMode: 'nonsense' })).toBeNull()
    expect(parsePersistedViewFilter(null)).toBeNull()
    expect(parsePersistedViewFilter('str')).toBeNull()
  })

  it('按项目配置路径分桶：写入保留其他桶，读取按桶命中', () => {
    persistViewFilter('D:/proj/a', {
      viewMode: 'focus',
      focusAnchorId: 'sc1',
      errorsOnly: false,
      hiddenGroups: ['constraint'],
      hiddenIds: ['n1'],
    })
    persistViewFilter('D:/proj/b', {
      viewMode: 'panorama',
      focusAnchorId: null,
      errorsOnly: true,
      hiddenGroups: [],
      hiddenIds: [],
    })
    expect(loadPersistedViewFilter('D:/proj/a')).toEqual({
      viewMode: 'focus',
      focusAnchorId: 'sc1',
      errorsOnly: false,
      hiddenGroups: ['constraint'],
      hiddenIds: ['n1'],
    })
    expect(loadPersistedViewFilter('D:/proj/b')?.errorsOnly).toBe(true)
    expect(loadPersistedViewFilter('D:/proj/unknown')).toBeNull()
  })

  it('损坏的 localStorage 内容不抛错（返回 null）', () => {
    localStorage.setItem(VIEW_FILTER_STORAGE_KEY, 'not-json{')
    expect(loadPersistedViewFilter('D:/proj/a')).toBeNull()
  })

  it('模块状态变化写入当前项目桶；新模块实例按配置路径恢复', async () => {
    const s = setup('D:/proj/a')
    s.nodes.value = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'pass')]
    s.module.setGroupHidden('constraint', true)
    s.module.setViewMode('focus')
    expect(loadPersistedViewFilter('D:/proj/a')).toEqual({
      viewMode: 'focus',
      focusAnchorId: null, // 进入聚焦时无选中 → 锚点空
      errorsOnly: false,
      hiddenGroups: ['constraint'],
      hiddenIds: ['c1'], // 我隐藏的节点所有权随桶持久化
    })

    // 同项目新实例：configPath watcher 载入桶并应用
    const s2 = setup('D:/proj/a')
    s2.nodes.value = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'pass')]
    s2.module.applyViewFilter()
    expect(s2.module.viewMode.value).toBe('focus')
    expect(hiddenIds(s2.nodes)).toEqual(['c1'])

    // 不同项目：默认全景无过滤
    const s3 = setup('D:/proj/other')
    s3.nodes.value = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'pass')]
    s3.module.applyViewFilter()
    expect(s3.module.viewMode.value).toBe('panorama')
    expect(hiddenIds(s3.nodes)).toEqual([])
  })

  it('重载所有权回填：快照恢复出的 hidden 节点在关闭筛选后被揭示（不留无主 hidden）', () => {
    // 会话一：开仅异常 → c1(pass) 被我隐藏并持久化
    const s1 = setup('D:/proj/reload')
    const c1 = makeConstraintNode('c1', 'pass')
    const sc1 = makeSchemaNode('sc1')
    s1.nodes.value = [sc1, c1]
    s1.module.toggleErrorsOnly()
    expect(c1.hidden).toBe(true)

    // 会话二（重载）：工作区快照把 hidden 标志一并恢复，mine 由桶回填
    const c1Restored = makeConstraintNode('c1', 'pass')
    c1Restored.hidden = true
    const s2 = setup('D:/proj/reload')
    s2.nodes.value = [makeSchemaNode('sc1'), c1Restored]
    // 载入桶后关闭仅异常 → 回填的所有权使恢复分支揭示节点
    s2.module.toggleErrorsOnly()
    expect(c1Restored.hidden).toBe(false)
    expect(hiddenIds(s2.nodes)).toEqual([])
  })

  it('水合窗口守卫：projectRoot-only 中间态的防抖被动重应用不清空回填所有权、不覆写桶', async () => {
    // 会话一：开仅异常 → c1(pass) 被隐藏并持久化（errorsOnly + hiddenIds）
    const s1 = setup('D:/proj/hydrate')
    s1.nodes.value = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'pass')]
    s1.module.toggleErrorsOnly()
    expect(loadPersistedViewFilter('D:/proj/hydrate')?.hiddenIds).toEqual(['c1'])

    // 会话二（冷启动）：configPath 先行（桶回填 mine）→ projectRoot 先落画布
    // → 300ms 防抖 fingerprint 重应用先于后端 loadProjectFromV2 触发——
    // 此时画布无业务节点，修剪不得把回填的 mine 当「已删除」清空并覆写桶
    vi.useFakeTimers()
    try {
      const s2 = setup('D:/proj/hydrate')
      s2.nodes.value = [makeNode('projectRoot', { id: 'root' })]
      await nextTick()
      await vi.advanceTimersByTimeAsync(400)
      expect(loadPersistedViewFilter('D:/proj/hydrate')?.hiddenIds).toEqual(['c1'])

      // 节点全量到位（工作区快照恢复，hidden 标志随快照回来）→ 防抖重应用
      // 后关闭仅异常，回填所有权仍能揭示（不产幽灵 hidden）
      const c1Restored = makeConstraintNode('c1', 'pass')
      c1Restored.hidden = true
      s2.nodes.value = [makeSchemaNode('sc1'), c1Restored]
      await nextTick()
      await vi.advanceTimersByTimeAsync(400)
      expect(c1Restored.hidden).toBe(true) // 仅异常仍活跃：保持隐藏
      s2.module.toggleErrorsOnly()
      expect(c1Restored.hidden).toBe(false)
      expect(hiddenIds(s2.nodes)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('无项目路径时仅会话态不落盘', () => {
    const s = setup(undefined)
    s.nodes.value = [makeConstraintNode('c1', 'pass')]
    s.module.toggleErrorsOnly()
    expect(hiddenIds(s.nodes)).toEqual(['c1'])
    expect(localStorage.getItem(VIEW_FILTER_STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 模块行为：过滤 / 恢复 / 坞所有权 / 选择模型
// ---------------------------------------------------------------------------

describe('createViewFilterModule：仅异常', () => {
  it('隐藏 pass/idle/undefined 约束卡，保留 error/missing；非约束与坞不受影响', () => {
    const s = setup()
    s.nodes.value = [
      makeNode('projectRoot', { id: 'root' }),
      makeSchemaNode('sc1'),
      makeConstraintNode('c-pass', 'pass'),
      makeConstraintNode('c-idle', 'idle'),
      makeConstraintNode('c-none'),
      makeConstraintNode('c-error', 'error'),
      makeConstraintNode('c-missing', 'missing'),
      makeNode('regex', { id: 're1' }),
    ]
    s.module.toggleErrorsOnly()
    expect(hiddenIds(s.nodes)).toEqual(['c-idle', 'c-none', 'c-pass'])

    // 关闭 → 全部恢复
    s.module.toggleErrorsOnly()
    expect(hiddenIds(s.nodes)).toEqual([])
  })

  it('校验状态变化后被动重应用收敛（防抖 watcher）', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      const cPass = makeConstraintNode('c1', 'pass')
      const cError = makeConstraintNode('c2', 'error')
      s.nodes.value = [makeSchemaNode('sc1'), cPass, cError]
      s.module.toggleErrorsOnly()
      expect(hiddenIds(s.nodes)).toEqual(['c1'])

      // 校验回写：c1 转 error → 浮出；c2 转 pass → 隐藏
      ;(cPass.data as Record<string, unknown>).validationStatus = 'error'
      ;(cError.data as Record<string, unknown>).validationStatus = 'pass'
      await nextTick()
      vi.advanceTimersByTime(400)
      expect(hiddenIds(s.nodes)).toEqual(['c2'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createViewFilterModule：聚焦', () => {
  it('锚点为选中节点：闭包外业务节点隐藏，dock/projectRoot 保留', () => {
    const s = setup()
    s.nodes.value = [
      makeNode('projectRoot', { id: 'root' }),
      makeSchemaNode('sc-a'),
      makeSchemaNode('sc-b'),
      makeConstraintNode('c-a', 'error', { nodeId: 'sc-a' }),
      makeConstraintNode('c-b', 'error', { nodeId: 'sc-b' }),
      makeNode('sourcePreview', { id: 'src-b' }),
    ]
    s.edges.value = [makeEdge('e-a', 'sc-a', 'c-a'), makeEdge('e-b', 'src-b', 'sc-b')]
    s.selectedNodeId.value = 'sc-a'
    s.module.setViewMode('focus')
    expect(hiddenIds(s.nodes)).toEqual(['c-b', 'sc-b', 'src-b'])

    // 切回全景恢复
    s.module.setViewMode('panorama')
    expect(hiddenIds(s.nodes)).toEqual([])
  })

  it('进入聚焦时无选中：模式保持但无过滤（锚点 null）', () => {
    const s = setup()
    s.nodes.value = [makeSchemaNode('sc1'), makeSchemaNode('sc2')]
    s.module.setViewMode('focus')
    expect(s.module.viewMode.value).toBe('focus')
    expect(s.module.focusAnchorId.value).toBeNull()
    expect(hiddenIds(s.nodes)).toEqual([])
  })

  it('聚焦期间选中其他 Schema → 实时换锚重过滤', async () => {
    const s = setup()
    s.nodes.value = [makeSchemaNode('sc-a'), makeSchemaNode('sc-b')]
    s.selectedNodeId.value = 'sc-a'
    s.module.setViewMode('focus')
    expect(hiddenIds(s.nodes)).toEqual(['sc-b'])

    s.selectedNodeId.value = 'sc-b'
    await nextTick()
    expect(s.module.focusAnchorId.value).toBe('sc-b')
    expect(hiddenIds(s.nodes)).toEqual(['sc-a'])
  })

  it('锚点节点被删除 → 自动退回全景（见过锚点后才判定）', async () => {
    const s = setup()
    s.nodes.value = [makeSchemaNode('sc-a'), makeSchemaNode('sc-b')]
    s.selectedNodeId.value = 'sc-a'
    s.module.setViewMode('focus')
    expect(hiddenIds(s.nodes)).toEqual(['sc-b'])

    s.nodes.value = [makeSchemaNode('sc-b')] // sc-a 被删
    s.module.applyViewFilter()
    expect(s.module.viewMode.value).toBe('panorama')
    expect(s.module.focusAnchorId.value).toBeNull()
    expect(hiddenIds(s.nodes)).toEqual([])
  })

  it('水合门闩：锚点从未出现时不误退全景', () => {
    // 先落桶再建模块：immediate configPath watcher 在创建时载入持久化态
    persistViewFilter('D:/proj/hydrate', {
      viewMode: 'focus',
      focusAnchorId: 'sc-late',
      errorsOnly: false,
      hiddenGroups: [],
    })
    const s = setup('D:/proj/hydrate')
    expect(s.module.viewMode.value).toBe('focus')
    s.nodes.value = [makeSchemaNode('sc-other')] // 锚点尚未水合
    s.module.applyViewFilter()
    expect(s.module.viewMode.value).toBe('focus') // 未见过锚点：保持聚焦
    expect(hiddenIds(s.nodes)).toEqual([]) // 闭包 null → 不过滤
  })
})

describe('createViewFilterModule：类型分组筛选', () => {
  it('分组隐藏/恢复', () => {
    const s = setup()
    s.nodes.value = [
      makeSchemaNode('sc1'),
      makeNode('sourcePreview', { id: 'src1' }),
      makeNode('regex', { id: 're1' }),
      makeConstraintNode('c1', 'error'),
    ]
    s.module.setGroupHidden('source', true)
    s.module.setGroupHidden('regex', true)
    expect(hiddenIds(s.nodes)).toEqual(['re1', 'src1'])

    s.module.setGroupHidden('regex', false)
    expect(hiddenIds(s.nodes)).toEqual(['src1'])

    s.module.setGroupHidden('source', false)
    expect(hiddenIds(s.nodes)).toEqual([])
  })

  it('约束分组隐藏时坞仍显示（导航入口豁免）', () => {
    const s = setup()
    const dock = makeDockNode('sc1', ['c1'])
    s.nodes.value = [makeSchemaNode('sc1'), makeConstraintNode('c1', 'error'), dock]
    s.module.setGroupHidden('constraint', true)
    expect(hiddenIds(s.nodes)).toEqual(['c1'])
    expect(dock.hidden).toBeFalsy()
  })
})

describe('createViewFilterModule：与坞聚合的所有权互不侵犯', () => {
  it('已被坞聚合隐藏的卡片：视图筛选不入册，关闭后不误显', () => {
    const s = setup()
    const dockCard = makeConstraintNode('c-dock', 'pass')
    dockCard.hidden = true // 坞聚合隐藏（dockSync 所为）
    s.nodes.value = [makeSchemaNode('sc1'), dockCard, makeDockNode('sc1', ['c-dock'])]

    s.module.toggleErrorsOnly() // c-dock 是 pass → 期望隐藏
    expect(dockCard.hidden).toBe(true) // 仍隐藏（非我所藏，未重复入册）
    s.module.toggleErrorsOnly() // 关闭
    expect(dockCard.hidden).toBe(true) // 关键断言：不被恢复逻辑误显
  })

  it('我隐藏后又形成坞聚合的卡片：关闭筛选时所有权让渡给坞，不揭示', () => {
    const s = setup()
    const card = makeConstraintNode('c-mine', 'pass')
    s.nodes.value = [makeSchemaNode('sc1'), card] // 尚无坞
    s.module.toggleErrorsOnly()
    expect(card.hidden).toBe(true)

    // 坞在此期间形成（rows 收编该卡片）
    s.nodes.value = [makeSchemaNode('sc1'), card, makeDockNode('sc1', ['c-mine'])]
    s.module.toggleErrorsOnly() // 关闭仅异常
    expect(card.hidden).toBe(true) // 让渡给坞，不揭示；拆坞时 dockSync.restoreRows 负责
  })

  it('选中态卡片在被动重应用时豁免（镜像 dockSync L1 揭示语义）', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      const card = makeConstraintNode('c-sel', 'pass')
      s.nodes.value = [makeSchemaNode('sc1'), card]
      s.module.toggleErrorsOnly()
      expect(card.hidden).toBe(true)

      // 用户经坞徽标揭示该卡（dockSync 跳过选中卡 → 此处模拟选中 + 直接揭示）
      s.selectedNodeId.value = 'c-sel'
      s.selectedNodeIds.value = ['c-sel']
      card.hidden = false
      await nextTick()
      vi.advanceTimersByTime(400)
      expect(card.hidden).toBe(false) // 选中豁免：不被立即吞回
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createViewFilterModule：选择模型一致性', () => {
  it('用户切换视图维度时，将被隐藏的选中节点先清空选择', () => {
    const s = setup()
    const cPass = makeConstraintNode('c-pass', 'pass', { nodeId: 'sc-b' })
    s.nodes.value = [makeSchemaNode('sc-a'), makeSchemaNode('sc-b'), cPass]
    s.selectedNodeId.value = 'sc-b'
    s.module.setViewMode('focus') // 锚点 = sc-b（闭包内保显）→ 不清
    expect(s.clearSelection).not.toHaveBeenCalled()

    // 多选集合含将被隐藏的 pass 约束卡 → 开仅异常前先清空
    s.selectedNodeIds.value = ['sc-b', 'c-pass']
    s.module.toggleErrorsOnly()
    expect(s.clearSelection).toHaveBeenCalled()
    expect(s.selectedNodeId.value).toBeNull()
    expect(s.selectedNodeIds.value).toEqual([])
    // sc-a 在聚焦闭包外 + c-pass 被仅异常隐藏
    expect(hiddenIds(s.nodes)).toEqual(['c-pass', 'sc-a'])
  })

  it('类型分组隐藏将吞掉选中节点时同样先清空', () => {
    const s = setup()
    s.nodes.value = [makeSchemaNode('sc1'), makeNode('regex', { id: 're1' })]
    s.selectedNodeId.value = 're1'
    s.module.setGroupHidden('regex', true)
    expect(s.clearSelection).toHaveBeenCalled()
    expect(hiddenIds(s.nodes)).toEqual(['re1'])
  })
})

describe('createViewFilterModule：模式叠加', () => {
  it('聚焦 + 仅异常 conjunction：闭包外的 pass 卡与闭包外的节点都隐藏', () => {
    const s = setup()
    s.nodes.value = [
      makeSchemaNode('sc-a'),
      makeSchemaNode('sc-b'),
      makeConstraintNode('c-a-pass', 'pass', { nodeId: 'sc-a' }),
      makeConstraintNode('c-a-err', 'error', { nodeId: 'sc-a' }),
      makeConstraintNode('c-b-err', 'error', { nodeId: 'sc-b' }),
    ]
    s.edges.value = [
      makeEdge('e1', 'sc-a', 'c-a-pass'),
      makeEdge('e2', 'sc-a', 'c-a-err'),
      makeEdge('e3', 'sc-b', 'c-b-err'),
    ]
    s.selectedNodeId.value = 'sc-a'
    s.module.setViewMode('focus')
    s.module.toggleErrorsOnly()
    expect(hiddenIds(s.nodes)).toEqual(['c-a-pass', 'c-b-err', 'sc-b'])

    // 退回全景但保持仅异常：闭包维度解除，仅异常维度继续生效
    s.module.setViewMode('panorama')
    expect(hiddenIds(s.nodes)).toEqual(['c-a-pass'])
    s.module.toggleErrorsOnly()
    expect(hiddenIds(s.nodes)).toEqual([])
  })
})
