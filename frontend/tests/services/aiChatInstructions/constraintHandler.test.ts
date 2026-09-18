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
 * @file constraintHandler.test.ts
 * @description 约束指令 handler 单元测试
 *
 * 核心覆盖：
 * - 建边失败（AIInstructionError）时只 toastError 并早退，不再落到成功 toast
 * - 失败路径仍 reconcileAll 保持画布连接状态一致
 * - 非 AIInstructionError 异常原样上抛
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Edge, Node as VueFlowNode } from '@vue-flow/core'
import type { FrontendInstruction } from '@/stores/aiChatStore'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key),
  validateConnection: vi.fn(),
  addEdges: vi.fn(),
  addNodes: vi.fn(),
  removeNodes: vi.fn(),
  fitView: vi.fn(),
  findNode: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  graphStore: {
    nodes: [] as VueFlowNode[],
    edges: [] as Edge[],
    reconcileAll: vi.fn(),
    updateNodeData: vi.fn(),
  },
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid') }))

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: mocks.addEdges,
  addNodes: mocks.addNodes,
  removeNodes: mocks.removeNodes,
  fitView: mocks.fitView,
  findNode: mocks.findNode,
}))

vi.mock('@/composables/validation/useConnectionValidator', () => ({
  useConnectionValidator: vi.fn(() => ({ validateConnection: mocks.validateConnection })),
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

import { handleConstraintInstruction } from '@/services/aiChatInstructions/constraintHandler'

function makeSchemaNode(
  id: string,
  columns: Array<{ id: string; columnName: string }> = []
): VueFlowNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: 'Schema_Users',
      tableName: 'Users',
      columns,
      saveState: 'saved',
    },
  } as VueFlowNode
}

function makeAddConstraintInstruction(): FrontendInstruction {
  return {
    actionType: 'ADD_CONSTRAINT_NODE',
    constraintSpec: {
      type: 'NOT_NULL',
      targetNodeId: 'schema-1',
      tableName: 'Users',
      targetColumn: 'name',
      constraintId: 'nn1',
      isInline: false,
    },
  } as unknown as FrontendInstruction
}

describe('handleConstraintInstruction 建边失败路径', () => {
  beforeEach(() => {
    mocks.graphStore.nodes = [makeSchemaNode('schema-1', [{ id: 'col-1', columnName: 'name' }])]
    mocks.graphStore.edges = []
    mocks.graphStore.reconcileAll.mockReset()
    mocks.graphStore.updateNodeData.mockReset()
    mocks.validateConnection.mockReset().mockReturnValue({ isValid: true })
    mocks.addEdges.mockReset()
    mocks.addNodes.mockReset()
    mocks.removeNodes.mockReset()
    mocks.fitView.mockReset()
    mocks.findNode.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.t.mockClear()
    mocks.loggerError.mockReset()
    mocks.loggerWarn.mockReset()
    mocks.loggerInfo.mockReset()
  })

  it('建边验证失败：只 toastError 不再 toastSuccess，并 reconcileAll 后早退', async () => {
    mocks.validateConnection.mockReturnValue({
      isValid: false,
      errorCode: 'CONNECTION_RULE_VIOLATION',
      message: 'rule violated',
    })

    await handleConstraintInstruction(makeAddConstraintInstruction())

    // 错误反馈存在
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    // 关键回归：不允许先报错再报成功
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    // 约束节点已入画布，失败路径仍 reconcile 保持连接状态一致
    expect(mocks.graphStore.reconcileAll).toHaveBeenCalledTimes(1)
    // 未建立任何边
    expect(mocks.addEdges).not.toHaveBeenCalled()
  })

  it('建边成功：恰好一次成功 toast', async () => {
    await handleConstraintInstruction(makeAddConstraintInstruction())

    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('aiChat.constraintCreated')
    expect(mocks.t).toHaveBeenCalledWith('aiChat.constraintCreated', {
      table: 'Users',
      column: 'name',
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.addEdges).toHaveBeenCalledTimes(1)
  })

  it('非 AIInstructionError 异常原样上抛', async () => {
    mocks.validateConnection.mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(handleConstraintInstruction(makeAddConstraintInstruction())).rejects.toThrow(
      'boom'
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
