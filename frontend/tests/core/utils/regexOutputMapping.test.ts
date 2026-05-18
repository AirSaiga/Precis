import { describe, it, expect } from 'vitest'
import {
  isOutputParamBinding,
  parseOutputParamBinding,
  parseOutputMappingValue,
  outputParamTypeToDataType,
  coerceExtractedValue,
} from '@/features/regex/services/regexOutputMapping'
import type { OutputMappingParamType } from '@/types/regex'

describe('isOutputParamBinding', () => {
  it('returns true for valid param bindings', () => {
    expect(isOutputParamBinding('{age:int}')).toBe(true)
    expect(isOutputParamBinding('{name:string}')).toBe(true)
    expect(isOutputParamBinding('{score:float}')).toBe(true)
    expect(isOutputParamBinding('{flag:boolean}')).toBe(true)
  })

  it('returns false for invalid formats', () => {
    expect(isOutputParamBinding('age:int')).toBe(false)
    expect(isOutputParamBinding('{age}')).toBe(false)
    expect(isOutputParamBinding('{age:int:extra}')).toBe(false)
    expect(isOutputParamBinding('')).toBe(false)
    expect(isOutputParamBinding(null)).toBe(false)
    expect(isOutputParamBinding(undefined)).toBe(false)
    expect(isOutputParamBinding(123)).toBe(false)
  })
})

describe('parseOutputParamBinding', () => {
  it('parses int binding correctly', () => {
    expect(parseOutputParamBinding('{age:int}')).toEqual({
      kind: 'param',
      name: 'age',
      type: 'int',
    })
  })

  it('parses float binding correctly', () => {
    expect(parseOutputParamBinding('{score:float}')).toEqual({
      kind: 'param',
      name: 'score',
      type: 'float',
    })
  })

  it('parses boolean binding correctly', () => {
    expect(parseOutputParamBinding('{enabled:boolean}')).toEqual({
      kind: 'param',
      name: 'enabled',
      type: 'boolean',
    })
  })

  it('falls back to string for unknown types', () => {
    expect(parseOutputParamBinding('{title:date}')).toEqual({
      kind: 'param',
      name: 'title',
      type: 'string',
    })
    expect(parseOutputParamBinding('{items:array}')).toEqual({
      kind: 'param',
      name: 'items',
      type: 'string',
    })
  })

  it('returns null for invalid format', () => {
    expect(parseOutputParamBinding('invalid')).toBeNull()
    expect(parseOutputParamBinding('{missing_type}')).toBeNull()
  })
})

describe('parseOutputMappingValue', () => {
  it('returns param binding for valid expressions', () => {
    expect(parseOutputMappingValue('{age:int}')).toEqual({
      kind: 'param',
      name: 'age',
      type: 'int',
    })
  })

  it('returns static binding for plain strings', () => {
    expect(parseOutputMappingValue('hello')).toEqual({ kind: 'static', value: 'hello' })
  })

  it('returns empty string for null and undefined', () => {
    expect(parseOutputMappingValue(null)).toEqual({ kind: 'static', value: '' })
    expect(parseOutputMappingValue(undefined)).toEqual({ kind: 'static', value: '' })
  })

  it('converts numbers and booleans to static strings', () => {
    expect(parseOutputMappingValue(42)).toEqual({ kind: 'static', value: '42' })
    expect(parseOutputMappingValue(true)).toEqual({ kind: 'static', value: 'true' })
  })
})

describe('outputParamTypeToDataType', () => {
  it('maps int to Integer', () => {
    expect(outputParamTypeToDataType('int')).toBe('Integer')
  })

  it('maps float to Float', () => {
    expect(outputParamTypeToDataType('float')).toBe('Float')
  })

  it('maps boolean to Boolean', () => {
    expect(outputParamTypeToDataType('boolean')).toBe('Boolean')
  })

  it('maps string and unknown to String', () => {
    expect(outputParamTypeToDataType('string')).toBe('String')
    expect(outputParamTypeToDataType('date' as unknown as OutputMappingParamType)).toBe('String')
  })
})

describe('coerceExtractedValue', () => {
  it('returns empty string for null/undefined/empty input', () => {
    expect(coerceExtractedValue(null as unknown as string, 'string')).toBe('')
    expect(coerceExtractedValue(undefined as unknown as string, 'string')).toBe('')
    expect(coerceExtractedValue('', 'string')).toBe('')
  })

  it('coerces int values', () => {
    expect(coerceExtractedValue('42', 'int')).toBe('42')
    expect(coerceExtractedValue('-7', 'int')).toBe('-7')
    // parseInt truncates decimals, so '3.14' → 3 (valid int)
    expect(coerceExtractedValue('3.14', 'int')).toBe('3')
    expect(coerceExtractedValue('abc', 'int')).toBe('')
  })

  it('coerces float values', () => {
    expect(coerceExtractedValue('3.14', 'float')).toBe('3.14')
    expect(coerceExtractedValue('42', 'float')).toBe('42')
    expect(coerceExtractedValue('-0.5', 'float')).toBe('-0.5')
    expect(coerceExtractedValue('abc', 'float')).toBe('')
  })

  it('coerces boolean values case-insensitively', () => {
    expect(coerceExtractedValue('true', 'boolean')).toBe('true')
    expect(coerceExtractedValue('TRUE', 'boolean')).toBe('true')
    expect(coerceExtractedValue('1', 'boolean')).toBe('true')
    expect(coerceExtractedValue('yes', 'boolean')).toBe('true')
    expect(coerceExtractedValue('Y', 'boolean')).toBe('true')
    expect(coerceExtractedValue('false', 'boolean')).toBe('false')
    expect(coerceExtractedValue('0', 'boolean')).toBe('false')
    expect(coerceExtractedValue('NO', 'boolean')).toBe('false')
    expect(coerceExtractedValue('n', 'boolean')).toBe('false')
    expect(coerceExtractedValue('maybe', 'boolean')).toBe('')
  })

  it('returns original string for string type', () => {
    expect(coerceExtractedValue('hello world', 'string')).toBe('hello world')
    expect(coerceExtractedValue('123', 'string')).toBe('123')
  })
})
