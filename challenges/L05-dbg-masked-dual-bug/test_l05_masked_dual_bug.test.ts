/**
 * L05 注入测试 — "清空画布 → 撤销"链的行为测试（A：清空入历史；B：撤销后数据源索引一致）。
 *
 * 本文件由 challenges/L05-dbg-masked-dual-bug/verify.mjs 在评分期间临时复制到
 * frontend/tests/stores/graphStore/，跑完即删。禁止修改本文件。
 *
 * 前置：故障已由 plant.py 注入（A: clearCanvas 未 saveState；B: undo/redo 不重建
 * schemaSourceIndex）。测试用真实 assembly 装配图 store（最小外部 mock），行为断言。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
  addEdges: vi.fn(),
  removeNodes: vi.fn(),
  removeEdges: vi.fn(),
  updateNode: vi.fn(),
  initVueFlowApi: vi.fn(),
}))

import { createGraphStoreState } from '@/stores/graphStore/setup/state'
import { createGraphStoreComputed } from '@/stores/graphStore/setup/computed'
import { createGraphStoreAssembly } from '@/stores/graphStore/setup/assembly'
import type { ProjectStoreLike, ResourceTreeStoreLike } from '@/types/storeInterfaces'
import type { ResourceItem } from '@/types/resource'

function makeMinimalProjectStore(): ProjectStoreLike {
  return {
    currentPaths: null,
    isProjectActive: false,
    setProjectPaths: () => {},
    clearProject: () => {},
  }
}

function makeMinimalResourceTreeStore(): ResourceTreeStoreLike {
  return {
    getResourceById: (): ResourceItem | undefined => undefined,
    clear: () => {},
  }
}

function makeSchemaNode(id: string, localPath: string): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: id,
      tableName: id,
      sheetName: null,
      columns: [],
      saveState: 'draft',
      localPath,
    } as CustomNodeData,
  } as CustomNode
}

const SOURCE_PATH = '/data/orders.csv'

function makeStore() {
  const state = createGraphStoreState()
  const computed = createGraphStoreComputed(state)
  return createGraphStoreAssembly(state, computed, makeMinimalProjectStore(), makeMinimalResourceTreeStore())
}

async function settle() {
  // undo/redo 内部经 nextTick + reconcileAll 回写状态，再排空微任务保证断言时机
  await nextTick()
  await nextTick()
}

describe('l05 清空-撤销链', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  it('l05-a1-clear-records-history：清空画布必须进入撤销栈（saveState）', () => {
    store.nodes.value = [makeSchemaNode('sch-1', SOURCE_PATH)]
    store.clearCanvas()

    expect(store.undoStack.value.length).toBe(1)
  })

  it('l05-a2-undo-restores-canvas：撤销应恢复清空前一刻的完整画布', async () => {
    store.nodes.value = [
      makeSchemaNode('sch-1', SOURCE_PATH),
      makeSchemaNode('sch-2', '/data/other.csv'),
    ]
    store.clearCanvas()
    expect(store.nodes.value).toHaveLength(0)

    await store.undo()
    await settle()

    expect(store.nodes.value).toHaveLength(2)
    const ids = store.nodes.value.map((n) => n.id).sort()
    expect(ids).toEqual(['sch-1', 'sch-2'])
  })

  it('l05-b1-index-consistent-after-undo：撤销恢复出的 Schema 节点必须回到数据源索引（2 分）', async () => {
    store.nodes.value = [makeSchemaNode('sch-1', SOURCE_PATH)]
    store.clearCanvas()
    await store.undo()
    await settle()

    const found = store.schemaSourceIndex.findNodeIdBySource(SOURCE_PATH, null)
    expect(found).toBe('sch-1')
  })

  it('l05-b2-duplicate-detection-after-undo：撤销后重复源冲突检测必须恢复生效（1 分）', async () => {
    store.nodes.value = [makeSchemaNode('sch-1', SOURCE_PATH), makeSchemaNode('sch-2', SOURCE_PATH)]
    store.clearCanvas()
    await store.undo()
    await settle()

    // 索引应包含恢复出的两个同源节点 → 重复检测返回 true。
    // 索引过期（缓存停在清空后的空表）时返回 false → 本题 B 缺陷。
    expect(store.schemaSourceIndex.isDuplicateSource(SOURCE_PATH, null)).toBe(true)
  })
})
