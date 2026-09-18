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
 * @file connectionOps.test.ts
 * @description AI 指令连接解析工具单元测试
 *
 * 核心覆盖：
 * - templateInstance 无输入 handle 且 connectionRules 无对应规则，
 *   resolveTargetHandle 须落 default 返回 undefined（此前返回幻觉 handle `template-input`，
 *   该 handle 全库不存在，导致建边必被连接验证器拒绝）
 * - 其余节点类型的 handle 解析保持既有契约
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node as VueFlowNode } from '@vue-flow/core'

const mocks = vi.hoisted(() => ({
  validateConnection: vi.fn(),
  addEdges: vi.fn(),
}))

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: mocks.addEdges,
  addNodes: vi.fn(),
  removeNodes: vi.fn(),
  fitView: vi.fn(),
  findNode: vi.fn(),
}))

vi.mock('@/composables/validation/useConnectionValidator', () => ({
  useConnectionValidator: vi.fn(() => ({ validateConnection: mocks.validateConnection })),
}))

import {
  resolveTargetHandle,
  addValidatedAIConnection,
} from '@/services/aiChatInstructions/connectionOps'

function makeNode(id: string, type: string): VueFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: {} } as VueFlowNode
}

describe('resolveTargetHandle', () => {
  it('templateInstance 落 default 返回 undefined（无输入 handle 的幻觉 case 已移除）', () => {
    expect(resolveTargetHandle(makeNode('t1', 'templateInstance'))).toBeUndefined()
  })

  it('regex / transform 使用固定输入 handle', () => {
    expect(resolveTargetHandle(makeNode('r1', 'regex'))).toBe('regex-input')
    expect(resolveTargetHandle(makeNode('t1', 'transform'))).toBe('transform-input')
  })

  it('schema / jsonSchema / manualData / transformOutput / compositeConstraint 使用 target-left', () => {
    for (const type of ['schema', 'jsonSchema', 'manualData', 'transformOutput']) {
      expect(resolveTargetHandle(makeNode('n1', type))).toBe('target-left')
    }
    expect(resolveTargetHandle(makeNode('c1', 'compositeConstraint'))).toBe('target-left')
  })

  it('其他约束节点使用 target-input-{nodeId}', () => {
    expect(resolveTargetHandle(makeNode('c1', 'notNullConstraint'))).toBe('target-input-c1')
    expect(resolveTargetHandle(makeNode('c2', 'rangeConstraint'))).toBe('target-input-c2')
  })

  it('未知节点类型返回 undefined', () => {
    expect(resolveTargetHandle(makeNode('x1', 'projectRoot'))).toBeUndefined()
  })
})

describe('addValidatedAIConnection', () => {
  beforeEach(() => {
    mocks.validateConnection.mockReset().mockReturnValue({ isValid: true })
    mocks.addEdges.mockReset()
  })

  it('templateInstance 目标：resolveTargetHandle 返回 undefined，连接验证失败并抛 AIInstructionError', () => {
    mocks.validateConnection.mockReturnValue({
      isValid: false,
      errorCode: 'NO_MATCHING_RULE',
      message: 'No matching rule',
    })
    const source = makeNode('s1', 'schema')
    const target = makeNode('t1', 'templateInstance')

    expect(() =>
      addValidatedAIConnection({
        sourceNode: source,
        sourceColumnId: 'col-1',
        targetNode: target,
        edges: [],
      })
    ).toThrow(/连接验证失败/)

    expect(mocks.validateConnection).toHaveBeenCalledWith(
      source,
      'source-right-col-1',
      target,
      undefined
    )
    expect(mocks.addEdges).not.toHaveBeenCalled()
  })
})
