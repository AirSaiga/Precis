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
 * @file useRegexConnection.test.ts
 * @description Regex 连接确认流程单元测试
 *
 * 核心覆盖：
 * - 用户确认"直接校验"后只触发一次 performRegexValidation
 *   （establishRegexConnection 步骤 6 已执行校验，外层不得重复调用）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'

const mocks = vi.hoisted(() => ({
  performRegexValidation: vi.fn(),
  addEdges: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  graphStore: {
    nodes: [] as CustomNode[],
    edges: [] as Edge[],
    updateNodeData: vi.fn(),
    setRegexEditSampleData: vi.fn(),
    deleteConnection: vi.fn(),
    suspendHistory: vi.fn(),
    resumeHistory: vi.fn(),
    discardRedundantTopSnapshot: vi.fn(),
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@vue-flow/core', () => ({
  useVueFlow: () => ({ addEdges: mocks.addEdges }),
}))

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: vi.fn(() => mocks.graphStore),
}))

vi.mock('@/features/regex/composables/useRegexValidation', () => ({
  useRegexValidation: () => ({ performRegexValidation: mocks.performRegexValidation }),
}))

vi.mock('@/services/regex/regexEdgeResolver', () => ({
  resolveRegexSource: vi.fn(),
}))

vi.mock('@/core/toast', () => ({
  toastSuccess: mocks.toastSuccess,
  toastError: mocks.toastError,
  toastInfo: mocks.toastInfo,
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useRegexConnection } from '@/features/regex/composables/useRegexConnection'

function makeSchemaNode(): CustomNode {
  return {
    id: 's1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: 'Users',
      columns: [{ id: 'col-1', columnName: 'name', dataType: 'string' }],
      // 已关联数据源 → 走确认对话框分支
      sourceFilePath: 'data.csv',
    },
  } as CustomNode
}

function makeRegexNode(): CustomNode {
  return {
    id: 'r1',
    type: 'regex',
    position: { x: 400, y: 0 },
    data: { configName: 'EmailRegex' },
  } as CustomNode
}

describe('useRegexConnection 直接校验确认流程', () => {
  beforeEach(() => {
    mocks.graphStore.nodes = [makeSchemaNode(), makeRegexNode()]
    mocks.graphStore.edges = []
    mocks.graphStore.updateNodeData.mockReset()
    mocks.graphStore.setRegexEditSampleData.mockReset()
    mocks.performRegexValidation.mockReset().mockResolvedValue(undefined)
    mocks.addEdges.mockReset()
    mocks.toastSuccess.mockReset()
  })

  it('确认"直接校验"后恰好执行一次正则校验', async () => {
    const connection = useRegexConnection()

    // 有数据源 → 进入确认对话框分支
    await connection.handleSchemaToRegexConnection('s1', 'r1', 'source-right-col-1')
    expect(connection.showRegexConnectionDialog.value).toBe(true)
    expect(connection.pendingRegexConnection.value).not.toBeNull()

    await connection.handleRegexValidateDirectly()

    // 关键回归：establishRegexConnection 步骤 6 已执行校验，外层重复调用已移除
    expect(mocks.performRegexValidation).toHaveBeenCalledTimes(1)
    expect(mocks.performRegexValidation).toHaveBeenCalledWith('r1', 's1', 'name')

    // 连接建立：写入节点数据 + 建边 + 成功提示
    expect(mocks.graphStore.updateNodeData).toHaveBeenCalled()
    expect(mocks.addEdges).toHaveBeenCalledTimes(1)
    expect(mocks.addEdges).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          source: 's1',
          target: 'r1',
          sourceHandle: 'source-right-col-1',
          targetHandle: 'regex-input',
        }),
      ])
    )
    expect(mocks.toastSuccess).toHaveBeenCalled()

    // 临时状态已清空
    expect(connection.showRegexConnectionDialog.value).toBe(false)
    expect(connection.pendingRegexConnection.value).toBeNull()
  })

  it('无待确认连接时 handleRegexValidateDirectly 为空操作', async () => {
    const connection = useRegexConnection()

    await connection.handleRegexValidateDirectly()

    expect(mocks.performRegexValidation).not.toHaveBeenCalled()
    expect(mocks.addEdges).not.toHaveBeenCalled()
  })
})
