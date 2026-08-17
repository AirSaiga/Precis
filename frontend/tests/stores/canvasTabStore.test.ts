/**
 * @fileoverview canvasTabStore 单元测试
 *
 * 重点回归（Tab 快照数据丢失修复）：
 * - initialize 恢复激活 Tab 的上次会话画布（含实质内容时）
 * - 仅含 projectRoot 的快照不覆盖刚加载的项目状态
 * - setActiveTab 同 Tab 早退，不触发保存/重置/PUT 全流程
 * - 恢复快照时剥离 selected 标志（防幽灵选中）
 * - syncTabsToBackend 成功后清除全部脏标记
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Edge } from '@vue-flow/core'
import { useCanvasTabStore, type CanvasTab } from '@/stores/canvasTabStore'
import type { CustomNode } from '@/types/graph'
import { getV2Workspaces, putV2Workspaces } from '@/api/projectV2Api'
import { useProjectStore } from '@/stores/projectStore'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  createI18n: () => ({ global: { t: (key: string) => key } }),
}))

vi.mock('@/api/projectV2Api', () => ({
  getV2Workspaces: vi.fn(),
  putV2Workspaces: vi.fn(),
}))

vi.mock('@/composables/useGlobalConfirm', () => ({
  useGlobalConfirm: () => ({ showConfirm: vi.fn().mockResolvedValue(true) }),
}))

function makeNode(id: string, type = 'schema', selected = false): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {},
    selected,
  } as unknown as CustomNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

/** 最小 GraphStoreLike mock：getter 暴露内部画布状态，记录调用计数 */
function makeGraphStoreSpy() {
  const state = {
    nodes: [] as CustomNode[],
    edges: [] as Edge[],
    isProjectLoaded: true,
  }
  return {
    get nodes() {
      return state.nodes
    },
    set nodes(v: CustomNode[]) {
      state.nodes = v
    },
    get edges() {
      return state.edges
    },
    set edges(v: Edge[]) {
      state.edges = v
    },
    isProjectLoaded: state.isProjectLoaded,
    resetCanvas: vi.fn(() => {
      state.nodes = []
      state.edges = []
    }),
    reconcileAll: vi.fn(async () => {}),
    createProjectRootNode: vi.fn(() => 'project-root'),
  }
}

