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
 * @file addToCanvasHandler.test.ts
 * @description ADD_TO_CANVAS 指令 handler 单元测试
 *
 * 核心覆盖：
 * - 幂等跳过分支使用资源类型中立的 alreadyOnCanvas 文案（不再误用 constraintCreated）
 * - 正常路径委托 importV2ResourceToCanvas 并回报成功
 * - pattern/regex_node 资源类型归一化为 regex
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node as VueFlowNode } from '@vue-flow/core'
import type { FrontendInstruction } from '@/stores/aiChatStore'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  importV2ResourceToCanvas: vi.fn(),
  fitView: vi.fn(),
  findNode: vi.fn(),
  graphStore: {} as Record<string, unknown>,
}))

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: vi.fn(),
  addNodes: vi.fn(),
  removeNodes: vi.fn(),
  fitView: mocks.fitView,
  findNode: mocks.findNode,
}))

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: vi.fn(() => mocks.graphStore),
}))

vi.mock('@/i18n', () => ({
  i18n: { global: { t: mocks.t } },
}))

vi.mock('@/core/toast', () => ({
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}))

vi.mock('@/core/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
    info: mocks.loggerInfo,
    debug: vi.fn(),
  },
}))

import { handleAddToCanvasInstruction } from '@/services/aiChatInstructions/addToCanvasHandler'

function makeNode(id: string): VueFlowNode {
  return { id, type: 'schema', position: { x: 0, y: 0 }, data: {} } as VueFlowNode
}

function makeInstruction(overrides: Record<string, unknown> = {}): FrontendInstruction {
  return {
    actionType: 'ADD_TO_CANVAS',
    canvasSpec: {
      resourceKind: 'schema',
      resourceId: 's1',
      name: 'Users',
      ...overrides,
    },
  } as unknown as FrontendInstruction
}

describe('handleAddToCanvasInstruction 幂等跳过', () => {
  beforeEach(() => {
    mocks.importV2ResourceToCanvas.mockReset().mockResolvedValue('s1')
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.t.mockClear()
    mocks.loggerError.mockReset()
    mocks.loggerInfo.mockReset()
    mocks.loggerWarn.mockReset()
    mocks.graphStore.nodes = [makeNode('s1')]
    mocks.graphStore.importV2ResourceToCanvas = mocks.importV2ResourceToCanvas
  })

  it('节点已在画布：toast 用资源类型中立的 alreadyOnCanvas，t 参数为 displayName', async () => {
    await handleAddToCanvasInstruction(makeInstruction())

    expect(mocks.importV2ResourceToCanvas).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('aiChat.alreadyOnCanvas')
    expect(mocks.t).toHaveBeenCalledWith('aiChat.alreadyOnCanvas', { name: 'Users' })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('节点已在画布（无 name 时回退 resourceId 作为显示名）', async () => {
    await handleAddToCanvasInstruction(makeInstruction({ name: undefined }))

    expect(mocks.toastSuccess).toHaveBeenCalledWith('aiChat.alreadyOnCanvas')
    expect(mocks.t).toHaveBeenCalledWith('aiChat.alreadyOnCanvas', { name: 's1' })
  })

  it('节点不在画布：委托 importV2ResourceToCanvas 并回报 schemaCreated', async () => {
    mocks.graphStore.nodes = []

    await handleAddToCanvasInstruction(makeInstruction())

    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledWith(
      'schema',
      's1',
      expect.any(Object),
      expect.objectContaining({
        includeDeps: false,
        moveIfExists: false,
        skipRelatedConstraints: true,
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('aiChat.schemaCreated')
    expect(mocks.t).toHaveBeenCalledWith('aiChat.schemaCreated', { name: 'Users' })
  })

  it('pattern 资源类型归一化为 regex 委托导入', async () => {
    mocks.graphStore.nodes = []
    mocks.importV2ResourceToCanvas.mockResolvedValue('r1')

    await handleAddToCanvasInstruction(
      makeInstruction({ resourceKind: 'pattern', resourceId: 'r1', name: 'PhonePattern' })
    )

    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledWith(
      'regex',
      'r1',
      expect.any(Object),
      expect.any(Object)
    )
  })

  it('导入返回 null 时回报错误 toast', async () => {
    mocks.graphStore.nodes = []
    mocks.importV2ResourceToCanvas.mockResolvedValue(null)

    await handleAddToCanvasInstruction(makeInstruction())

    expect(mocks.toastError).toHaveBeenCalledWith('aiChat.targetNodeNotFound')
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
