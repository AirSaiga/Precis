import { createGraphStoreState } from './state'
import { createGraphStoreComputed } from './computed'
import { createGraphStoreAssembly } from './assembly'
import { useProjectStore } from '@/stores/projectStore'
import { useResourceTreeStore } from '@/stores/resourceTreeStore'

export function setupGraphStore() {
  const state = createGraphStoreState()
  const computed = createGraphStoreComputed(state)
  const projectStore = useProjectStore()
  const resourceTreeStore = useResourceTreeStore()
  const store = createGraphStoreAssembly(state, computed, projectStore, resourceTreeStore)
  return store
}