describe('canvasTabStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const projectStore = useProjectStore()
    projectStore.setProjectPaths({ configPath: '/proj', dataPath: '/proj' })
    vi.mocked(putV2Workspaces).mockResolvedValue({} as never)
  })

  describe('initialize 恢复激活 Tab 画布', () => {
    it('激活 Tab 快照含实质内容时恢复 nodes/edges（含 projectRoot 时不清除）', async () => {
      const savedNodes = [makeNode('project-root', 'projectRoot'), makeNode('schema-1', 'schema')]
      const savedEdges = [makeEdge('e1', 'schema-1', 'c1')]
      vi.mocked(getV2Workspaces).mockResolvedValue({
        workspaces: [
          {
            id: 'tab-1',
            index: 1,
            title: 'W1',
            createdAt: '2026-01-01T00:00:00Z',
            lastActiveAt: '2026-01-01T00:00:00Z',
            nodes: savedNodes,
            edges: savedEdges,
          },
        ],
        activeWorkspaceId: 'tab-1',
      } as never)

      const gs = makeGraphStoreSpy()
      const store = useCanvasTabStore()
      await store.initialize('/proj', gs as never)

      // 恢复了快照内容（resetCanvas 后写入快照数据）
      expect(gs.resetCanvas).toHaveBeenCalledTimes(1)
      expect(gs.nodes.map((n) => n.id)).toEqual(['project-root', 'schema-1'])
      expect(gs.edges).toHaveLength(1)
      expect(gs.reconcileAll).toHaveBeenCalled()
    })

    it('快照仅含 projectRoot（无实质内容）时不覆盖当前画布', async () => {
      vi.mocked(getV2Workspaces).mockResolvedValue({
        workspaces: [
          {
            id: 'tab-1',
            index: 1,
            title: 'W1',
            createdAt: '2026-01-01T00:00:00Z',
            lastActiveAt: '2026-01-01T00:00:00Z',
            nodes: [makeNode('project-root', 'projectRoot')],
            edges: [],
          },
        ],
        activeWorkspaceId: 'tab-1',
      } as never)

      const gs = makeGraphStoreSpy()
      gs.nodes.push(
        makeNode('project-root', 'projectRoot'),
        makeNode('template-1', 'templateInstance')
      )

      const store = useCanvasTabStore()
      await store.initialize('/proj', gs as never)

      // 不触发重置，loadProjectFromV2 构建的启动画布保持原样
      expect(gs.resetCanvas).not.toHaveBeenCalled()
      expect(gs.nodes.map((n) => n.id)).toContain('template-1')
    })

    it('恢复时剥离快照节点的 selected 标志（防幽灵选中）', async () => {
      vi.mocked(getV2Workspaces).mockResolvedValue({
        workspaces: [
          {
            id: 'tab-1',
            index: 1,
            title: 'W1',
            createdAt: '2026-01-01T00:00:00Z',
            lastActiveAt: '2026-01-01T00:00:00Z',
            nodes: [makeNode('schema-1', 'schema', true), makeNode('schema-2', 'schema')],
            edges: [],
          },
        ],
        activeWorkspaceId: 'tab-1',
      } as never)

      const gs = makeGraphStoreSpy()
      const store = useCanvasTabStore()
      await store.initialize('/proj', gs as never)

      expect(gs.nodes.every((n) => n.selected !== true)).toBe(true)
    })
  })

  describe('setActiveTab', () => {
    function seedTwoTabs(): CanvasTab[] {
      return [
        {
          id: 'tab-1',
          index: 1,
          title: 'W1',
          icon: 'image',
          hasUnsavedChanges: false,
          createdAt: '2026-01-01T00:00:00Z',
          lastActiveAt: '2026-01-01T00:00:00Z',
          nodes: [makeNode('schema-1')],
          edges: [],
        },
        {
          id: 'tab-2',
          index: 2,
          title: 'W2',
          icon: 'image',
          hasUnsavedChanges: false,
          createdAt: '2026-01-01T00:00:00Z',
          lastActiveAt: '2026-01-01T00:00:00Z',
          nodes: [makeNode('schema-2')],
          edges: [],
        },
      ]
    }

    it('重复点击当前激活 Tab 早退：不重置画布、不 PUT', async () => {
      const store = useCanvasTabStore()
      store.tabs = seedTwoTabs()
      store.activeTabId = 'tab-1'

      const gs = makeGraphStoreSpy()
      gs.nodes.push(makeNode('schema-1'))

      await store.setActiveTab('tab-1', gs as never)

      expect(gs.resetCanvas).not.toHaveBeenCalled()
      expect(putV2Workspaces).not.toHaveBeenCalled()
      expect(store.activeTabId).toBe('tab-1')
    })

    it('切换 Tab：离开 Tab 快照被保存、目标 Tab 数据被恢复', async () => {
      const store = useCanvasTabStore()
      store.tabs = seedTwoTabs()
      store.activeTabId = 'tab-1'

      const gs = makeGraphStoreSpy()
      gs.nodes.push(makeNode('schema-live'))

      await store.setActiveTab('tab-2', gs as never)

      // tab-1 保存了离开时的画布
      const tab1 = store.tabs.find((w) => w.id === 'tab-1')
      expect(tab1?.nodes?.map((n) => n.id)).toContain('schema-live')
      // 画布恢复为 tab-2 的内容
      expect(gs.nodes.map((n) => n.id)).toEqual(['schema-2'])
      expect(store.activeTabId).toBe('tab-2')
    })
  })

  describe('syncTabsToBackend 清除脏标记', () => {
    it('PUT 成功后全部 Tab 脏标记清除', async () => {
      const store = useCanvasTabStore()
      store.tabs = seedTwoTabsLocal(store)

      await store.syncTabsToBackend()

      expect(putV2Workspaces).toHaveBeenCalledTimes(1)
      expect(store.tabs.every((w) => !w.hasUnsavedChanges)).toBe(true)
    })

    it('PUT 失败时保留脏标记（关闭确认仍能兜底）', async () => {
      vi.mocked(putV2Workspaces).mockRejectedValue(new Error('network down'))
      const store = useCanvasTabStore()
      store.tabs = seedTwoTabsLocal(store)

      await store.syncTabsToBackend()

      expect(store.tabs.every((w) => w.hasUnsavedChanges)).toBe(true)
    })

    function seedTwoTabsLocal(store: ReturnType<typeof useCanvasTabStore>): CanvasTab[] {
      const tabs = [
        {
          id: 'tab-1',
          index: 1,
          title: 'W1',
          icon: 'image',
          hasUnsavedChanges: true,
          createdAt: '2026-01-01T00:00:00Z',
          lastActiveAt: '2026-01-01T00:00:00Z',
          nodes: [makeNode('schema-1')],
          edges: [],
        },
        {
          id: 'tab-2',
          index: 2,
          title: 'W2',
          icon: 'image',
          hasUnsavedChanges: true,
          createdAt: '2026-01-01T00:00:00Z',
          lastActiveAt: '2026-01-01T00:00:00Z',
          nodes: [],
          edges: [],
        },
      ]
      store.tabs = tabs
      return tabs
    }
  })
})
