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
 * - 三开关（nodeAdd/nodeDelete/connectionChange）各自独立映射进 triggerOn
 * - 自动整理经 organizeNodes({ fitViewAfter: false }) 关闭整理后取景
 * - contentLoadedEpoch 变化（加载完成）取消防抖窗口内的整理（与加载适配互斥）
 * - 实例化时按持久化设置值启动（watcher 只响应变化）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, effectScope } from 'vue'
import type { CustomNode } from '@/types/graph'

const mocks = vi.hoisted(() => ({
  organizeNodes: vi.fn(),
}))

// mock 模块经 __testState 导出共享的响应式状态（测试内直接改值驱动 watcher）
vi.mock('@/stores/settingsStore', async () => {
  const { reactive } = await import('vue')
  const state = reactive({
    autoOrganizeOnNodeAdd: false,
    autoOrganizeOnNodeDelete: false,
    autoOrganizeOnConnectionChange: false,
  })
  return { useSettingsStore: () => state, __testState: state }
})

vi.mock('@/stores/graphStore', async () => {
  const { reactive } = await import('vue')
  const state = reactive({ nodes: [] as CustomNode[], edges: [] as unknown[] })
  return { useGraphStore: () => state, __testState: state }
})

vi.mock('@/stores/canvasStore', async () => {
  const { reactive } = await import('vue')
  const state = reactive({ contentLoadedEpoch: 0 })
  return { useCanvasStore: () => state, __testState: state }
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
import { __testState as canvasState } from '@/stores/canvasStore'

function makeNode(id: string): CustomNode {
  return { id, type: 'schema', position: { x: 0, y: 0 }, data: {} } as CustomNode
}

/** 复位共享设置/图状态（经设置 watcher 联动停掉所有存活实例的图 watchers） */
function resetSharedState(): void {
  settingsState.autoOrganizeOnNodeAdd = false
  settingsState.autoOrganizeOnNodeDelete = false
  settingsState.autoOrganizeOnConnectionChange = false
  graphState.nodes = []
  graphState.edges = []
}

describe('useAutoOrganize watcher 生命周期', () => {
  const auto = useAutoOrganize()

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.organizeNodes.mockReset()
    // 统一复位：显式停止（幂等）+ 设置开关回 false，保证各用例间 watcher 状态干净
    auto.stopAutoOrganize()
    resetSharedState()
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

describe('useAutoOrganize 三开关映射进 triggerOn', () => {
  // 收集阶段设置全 false → 实例化时保持停止；用例内改设置经 watcher 启动
  const auto = useAutoOrganize()

  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.organizeNodes.mockReset()
    auto.stopAutoOrganize()
    resetSharedState()
    await nextTick()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('只开"添加时整理"：节点新增触发整理、节点删除不触发', async () => {
    settingsState.autoOrganizeOnNodeAdd = true
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)
    expect([...auto.triggerEvents.value]).toEqual(['nodeAdd'])

    graphState.nodes.push(makeNode('n1'))
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).toHaveBeenCalled()

    mocks.organizeNodes.mockReset()
    graphState.nodes.pop()
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()
  })

  it('只开"删除时整理"：节点删除触发整理、节点新增不触发', async () => {
    settingsState.autoOrganizeOnNodeDelete = true
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)
    expect([...auto.triggerEvents.value]).toEqual(['nodeDelete'])

    graphState.nodes.push(makeNode('n1'))
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()

    graphState.nodes.pop()
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).toHaveBeenCalled()
  })

  it('只开"连线变化时整理"：节点增删不触发、边变化触发', async () => {
    settingsState.autoOrganizeOnConnectionChange = true
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)
    expect([...auto.triggerEvents.value]).toEqual(['connectionChange'])

    graphState.nodes.push(makeNode('n1'))
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()

    graphState.edges.push({ id: 'e1', source: 'a', target: 'b' })
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).toHaveBeenCalled()
  })

  it('三开关全关时经设置联动停止（运行中关闭全部开关）', async () => {
    settingsState.autoOrganizeOnNodeAdd = true
    settingsState.autoOrganizeOnConnectionChange = true
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)

    settingsState.autoOrganizeOnNodeAdd = false
    settingsState.autoOrganizeOnConnectionChange = false
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(false)

    graphState.nodes.push(makeNode('n1'))
    graphState.edges.push({ id: 'e1', source: 'a', target: 'b' })
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()
  })
})

