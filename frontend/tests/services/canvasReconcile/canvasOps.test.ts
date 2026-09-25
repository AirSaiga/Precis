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
 * @fileoverview canvasOps 单元测试：防抖 fitView 的并集聚合与窗口行为、
 * 画布未就绪守卫
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => {
  class VueFlowApiNotInitializedError extends Error {
    constructor(message = 'VueFlow API not initialized') {
      super(message)
      this.name = 'VueFlowApiNotInitializedError'
    }
  }
  return { fitView: vi.fn(), findNode: vi.fn(), loggerWarn: vi.fn(), VueFlowApiNotInitializedError }
})

// 注意：mock 必须导出 VueFlowApiNotInitializedError（运行时 instanceof 依赖同一 class 引用）
vi.mock('@/services/canvas/vueFlowApi', () => ({
  fitView: mocks.fitView,
  findNode: mocks.findNode,
  VueFlowApiNotInitializedError: mocks.VueFlowApiNotInitializedError,
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { warn: mocks.loggerWarn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { debouncedFitView, computePlacementPosition } from '@/services/canvasReconcile/canvasOps'

describe('debouncedFitView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.fitView.mockClear()
    mocks.loggerWarn.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('防抖窗口内多次调用只 fitView 一次', () => {
    debouncedFitView(['a'])
    debouncedFitView(['b'])
    debouncedFitView(['c'])

    expect(mocks.fitView).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(mocks.fitView).toHaveBeenCalledTimes(1)
  })

  it('多次调用的 nodes 取并集，而非覆盖（schema + 子约束不应只框 schema）', () => {
    debouncedFitView(['c1'])
    debouncedFitView(['schema', 'c1', 'c2'])

    vi.advanceTimersByTime(500)
    expect(mocks.fitView).toHaveBeenCalledTimes(1)
    const calledNodes = mocks.fitView.mock.calls[0][0].nodes as string[]
    expect(calledNodes.sort()).toEqual(['c1', 'c2', 'schema'])
  })

  it('防抖窗口结束后再次调用会触发新的 fitView', () => {
    debouncedFitView(['a'])
    vi.advanceTimersByTime(500)
    expect(mocks.fitView).toHaveBeenCalledTimes(1)

    debouncedFitView(['b'])
    vi.advanceTimersByTime(500)
    expect(mocks.fitView).toHaveBeenCalledTimes(2)
  })
})

describe('computePlacementPosition', () => {
  it('空画布回退默认落点', () => {
    expect(computePlacementPosition({ nodes: [] })).toEqual({ x: 100, y: 100 })
  })

  it('有节点时放在最大坐标右外侧（连续调用自然错开）', () => {
    const pos1 = computePlacementPosition({ nodes: [{ position: { x: 200, y: 50 } }] })
    expect(pos1).toEqual({ x: 600, y: 50 })
    // 落点并入节点集后，下一次落点继续右移
    const pos2 = computePlacementPosition({
      nodes: [{ position: { x: 200, y: 50 } }, { position: { x: pos1.x, y: pos1.y } }],
    })
    expect(pos2.x).toBe(1000)
  })
})
