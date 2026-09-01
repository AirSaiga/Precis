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
