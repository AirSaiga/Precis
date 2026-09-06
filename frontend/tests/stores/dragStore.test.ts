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
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDragStore, type DragEventPayload } from '@/stores/dragStore'

describe('dragStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initial state is not dragging', () => {
    const store = useDragStore()
    expect(store.isDragging).toBe(false)
    expect(store.dragPayload).toBeNull()
    expect(store.dragState.isDragging).toBe(false)
  })

  it('startDrag sets dragging state and payload', () => {
    const store = useDragStore()
    const payload: DragEventPayload = {
      type: 'field',
      sourceNodeId: 'node-1',
      fieldName: 'email',
    }
    store.startDrag(payload)
    expect(store.isDragging).toBe(true)
    expect(store.dragPayload).toEqual(payload)
  })

  it('endDrag resets state', () => {
    const store = useDragStore()
    store.startDrag({ type: 'field', sourceNodeId: 'n1', fieldName: 'x' })
    store.endDrag()
    expect(store.isDragging).toBe(false)
    expect(store.dragPayload).toBeNull()
  })

  it('setHoverNode updates hover state', () => {
    const store = useDragStore()
    store.setHoverNode({ id: 'node-2' })
    expect(store.dragState.hoverNode).toEqual({ id: 'node-2' })
  })

  it('setHoverColumn updates hover column', () => {
    const store = useDragStore()
    store.setHoverColumn({ id: 'col-3' })
    expect(store.dragState.hoverColumn).toEqual({ id: 'col-3' })
  })

  it('clearHover resets hover state', () => {
    const store = useDragStore()
    store.setHoverNode({ id: 'n' })
    store.setHoverColumn({ id: 'c' })
    store.clearHover()
    expect(store.dragState.hoverNode).toBeNull()
    expect(store.dragState.hoverColumn).toBeNull()
  })

  it('resetDragState resets everything', () => {
    const store = useDragStore()
    store.startDrag({ type: 'field', sourceNodeId: 'n1', fieldName: 'x' })
    store.setHoverNode({ id: 'n' })
    store.setHoverColumn({ id: 'c' })
    store.resetDragState()
    expect(store.isDragging).toBe(false)
    expect(store.dragPayload).toBeNull()
    expect(store.dragState.hoverNode).toBeNull()
    expect(store.dragState.hoverColumn).toBeNull()
  })
})