describe('useAutoOrganize 整理行为', () => {
  const auto = useAutoOrganize()

  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.organizeNodes.mockReset()
    auto.stopAutoOrganize()
    resetSharedState()
    await nextTick()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('自动整理关闭整理后取景：organizeNodes 以 fitViewAfter: false 调用', async () => {
    settingsState.autoOrganizeOnNodeAdd = true
    await nextTick()

    graphState.nodes.push(makeNode('n1'))
    await nextTick()
    vi.advanceTimersByTime(1000)

    expect(mocks.organizeNodes).toHaveBeenCalledWith({ fitViewAfter: false })
  })

  it('contentLoadedEpoch 变化（加载完成）取消防抖窗口内的整理（与加载适配互斥）', async () => {
    settingsState.autoOrganizeOnNodeAdd = true
    await nextTick()

    // 加载链路节点替换误触发的防抖，被随后的加载完成信号取消
    graphState.nodes.push(makeNode('n1'))
    await nextTick()
    canvasState.contentLoadedEpoch++
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()

    // 正向对照：加载完成后的常规节点新增照常触发
    graphState.nodes.push(makeNode('n2'))
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).toHaveBeenCalled()
  })
})

describe('useAutoOrganize 实例化启动', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.organizeNodes.mockReset()
    resetSharedState()
    await nextTick()
  })

  afterEach(async () => {
    // 复位共享设置：经设置 watcher 联动停掉本用例创建的实例，避免跨用例污染
    resetSharedState()
    await nextTick()
    vi.useRealTimers()
  })

  it('实例化时设置全关 → 保持停止', () => {
    const auto = useAutoOrganize()
    expect(auto.isAutoOrganizeEnabled.value).toBe(false)

    graphState.nodes.push(makeNode('n1'))
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()
  })

  it('实例化时按持久化值启动：开关已开则直接运行，触发集合与开关映射一致', async () => {
    settingsState.autoOrganizeOnNodeAdd = true
    settingsState.autoOrganizeOnConnectionChange = true

    const auto = useAutoOrganize()
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)
    expect([...auto.triggerEvents.value]).toEqual(['nodeAdd', 'connectionChange'])

    // 无需手动 start：节点新增即走防抖整理
    graphState.nodes.push(makeNode('n1'))
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).toHaveBeenCalled()
  })
})

describe('useAutoOrganize 卸载清理（onScopeDispose）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.organizeNodes.mockReset()
    resetSharedState()
  })

  afterEach(() => {
    resetSharedState()
    vi.useRealTimers()
  })

  it('scope 销毁后孤儿图 watcher 与 settings watcher 全部停止（布局切换重挂不泄漏）', async () => {
    // 组件 setup 语义：effectScope 内实例化（NodeCanvas 卸载 = scope.stop）。
    // 手动 start（不经设置开关联动）：共享 mock 状态会同时唤醒其他 describe
    // 的顶层实例，污染 organizeNodes 调用归属
    const scope = effectScope()
    const auto = scope.run(() => useAutoOrganize())!
    auto.startAutoOrganize({ debounceMs: 100 })
    expect(auto.isAutoOrganizeEnabled.value).toBe(true)

    scope.stop()

    // 图 watcher 已随 scope 停止：节点变化不再触发整理（此刻无其他活跃实例）
    graphState.nodes.push(makeNode('leak-1'))
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(mocks.organizeNodes).not.toHaveBeenCalled()

    // settings watcher 也已停止：再拨开关不会在死实例上复活整理
    settingsState.autoOrganizeOnNodeDelete = true
    await nextTick()
    expect(auto.isAutoOrganizeEnabled.value).toBe(false)
  })
})
