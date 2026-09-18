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
 * @file useAutoOrganize.test.ts
 * @description 自动整理组合式函数单元测试
 *
 * 核心覆盖：
 * - stopAutoOrganize 只拆除图结构 watchers，"设置面板开关 → 启动"的 watcher 存活：
 *   停止后再开启 autoOrganizeOnNodeAdd 设置仍能触发 startAutoOrganize
 * - 停止后节点/边变化不再触发整理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import type { CustomNode } from '@/types/graph'

const mocks = vi.hoisted(() => ({
  organizeNodes: vi.fn(),
}))

// mock 模块经 __testState 导出共享的响应式状态（测试内直接改值驱动 watcher）
vi.mock('@/stores/settingsStore', async () => {
  const { reactive } = await import('vue')
  const state = reactive({ autoOrganizeOnNodeAdd: false })
  return { useSettingsStore: () => state, __testState: state }
})

vi.mock('@/stores/graphStore', async () => {
  const { reactive } = await import('vue')
  const state = reactive({ nodes: [] as CustomNode[], edges: [] as unknown[] })
  return { useGraphStore: () => state, __testState: state }
})

vi.mock('@/features/node-layout-organizer/composables/useNodeOrganizer', () => ({
  useNodeOrganizer: () => ({ organizeNodes: mocks.organizeNodes }),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useAutoOrganize } from '@/features/node-layout-organizer/composables/useAutoOrganize'
import { __testState as settingsState } from '@/stores/settingsStore'
import { __testState as graphState } from '@/stores/graphStore'

function makeNode(id: string): CustomNode {
  return { id, type: 'schema', position: { x: 0, y: 0 }, data: {} } as CustomNode
}

describe('useAutoOrganize watcher 生命周期', () => {
  const auto = useAutoOrganize()

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.organizeNodes.mockReset()
    // 统一复位：显式停止（幂等）+ 设置开关回 false，保证各用例间 watcher 状态干净
    auto.stopAutoOrganize()
    settingsState.autoOrganizeOnNodeAdd = false
    graphState.nodes = []
    graphState.edges = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stopAutoOrganize 后开启设置开关仍能触发 startAutoOrganize（settings watcher 存活）', async () => {
    auto.startAutoOrganize()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)

    auto.stopAutoOrganize()
    expect(auto.isAutoOrganizeEnabled.value).toBe(false)

    // 回归：设置 → 启动 的 watcher 不应随 stopAutoOrganize 被拆除
    settingsState.autoOrganizeOnNodeAdd = true
    await nextTick()

    expect(auto.isAutoOrganizeEnabled.value).toBe(true)
  })

  it('运行中关闭设置开关会停止自动整理', async () => {
    auto.startAutoOrganize()
    settingsState.autoOrganizeOnNodeAdd = true
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)

    settingsState.autoOrganizeOnNodeAdd = false
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(false)
  })

  it('stopAutoOrganize 拆除图 watchers：停止后节点变化不再触发整理', async () => {
    auto.startAutoOrganize({ debounceMs: 100 })

    // 正向对照：运行中节点新增 → 防抖后整理一次
    graphState.nodes.push(makeNode('n1'))
    await nextTick()
    vi.advanceTimersByTime(100)
    expect(mocks.organizeNodes).toHaveBeenCalledTimes(1)

    auto.stopAutoOrganize()
    mocks.organizeNodes.mockReset()

    // 回归：停止后 watcher 已拆除，新增节点不再触发整理
    graphState.nodes.push(makeNode('n2'))
    await nextTick()
    vi.advanceTimersByTime(100)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()

    // 设置面板重新开启 → 恢复启动（settings watcher 存活），图 watcher 重新生效
    settingsState.autoOrganizeOnNodeAdd = true
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)

    mocks.organizeNodes.mockReset()
    graphState.nodes.push(makeNode('n3'))
    await nextTick()
    vi.advanceTimersByTime(100)
    expect(mocks.organizeNodes).toHaveBeenCalledTimes(1)
  })
})
