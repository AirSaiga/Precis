import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useResourceDragStore, type ResourceDragPayload } from '@/stores/resourceDragStore'

describe('resourceDragStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initial state is not dragging with null payload', () => {
    const store = useResourceDragStore()
    expect(store.isDragging).toBe(false)
    expect(store.payload).toBeNull()
    expect(store.state.isDragging).toBe(false)
    expect(store.state.payload).toBeNull()
  })

  it('startDrag sets dragging state and payload', () => {
    const store = useResourceDragStore()
    const payload: ResourceDragPayload = {
      type: 'schema',
      source: 'projectResources',
      meta: { id: 'users' },
    }
    store.startDrag(payload)
    expect(store.isDragging).toBe(true)
    expect(store.payload).toEqual(payload)
  })

  it('endDrag resets dragging state and payload', () => {
    const store = useResourceDragStore()
    store.startDrag({ type: 'pattern', source: 'toolbox' })
    store.endDrag()
    expect(store.isDragging).toBe(false)
    expect(store.payload).toBeNull()
  })
})
