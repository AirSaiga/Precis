import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

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

describe('createGraphStoreAssembly', () => {
  let projectStore: ProjectStoreLike
  let resourceTreeStore: ResourceTreeStoreLike

  beforeEach(() => {
    projectStore = makeMinimalProjectStore()
    resourceTreeStore = makeMinimalResourceTreeStore()
  })

  it('should initialize with only minimal external store mocks', () => {
    const state = createGraphStoreState()
    const computed = createGraphStoreComputed(state)
    const store = createGraphStoreAssembly(state, computed, projectStore, resourceTreeStore)

    expect(store.nodes).toBe(state.nodes)
    expect(store.edges).toBe(state.edges)
    expect(store.isProjectLoaded).toBe(state.isProjectLoaded)
    expect(typeof store.createProject).toBe('function')
    expect(typeof store.clearProject).toBe('function')
    expect(typeof store.importV2ResourceToCanvas).toBe('function')
  })
})
