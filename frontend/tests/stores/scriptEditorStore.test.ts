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
import { useScriptEditorStore } from '@/stores/scriptEditorStore'

describe('scriptEditorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initial state is hidden with null nodeId', () => {
    const store = useScriptEditorStore()
    expect(store.visible).toBe(false)
    expect(store.nodeId).toBeNull()
  })

  it('open sets nodeId and makes visible', () => {
    const store = useScriptEditorStore()
    store.open('node-123')
    expect(store.visible).toBe(true)
    expect(store.nodeId).toBe('node-123')
  })

  it('close hides editor and clears nodeId', () => {
    const store = useScriptEditorStore()
    store.open('node-456')
    store.close()
    expect(store.visible).toBe(false)
    expect(store.nodeId).toBeNull()
  })
})
