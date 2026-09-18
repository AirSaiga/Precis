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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  // canvasStore 经 useGlobalConfirm 间接引入 src/i18n/index.ts，后者顶层调用 createI18n
  createI18n: () => ({ global: { t: (key: string) => key } }),
}))

describe('canvasStore zoom operations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initial zoom level is 1', () => {
    const store = useCanvasStore()
    expect(store.zoomLevel).toBe(1)
  })

  it('zoomIn increases zoom level', () => {
    const store = useCanvasStore()
    store.zoomIn()
    expect(store.zoomLevel).toBeGreaterThan(1)
  })

  it('zoomOut decreases zoom level', () => {
    const store = useCanvasStore()
    store.zoomOut()
    expect(store.zoomLevel).toBeLessThan(1)
  })

  it('resetZoom restores zoom to 1', () => {
    const store = useCanvasStore()
    store.setZoomLevel(3)
    store.resetZoom()
    expect(store.zoomLevel).toBe(1)
  })

  it('fitView sets zoom to 1', () => {
    const store = useCanvasStore()
    store.setZoomLevel(2)
    store.fitView()
    expect(store.zoomLevel).toBe(1)
  })

  it('centerView sets zoom to 1', () => {
    const store = useCanvasStore()
    store.setZoomLevel(2)
    store.centerView()
    expect(store.zoomLevel).toBe(1)
  })

  it('setZoomLevel clamps to max 5', () => {
    const store = useCanvasStore()
    store.setZoomLevel(10)
    expect(store.zoomLevel).toBe(5)
  })

  it('setZoomLevel clamps to min 0.1', () => {
    const store = useCanvasStore()
    store.setZoomLevel(0.01)
    expect(store.zoomLevel).toBe(0.1)
  })

  it('toggleMinimap toggles boolean', () => {
    const store = useCanvasStore()
    expect(store.showMinimap).toBe(false)
    store.toggleMinimap()
    expect(store.showMinimap).toBe(true)
    store.toggleMinimap()
    expect(store.showMinimap).toBe(false)
  })
})

describe('canvasStore workspace management', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initial workspaces is empty', () => {
    const store = useCanvasStore()
    expect(store.workspaces).toEqual([])
    expect(store.activeWorkspaceId).toBeNull()
  })

  it('createNewWorkspace adds a workspace', () => {
    const store = useCanvasStore()
    const id = store.createNewWorkspace()
    expect(store.workspaces.length).toBe(1)
    expect(store.workspaces[0].id).toBe(id)
    expect(store.activeWorkspaceId).toBe(id)
  })

  it('activeWorkspace returns current workspace', () => {
    const store = useCanvasStore()
    store.createNewWorkspace()
    expect(store.activeWorkspace).toBeDefined()
    expect(store.activeWorkspace!.id).toBe(store.activeWorkspaceId)
  })

  it('markWorkspaceSaved sets hasUnsavedChanges to false', () => {
    const store = useCanvasStore()
    const id = store.createNewWorkspace()
    store.markWorkspaceSaved(id)
    expect(store.workspaces[0].hasUnsavedChanges).toBe(false)
  })

  it('markWorkspaceDirty sets hasUnsavedChanges to true', () => {
    const store = useCanvasStore()
    const id = store.createNewWorkspace()
    store.markWorkspaceSaved(id)
    store.markWorkspaceDirty(id)
    expect(store.workspaces[0].hasUnsavedChanges).toBe(true)
  })

  it('unsavedWorkspacesCount counts dirty workspaces', () => {
    const store = useCanvasStore()
    const id1 = store.createNewWorkspace()
    store.createNewWorkspace()
    store.markWorkspaceSaved(id1)
    expect(store.unsavedWorkspacesCount).toBe(1)
  })

  it('saveAllWorkspaces marks all as saved', () => {
    const store = useCanvasStore()
    store.createNewWorkspace()
    store.createNewWorkspace()
    store.saveAllWorkspaces()
    expect(store.workspaces.every((w) => !w.hasUnsavedChanges)).toBe(true)
  })

  it('renameWorkspace changes title', () => {
    const store = useCanvasStore()
    const id = store.createNewWorkspace()
    store.renameWorkspace(id, 'Custom Name')
    expect(store.workspaces[0].title).toBe('Custom Name')
  })

  it('getWorkspaceList returns workspaces array', () => {
    const store = useCanvasStore()
    store.createNewWorkspace()
    expect(store.getWorkspaceList().length).toBe(1)
  })

  it('reorderWorkspaces updates order', () => {
    const store = useCanvasStore()
    const id1 = store.createNewWorkspace()
    const id2 = store.createNewWorkspace()
    const reversed = [...store.workspaces].reverse()
    store.reorderWorkspaces(reversed)
    expect(store.workspaces[0].id).toBe(id2)
    expect(store.workspaces[1].id).toBe(id1)
  })
})

describe('canvasStore removeNodesFromAllWorkspaces', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function makeNode(id: string): CustomNode {
    return { id, type: 'schema', position: { x: 0, y: 0 }, data: {} } as CustomNode
  }

  function makeEdge(id: string, source: string, target: string): Edge {
    return { id, source, target }
  }

  it('非活跃工作区：删除匹配节点及其关联边，其余边保留', () => {
    const store = useCanvasStore()
    const inactiveId = store.createNewWorkspace()
    store.createNewWorkspace() // 第二个为当前活跃工作区

    const inactive = store.workspaces.find((w) => w.id === inactiveId)!
    inactive.nodes = [makeNode('n1'), makeNode('n2')]
    inactive.edges = [
      makeEdge('e1', 'n1', 'n2'), // 关联被删节点 → 应删
      makeEdge('e2', 'n2', 'n3'), // 两端均不被删 → 应保留
    ]

    const deleteNodes = vi.fn()
    store.removeNodesFromAllWorkspaces((n) => n.id === 'n1', {
      nodes: [],
      edges: [],
      deleteNodes,
    })

    expect(inactive.nodes!.map((n) => n.id)).toEqual(['n2'])
    expect(inactive.edges!.map((e) => e.id)).toEqual(['e2'])
    // 活跃工作区无匹配节点，不触发 deleteNodes
    expect(deleteNodes).not.toHaveBeenCalled()
  })

  it('非活跃工作区：两端都被删除的边一并移除', () => {
    const store = useCanvasStore()
    const inactiveId = store.createNewWorkspace()
    store.createNewWorkspace()

    const inactive = store.workspaces.find((w) => w.id === inactiveId)!
    inactive.nodes = [makeNode('n1'), makeNode('n2'), makeNode('keep')]
    inactive.edges = [
      makeEdge('e1', 'n1', 'n2'), // 两端均删 → 应删
      makeEdge('e2', 'keep', 'n1'), // 一端被删 → 应删
      makeEdge('e3', 'keep', 'keep'), // 保留
    ]

    store.removeNodesFromAllWorkspaces((n) => n.id !== 'keep', {
      nodes: [],
      edges: [],
      deleteNodes: vi.fn(),
    })

    expect(inactive.nodes!.map((n) => n.id)).toEqual(['keep'])
    expect(inactive.edges!.map((e) => e.id)).toEqual(['e3'])
  })

  it('活跃工作区：委托 graphStore.deleteNodes 走 Vue Flow 增量删除', () => {
    const store = useCanvasStore()
    store.createNewWorkspace()

    const deleteNodes = vi.fn()
    store.removeNodesFromAllWorkspaces(() => true, {
      nodes: [makeNode('a1')],
      edges: [],
      deleteNodes,
    })

    expect(deleteNodes).toHaveBeenCalledWith(['a1'])
  })
})
