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
/**
 * @fileoverview focusModeStore 单元测试
 *
 * 覆盖专注模式视图状态行为：
 * - 默认非专注模式且无快照
 * - setFocusMode 切换 + 同值早退
 * - toggleFocus 双向往复
 * - 快照由外部（App.vue 编排）写入 / 读取后清空，store 本身不做恢复编排
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFocusModeStore } from '@/stores/focusModeStore'

describe('focusModeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认非专注模式且无快照', () => {
    const store = useFocusModeStore()
    expect(store.isFocusMode).toBe(false)
    expect(store.snapshot).toBeNull()
  })

  it('setFocusMode(true) 进入专注模式', () => {
    const store = useFocusModeStore()
    store.setFocusMode(true)
    expect(store.isFocusMode).toBe(true)
  })

  it('setFocusMode 同值早退，状态不变', () => {
    const store = useFocusModeStore()
    store.setFocusMode(false)
    expect(store.isFocusMode).toBe(false)
  })

  it('toggleFocus 在专注 / 普通布局间往复', () => {
    const store = useFocusModeStore()
    store.toggleFocus()
    expect(store.isFocusMode).toBe(true)
    store.toggleFocus()
    expect(store.isFocusMode).toBe(false)
  })

  it('快照由外部写入 / 恢复后清空，store 不做恢复编排', () => {
    const store = useFocusModeStore()
    store.setFocusMode(true)
    store.snapshot = {
      activityBarCollapsed: false,
      sidebarCollapsed: true,
      rightCollapsed: false,
      sidebarWidth: 260,
      currentView: 'toolbox',
    }
    expect(store.snapshot?.sidebarWidth).toBe(260)
    expect(store.snapshot?.currentView).toBe('toolbox')

    store.setFocusMode(false)
    expect(store.isFocusMode).toBe(false)
    // 快照读取与清空由外部编排负责，store 不自动清理
    expect(store.snapshot?.sidebarWidth).toBe(260)
    store.snapshot = null
    expect(store.snapshot).toBeNull()
  })
})
