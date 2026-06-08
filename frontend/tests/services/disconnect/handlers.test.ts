import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Edge, Node } from '@vue-flow/core'
import type { Ref } from 'vue'
import { ref } from 'vue'

vi.mock('@/services/constraints/validationRegistry', () => ({
  isConstraintNodeType: vi.fn((type: string) =>
    ['notNullConstraint', 'uniqueConstraint', 'foreignKeyConstraint', 'allowedValuesConstraint',
     'rangeConstraint', 'conditionalConstraint', 'scriptedConstraint', 'charsetConstraint',
     'dateLogicConstraint', 'compositeConstraint'].includes(type)
  ),
  buildDisconnectReset: vi.fn(() => ({ validationStatus: 'idle', validationErrors: [] })),
}))

describe('disconnect handlers', () => {
  describe('dataSourceToSchema handler logic', () => {
    const matchFn = (edge: any, source: any, target: any) => {
      if (target.type !== 'schema' && target.type !== 'jsonSchema') return false
      if (edge.targetHandle !== 'target-left') return false
      if (source) {
        return ['sourcePreview', 'jsonSourcePreview', 'manualData'].includes(source.type || '')
      }
      return true
    }

    it('sourcePreview → schema + target-left = true', () => {
      expect(matchFn({ targetHandle: 'target-left' }, { type: 'sourcePreview' }, { type: 'schema' })).toBe(true)
    })

    it('jsonSourcePreview → jsonSchema + target-left = true', () => {
      expect(matchFn({ targetHandle: 'target-left' }, { type: 'jsonSourcePreview' }, { type: 'jsonSchema' })).toBe(true)
    })

    it('manualData → schema + target-left = true', () => {
      expect(matchFn({ targetHandle: 'target-left' }, { type: 'manualData' }, { type: 'schema' })).toBe(true)
    })

    it('source 未定义也能匹配', () => {
      expect(matchFn({ targetHandle: 'target-left' }, undefined, { type: 'schema' })).toBe(true)
    })

    it('targetHandle 不是 target-left 返回 false', () => {
      expect(matchFn({ targetHandle: 'other' }, { type: 'sourcePreview' }, { type: 'schema' })).toBe(false)
    })

    it('target 不是 schema/jsonSchema 返回 false', () => {
      expect(matchFn({ targetHandle: 'target-left' }, { type: 'sourcePreview' }, { type: 'regex' })).toBe(false)
    })

    it('source 不是 sourcePreview/jsonSourcePreview/manualData 返回 false', () => {
      expect(matchFn({ targetHandle: 'target-left' }, { type: 'schema' }, { type: 'schema' })).toBe(false)
    })
  })

  describe('regex handler logic', () => {
    it('target 是 regex 时匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'regex'
      expect(match({}, undefined, { type: 'regex' })).toBe(true)
    })

    it('target 不是 regex 时不匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'regex'
      expect(match({}, undefined, { type: 'schema' })).toBe(false)
    })
  })

  describe('transform handler logic', () => {
    it('target 是 transform 时匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'transform'
      expect(match({}, undefined, { type: 'transform' })).toBe(true)
    })

    it('target 不是 transform 时不匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'transform'
      expect(match({}, undefined, { type: 'schema' })).toBe(false)
    })
  })

  describe('transformOutput handler logic', () => {
    it('target 是 transformOutput 时匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'transformOutput'
      expect(match({}, undefined, { type: 'transformOutput' })).toBe(true)
    })

    it('target 不是 transformOutput 时不匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'transformOutput'
      expect(match({}, undefined, { type: 'schema' })).toBe(false)
    })
  })

  describe('templateInstance handler logic', () => {
    it('target 是 templateInstance 时匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'templateInstance'
      expect(match({}, undefined, { type: 'templateInstance' })).toBe(true)
    })

    it('target 不是 templateInstance 时不匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'templateInstance'
      expect(match({}, undefined, { type: 'schema' })).toBe(false)
    })
  })

  describe('constraint handler logic', () => {
    const isConstraintNodeType = (type: string) =>
      ['notNullConstraint', 'uniqueConstraint', 'foreignKeyConstraint', 'allowedValuesConstraint',
       'rangeConstraint', 'conditionalConstraint', 'scriptedConstraint', 'charsetConstraint',
       'dateLogicConstraint', 'compositeConstraint'].includes(type)

    it('constraint 类型但不是 conditionalConstraint 时匹配', () => {
      const match = (_edge: any, _source: any, target: any) =>
        isConstraintNodeType(target.type) && target.type !== 'conditionalConstraint'

      expect(match({}, undefined, { type: 'notNullConstraint' })).toBe(true)
      expect(match({}, undefined, { type: 'uniqueConstraint' })).toBe(true)
      expect(match({}, undefined, { type: 'rangeConstraint' })).toBe(true)
      expect(match({}, undefined, { type: 'foreignKeyConstraint' })).toBe(true)
    })

    it('conditionalConstraint 不匹配', () => {
      const match = (_edge: any, _source: any, target: any) =>
        isConstraintNodeType(target.type) && target.type !== 'conditionalConstraint'
      expect(match({}, undefined, { type: 'conditionalConstraint' })).toBe(false)
    })

    it('非 constraint 类型不匹配', () => {
      const match = (_edge: any, _source: any, target: any) =>
        isConstraintNodeType(target.type) && target.type !== 'conditionalConstraint'
      expect(match({}, undefined, { type: 'schema' })).toBe(false)
    })
  })

  describe('conditional handler logic', () => {
    it('target 是 conditionalConstraint 时匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'conditionalConstraint'
      expect(match({}, undefined, { type: 'conditionalConstraint' })).toBe(true)
    })

    it('target 不是 conditionalConstraint 时不匹配', () => {
      const match = (_edge: any, _source: any, target: any) => target.type === 'conditionalConstraint'
      expect(match({}, undefined, { type: 'notNullConstraint' })).toBe(false)
    })
  })

  describe('fkDisplay handler logic', () => {
    it('edge.data.kind 是 fkDisplay 且有 fkNodeId 时匹配', () => {
      const match = (edge: any) => edge.data?.kind === 'fkDisplay' && !!edge.data?.fkNodeId
      expect(match({ data: { kind: 'fkDisplay', fkNodeId: 'fk1' } })).toBe(true)
    })

    it('没有 fkNodeId 时不匹配', () => {
      const match = (edge: any) => edge.data?.kind === 'fkDisplay' && !!edge.data?.fkNodeId
      expect(match({ data: { kind: 'fkDisplay' } })).toBe(false)
    })

    it('kind 不是 fkDisplay 时不匹配', () => {
      const match = (edge: any) => edge.data?.kind === 'fkDisplay' && !!edge.data?.fkNodeId
      expect(match({ data: { kind: 'regular' } })).toBe(false)
    })
  })

  describe('fkColumn handler logic', () => {
    it('source 是 foreignKeyConstraint 且 target 是 schema 且 targetHandle 以 source-right- 开头', () => {
      const match = (edge: any, source: any, target: any) => {
        if (!source) return false
        return (
          source.type === 'foreignKeyConstraint' &&
          (target.type === 'schema' || target.type === 'jsonSchema') &&
          !!edge.targetHandle?.startsWith('source-right-')
        )
      }

      expect(match(
        { targetHandle: 'source-right-col1' },
        { type: 'foreignKeyConstraint' },
        { type: 'schema' }
      )).toBe(true)
    })

    it('source 未定义返回 false', () => {
      const match = (edge: any, source: any, target: any) => {
        if (!source) return false
        return source.type === 'foreignKeyConstraint'
      }
      expect(match({ targetHandle: 'source-right-col1' }, undefined, { type: 'schema' })).toBe(false)
    })

    it('targetHandle 不以 source-right- 开头时不匹配', () => {
      const match = (edge: any, source: any, target: any) => {
        if (!source) return false
        return (
          source.type === 'foreignKeyConstraint' &&
          (target.type === 'schema' || target.type === 'jsonSchema') &&
          !!edge.targetHandle?.startsWith('source-right-')
        )
      }
      expect(match(
        { targetHandle: 'other' },
        { type: 'foreignKeyConstraint' },
        { type: 'schema' }
      )).toBe(false)
    })
  })
})
