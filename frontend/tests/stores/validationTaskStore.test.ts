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
import { useValidationTaskStore } from '@/stores/validationTaskStore'

describe('validationTaskStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initial state is closed with default target', () => {
    const store = useValidationTaskStore()
    expect(store.visible).toBe(false)
    expect(store.target.type).toBe('full_project')
    // display_name 不再内联中文，渲染层按 locale 走 t() 兜底
    expect(store.target.display_name).toBeUndefined()
  })

  it('open sets target and makes visible', () => {
    const store = useValidationTaskStore()
    store.open({ type: 'single_table', table_id: 'users', display_name: 'Users' })
    expect(store.visible).toBe(true)
    expect(store.target.type).toBe('single_table')
    expect(store.target.table_id).toBe('users')
    expect(store.target.display_name).toBe('Users')
  })

  it('openFullProject sets full project target', () => {
    const store = useValidationTaskStore()
    store.openSingleTable('orders')
    store.openFullProject()
    expect(store.visible).toBe(true)
    expect(store.target.type).toBe('full_project')
    // display_name 不再内联中文，渲染层按 locale 走 t() 兜底
    expect(store.target.display_name).toBeUndefined()
  })

  it('openSingleTable sets single table target', () => {
    const store = useValidationTaskStore()
    store.openSingleTable('users', '用户表')
    expect(store.visible).toBe(true)
    expect(store.target.type).toBe('single_table')
    expect(store.target.table_id).toBe('users')
    expect(store.target.display_name).toBe('用户表')
  })

  it('openSingleTable falls back to tableId when displayName omitted', () => {
    const store = useValidationTaskStore()
    store.openSingleTable('orders')
    expect(store.target.display_name).toBe('orders')
  })

  it('close hides panel', () => {
    const store = useValidationTaskStore()
    store.openFullProject()
    store.close()
    expect(store.visible).toBe(false)
  })
})
