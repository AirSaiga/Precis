import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Connection, Edge, Node } from '@vue-flow/core'
import { connectionPolicyService } from '@/services/canvas/connectionPolicyService'

const mockValidateConnection = vi.fn()
const mockGetAllowedTargetsForSource = vi.fn()
const mockSanitizeConnections = vi.fn()

vi.mock('@/composables/validation/useConnectionValidator', () => ({
  useConnectionValidator: vi.fn(() => ({
    validateConnection: mockValidateConnection,
    getAllowedTargetsForSource: mockGetAllowedTargetsForSource,
    sanitizeConnections: mockSanitizeConnections,
  })),
}))

describe('connectionPolicyService', () => {
  beforeEach(() => {
    mockValidateConnection.mockClear()
    mockGetAllowedTargetsForSource.mockClear()
    mockSanitizeConnections.mockClear()
  })

  describe('isValidConnection', () => {
    const makeNode = (id: string, type: string): Node =>
      ({ id, type, position: { x: 0, y: 0 } } as Node)

    it('源节点缺失时返回 false', () => {
      const conn: Connection = { source: 'missing', target: 't1', sourceHandle: null, targetHandle: null }
      const result = connectionPolicyService.isValidConnection(conn, [makeNode('t1', 'schema')])
      expect(result).toBe(false)
    })

    it('目标节点缺失时返回 false', () => {
      const conn: Connection = { source: 's1', target: 'missing', sourceHandle: null, targetHandle: null }
      const result = connectionPolicyService.isValidConnection(conn, [makeNode('s1', 'schema')])
      expect(result).toBe(false)
    })

    it('正常连接时调用 validator 返回 result.isValid', () => {
      mockValidateConnection.mockReturnValue({ isValid: true })
      const conn: Connection = { source: 's1', target: 't1', sourceHandle: null, targetHandle: null }
      const nodes = [makeNode('s1', 'schema'), makeNode('t1', 'regex')]
      const result = connectionPolicyService.isValidConnection(conn, nodes)
      expect(mockValidateConnection).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })

    it('validator 返回 false 时返回 false', () => {
      mockValidateConnection.mockReturnValue({ isValid: false })
      const conn: Connection = { source: 's1', target: 't1', sourceHandle: null, targetHandle: null }
      const nodes = [makeNode('s1', 'schema'), makeNode('t1', 'regex')]
      const result = connectionPolicyService.isValidConnection(conn, nodes)
      expect(result).toBe(false)
    })
  })

  describe('getAllowedTargets', () => {
    const makeNode = (id: string, type: string): Node =>
      ({ id, type, position: { x: 0, y: 0 } } as Node)

    it('节点不存在时返回空数组', () => {
      const result = connectionPolicyService.getAllowedTargets('missing', undefined, [makeNode('n1', 'schema')])
      expect(result).toEqual([])
    })

    it('正常时返回映射后的目标列表', () => {
      const targetNode = makeNode('t1', 'regex')
      mockGetAllowedTargetsForSource.mockReturnValue([{ node: targetNode, handle: 'regex-input' }])
      const nodes = [makeNode('s1', 'schema'), targetNode]
      const result = connectionPolicyService.getAllowedTargets('s1', undefined, nodes)
      expect(result).toHaveLength(1)
      expect(result[0].node).toBe(targetNode)
      expect(result[0].handle).toBe('regex-input')
    })
  })

  describe('sanitizeConnections', () => {
    const makeNode = (id: string, type: string): Node =>
      ({ id, type, position: { x: 0, y: 0 } } as Node)

    it('全部有效时返回空数组', () => {
      mockSanitizeConnections.mockReturnValue([
        { source: 's1', target: 't1', sourceHandle: null, targetHandle: null } as Connection,
      ])
      const conns: Connection[] = [{ source: 's1', target: 't1', sourceHandle: null, targetHandle: null }]
      const nodes = [makeNode('s1', 'schema'), makeNode('t1', 'regex')]
      const result = connectionPolicyService.sanitizeConnections(nodes, conns)
      expect(result).toEqual([])
    })

    it('含无效时返回 InvalidConnection[]', () => {
      mockSanitizeConnections.mockReturnValue([])
      const conns: Connection[] = [{ source: 's1', target: 't1', sourceHandle: null, targetHandle: null }]
      const nodes = [makeNode('s1', 'schema'), makeNode('t1', 'regex')]
      const result = connectionPolicyService.sanitizeConnections(nodes, conns)
      expect(result).toHaveLength(1)
      expect(result[0].connection).toEqual(conns[0])
      expect(result[0].reason).toBe('Connection validation failed')
    })
  })

  describe('getRulesForNodeType', () => {
    it('isSource=true 时过滤 source.nodeTypes', () => {
      const rules = connectionPolicyService.getRulesForNodeType('schema', true)
      expect(rules.length).toBeGreaterThan(0)
      rules.forEach((rule) => {
        expect(rule.source.nodeTypes).toContain('schema')
      })
    })

    it('isSource=false 时过滤 target.nodeTypes', () => {
      const rules = connectionPolicyService.getRulesForNodeType('regex', false)
      expect(rules.length).toBeGreaterThan(0)
      rules.forEach((rule) => {
        expect(rule.target.nodeTypes).toContain('regex')
      })
    })
  })

  describe('hasValidConnectionRule', () => {
    it('存在规则时返回 true', () => {
      expect(connectionPolicyService.hasValidConnectionRule('schema', 'regex')).toBe(true)
    })

    it('不存在规则时返回 false', () => {
      expect(connectionPolicyService.hasValidConnectionRule('regex', 'regex')).toBe(false)
    })
  })

  describe('getInDegreeConfig', () => {
    it('schema 入度为 1', () => {
      expect(connectionPolicyService.getInDegreeConfig('schema')).toEqual({
        max: 1,
        description: 'Schema 节点只能有一个数据源连接',
      })
    })

    it('uniqueConstraint 入度为 10', () => {
      expect(connectionPolicyService.getInDegreeConfig('uniqueConstraint')).toEqual({
        max: 10,
        description: 'Unique 约束最多连接10个列',
      })
    })

    it('12 种约束类型均有配置', () => {
      const types = [
        'schema',
        'jsonSchema',
        'regex',
        'notNullConstraint',
        'uniqueConstraint',
        'foreignKeyConstraint',
        'allowedValuesConstraint',
        'conditionalConstraint',
        'scriptedConstraint',
        'charsetConstraint',
        'dateLogicConstraint',
        'rangeConstraint',
        'compositeConstraint',
        'templateInstance',
      ]
      types.forEach((type) => {
        const config = connectionPolicyService.getInDegreeConfig(type)
        expect(config.max).toBeDefined()
        expect(config.description).toBeDefined()
      })
    })

    it('未知类型返回 Infinity', () => {
      expect(connectionPolicyService.getInDegreeConfig('unknown')).toEqual({
        max: Infinity,
        description: '无限制',
      })
    })
  })

  describe('getOutDegreeConfig', () => {
    it('schema 出度为 Infinity', () => {
      expect(connectionPolicyService.getOutDegreeConfig('schema')).toEqual({
        max: Infinity,
        description: 'Schema 列可以连接到多个约束',
      })
    })

    it('sourcePreview 出度为 1', () => {
      expect(connectionPolicyService.getOutDegreeConfig('sourcePreview')).toEqual({
        max: 1,
        description: 'SourcePreview 只能连接到一个 Schema',
      })
    })

    it('各节点类型出度配置正确', () => {
      const types = ['schema', 'jsonSchema', 'sourcePreview', 'jsonSourcePreview', 'regex', 'foreignKeyConstraint', 'constraintDashboard', 'templateInstance']
      types.forEach((type) => {
        const config = connectionPolicyService.getOutDegreeConfig(type)
        expect(config.max).toBeDefined()
        expect(config.description).toBeDefined()
      })
    })

    it('未知类型返回 Infinity', () => {
      expect(connectionPolicyService.getOutDegreeConfig('unknown')).toEqual({
        max: Infinity,
        description: '无限制',
      })
    })
  })
})
