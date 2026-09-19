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
 * @fileoverview Composite 约束 handler 单元测试
 *
 * 覆盖 §3.7（B1 批次）：resetOnDisconnect 只重置校验状态，
 * 不得清空用户勾选的 includedNodeIds（其余 9 种 handler 同语义对照）。
 */

import { describe, it, expect } from 'vitest'
import '@/services/constraints/validationRegistryHandlers/compositeHandler'
import { getHandlerByNodeType } from '@/services/constraints/validationRegistryCore'

describe('compositeHandler - resetOnDisconnect', () => {
  it('reset 保留 includedNodeIds，仅重置校验状态', () => {
    const handler = getHandlerByNodeType('compositeConstraint')
    expect(handler).toBeDefined()

    const reset = handler!.resetOnDisconnect({
      configName: '复合约束',
      includedNodeIds: ['node-a', 'node-b'],
      logic: 'all',
      validationStatus: 'fail',
      validationErrors: ['旧错误'],
    } as Parameters<NonNullable<typeof handler>['resetOnDisconnect']>[0])

    // 用户勾选的聚合成员必须保留（原实现被清空 → 周期性销毁用户配置）
    expect((reset as Record<string, unknown>).includedNodeIds).toEqual(['node-a', 'node-b'])
    // 校验状态重置为 idle
    expect((reset as Record<string, unknown>).validationStatus).toBe('idle')
  })

  it('reset 不引入额外字段破坏其他配置', () => {
    const handler = getHandlerByNodeType('compositeConstraint')
    const reset = handler!.resetOnDisconnect({
      configName: '复合约束',
      includedNodeIds: [],
      logic: 'any',
      validationStatus: 'fail',
    } as Parameters<NonNullable<typeof handler>['resetOnDisconnect']>[0])

    const data = reset as Record<string, unknown>
    expect(data.includedNodeIds).toEqual([])
    expect(data.logic).toBe('any')
    expect(data.configName).toBe('复合约束')
  })
})
