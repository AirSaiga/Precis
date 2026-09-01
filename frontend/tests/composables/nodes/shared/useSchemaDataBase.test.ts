/**
 * @fileoverview useSchemaDataBase 回写合并策略单元测试
 *
 * 覆盖 buildWritebackPatch（纯函数）与 useSchemaDataBase 的 notifyDataChanged
 * 回写路径：验证过期快照回写不会回滚挂载后由其他路径写入的外部字段
 * （连接数据源写入的 tableName/sourceFile/sourceNodeId 等）。
 *
 * 仅 mock 外部边界 @/stores/graphStore（Pinia store），组合式函数本身用
 * 最小真实 props/emit 驱动（工厂模块测试规范：mock 边界，不 mock 内部）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const updateNodeDataMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: () => ({ updateNodeData: updateNodeDataMock }),
}))

import {
  buildWritebackPatch,
  isSnapshotValueEqual,
  useSchemaDataBase,
} from '@/composables/nodes/shared/useSchemaDataBase'
import type { BaseSchemaColumn, BaseSchemaNodeData } from '@/composables/nodes/types'

/** 构造最小 Schema 节点数据（make* 工厂，禁止内联硬编码完整对象） */
function makeSchemaData(overrides: Partial<BaseSchemaNodeData> = {}): BaseSchemaNodeData {
  return {
    configName: 'cfg-1',
    tableName: '',
    columns: [],
    saveState: 'draft',
    ...overrides,
  }
}

function makeColumn(id: string): BaseSchemaColumn {
  return { id, columnName: id } as BaseSchemaColumn
}

/** 构造最小 emit 收集器 */
function makeEmit() {
  const payloads: BaseSchemaNodeData[] = []
  const emit = ((event: string, payload: BaseSchemaNodeData) => {
    if (event === 'dataChanged') payloads.push(payload)
  }) as unknown as Parameters<typeof useSchemaDataBase>[1]
  return { emit, payloads }
}

beforeEach(() => {
  updateNodeDataMock.mockClear()
})

describe('isSnapshotValueEqual', () => {
  it('原始值与引用相等直接判等', () => {
    expect(isSnapshotValueEqual(1, 1)).toBe(true)
    expect(isSnapshotValueEqual('a', 'a')).toBe(true)
    const obj = { x: 1 }
    expect(isSnapshotValueEqual(obj, obj)).toBe(true)
  })

  it('结构相等的嵌套对象/数组判等', () => {
    expect(isSnapshotValueEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
  })

  it('结构不同判不等（键数/键值/数组标志差异）', () => {
    expect(isSnapshotValueEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(isSnapshotValueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(isSnapshotValueEqual([1], [1, 2])).toBe(false)
    expect(isSnapshotValueEqual({ 0: 1 }, [1])).toBe(false)
    expect(isSnapshotValueEqual(null, {})).toBe(false)
  })
})

describe('buildWritebackPatch - 合并策略', () => {
  it('本组件未修改的键透传 props 最新值（不回滚外部写入）', () => {
    const base = makeSchemaData()
    // 挂载后连接数据源写入的外部字段
    const external = makeSchemaData({
      tableName: 'users',
      sourceFile: 'users.csv',
      sourceNodeId: 'sp-1',
      sheetName: 'Sheet1',
    })
    const patch = buildWritebackPatch(
      base as Record<string, unknown>,
      structuredClone(base) as Record<string, unknown>,
      external as Record<string, unknown>
    )
    expect(patch.tableName).toBe('users')
    expect(patch.sourceFile).toBe('users.csv')
    expect(patch.sourceNodeId).toBe('sp-1')
    expect(patch.sheetName).toBe('Sheet1')
  })

  it('本组件修改过的键保留本地值（columns 权威管理，不被 props 旧值覆盖）', () => {
    const baseColumns = [makeColumn('col-1')]
    const base = makeSchemaData({ columns: baseColumns })
    const local = makeSchemaData({ columns: [...baseColumns, makeColumn('col-2')] })
    // 外部路径同时改了其他键；columns 保持旧值
    const external = makeSchemaData({ tableName: 'users', columns: baseColumns })
    const patch = buildWritebackPatch(
      base as Record<string, unknown>,
      local as Record<string, unknown>,
      external as Record<string, unknown>
    )
    expect((patch.columns as BaseSchemaColumn[]).map((c) => c.id)).toEqual(['col-1', 'col-2'])
    expect(patch.tableName).toBe('users')
  })

  it('快照未持有的外部新增键直接透传', () => {
    const base = makeSchemaData()
    const local = structuredClone(base)
    const external = { ...base, jsonPathEdited: true, newField: 'x' } as Record<string, unknown>
    const patch = buildWritebackPatch(base as Record<string, unknown>, local, external)
    expect(patch.newField).toBe('x')
    expect(patch.jsonPathEdited).toBe(true)
  })

  it('外部键未被外部改动时透传结果与快照一致（幂等回写）', () => {
    const base = makeSchemaData({ tableName: 't' })
    const patch = buildWritebackPatch(
      base as Record<string, unknown>,
      structuredClone(base) as Record<string, unknown>,
      base as Record<string, unknown>
    )
    expect(patch).toEqual(base)
  })
})

describe('useSchemaDataBase - notifyDataChanged 回写', () => {
  it('回写补丁包含挂载后外部写入的连接信息（真实触发链回归）', async () => {
    // 挂载时未连接数据源
    const initial = makeSchemaData({ columns: [makeColumn('col-1')] })
    const props = { id: 'node-1', data: initial }
    const { emit } = makeEmit()
    const base = useSchemaDataBase<BaseSchemaColumn, BaseSchemaNodeData>(props, emit)

    // 模拟连接数据源后 store 节点数据被外部更新（props.data 是响应式引用，随 store 更新）
    Object.assign(props.data, {
      tableName: 'users',
      sourceFile: 'users.csv',
      sourceNodeId: 'sp-1',
      sourceType: 'csv',
    })

    // 本组件添加列（修改 columns）后触发回写
    base.addColumn(makeColumn('col-2'))
    await nextTick() // notifyDataChanged 内部 nextTick 后才回写

    expect(updateNodeDataMock).toHaveBeenCalledTimes(1)
    const [nodeId, patch] = updateNodeDataMock.mock.calls[0]
    expect(nodeId).toBe('node-1')
    // 本地修改生效
    expect((patch.columns as BaseSchemaColumn[]).map((c) => c.id)).toEqual(['col-1', 'col-2'])
    // 外部连接信息未被过期快照回滚
    expect(patch.tableName).toBe('users')
    expect(patch.sourceFile).toBe('users.csv')
    expect(patch.sourceNodeId).toBe('sp-1')
  })

  it('updateSchemaData 修改的键以本地为准，未触碰的键透传外部最新值', async () => {
    const initial = makeSchemaData({ tableName: 'old' })
    const props = { id: 'node-2', data: initial }
    const { emit } = makeEmit()
    const base = useSchemaDataBase<BaseSchemaColumn, BaseSchemaNodeData>(props, emit)

    Object.assign(props.data, { sourceFile: 'a.json', sourceNodeId: 'sp-9' })

    base.updateSchemaData({ tableName: 'renamed', saveState: 'modified' })
    await nextTick()

    const [, patch] = updateNodeDataMock.mock.calls[0]
    expect(patch.tableName).toBe('renamed')
    expect(patch.saveState).toBe('modified')
    expect(patch.sourceFile).toBe('a.json')
    expect(patch.sourceNodeId).toBe('sp-9')
  })
})
