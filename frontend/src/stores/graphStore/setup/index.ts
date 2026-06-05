import { createGraphStoreState } from './state'
import { createGraphStoreComputed } from './computed'
import { createGraphStoreAssembly } from './assembly'

export function setupGraphStore() {
  const state = createGraphStoreState()
  const computed = createGraphStoreComputed(state)
  const store = createGraphStoreAssembly(state, computed)
  return store
}
