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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Connection, Node } from '@vue-flow/core'
import { connectionPolicyService } from '@/services/canvas/connectionPolicyService'

const mockValidateConnection = vi.fn()

vi.mock('@/composables/validation/useConnectionValidator', () => ({
  useConnectionValidator: vi.fn(() => ({
    validateConnection: mockValidateConnection,
  })),
}))

describe('connectionPolicyService', () => {
  beforeEach(() => {
    mockValidateConnection.mockClear()
  })

  describe('isValidConnection', () => {
    const makeNode = (id: string, type: string): Node =>
      ({ id, type, position: { x: 0, y: 0 } }) as Node

    it('源节点缺失时返回 false', () => {
      const conn: Connection = {
        source: 'missing',
        target: 't1',
        sourceHandle: null,
        targetHandle: null,
      }
      const result = connectionPolicyService.isValidConnection(conn, [makeNode('t1', 'schema')])
      expect(result).toBe(false)
    })

    it('目标节点缺失时返回 false', () => {
      const conn: Connection = {
        source: 's1',
        target: 'missing',
        sourceHandle: null,
        targetHandle: null,
      }
      const result = connectionPolicyService.isValidConnection(conn, [makeNode('s1', 'schema')])
      expect(result).toBe(false)
    })

    it('正常连接时调用 validator 返回 result.isValid', () => {
      mockValidateConnection.mockReturnValue({ isValid: true })
      const conn: Connection = {
        source: 's1',
        target: 't1',
        sourceHandle: null,
        targetHandle: null,
      }
      const nodes = [makeNode('s1', 'schema'), makeNode('t1', 'regex')]
      const result = connectionPolicyService.isValidConnection(conn, nodes)
      expect(mockValidateConnection).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })

    it('validator 返回 false 时返回 false', () => {
      mockValidateConnection.mockReturnValue({ isValid: false })
      const conn: Connection = {
        source: 's1',
        target: 't1',
        sourceHandle: null,
        targetHandle: null,
      }
      const nodes = [makeNode('s1', 'schema'), makeNode('t1', 'regex')]
      const result = connectionPolicyService.isValidConnection(conn, nodes)
      expect(result).toBe(false)
    })
  })
})
