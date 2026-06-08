import { describe, it, expect } from 'vitest'
import { buildV2RegexNodeFile } from '@/features/regex/services/regexBuilder'
import type { RegexNodeData } from '@/features/regex/types'

function makeRegexNodeData(partial: Partial<RegexNodeData> = {}): RegexNodeData {
  return {
    configName: 'Test Regex',
    description: '',
    pattern: '',
    parameters: [],
    matchMode: 'full',
    validationRules: {},
    enabled: true,
    caseSensitive: false,
    flags: '',
    validationStatus: 'idle',
    ...partial,
  }
}

describe('buildV2RegexNodeFile', () => {
  it('returns basic structure with version and id', () => {
    const data = makeRegexNodeData()
    const result = buildV2RegexNodeFile('regex-1', data)

    expect(result.version).toBe(2)
    expect(result.id).toBe('regex-1')
    expect(result.name).toBe('Test Regex')
    expect(result.enabled).toBe(true)
  })

  it('uses default values for empty data', () => {
    const data = makeRegexNodeData({
      configName: '',
      description: '',
      pattern: '',
      flags: '',
      matchMode: undefined as unknown as 'full' | 'partial' | 'extract',
      enabled: undefined as unknown as boolean,
      caseSensitive: undefined as unknown as boolean,
      parameters: undefined as unknown as RegexNodeData['parameters'],
      rules: undefined as unknown as RegexNodeData['rules'],
    })
    const result = buildV2RegexNodeFile('regex-empty', data)

    expect(result.name).toBe('Unnamed Regex')
    expect(result.description).toBe('')
    expect(result.pattern).toBe('')
    expect(result.flags).toBe('')
    expect(result.match_mode).toBe('full')
    expect(result.enabled).toBe(true)
    expect(result.case_sensitive).toBe(false)
    expect(result.parameters).toEqual([])
    expect(result.rules).toEqual([])
    expect(result.source_ref).toBeUndefined()
  })

  it('maps all fields correctly from populated data', () => {
    const data = makeRegexNodeData({
      configName: 'Email Validator',
      description: 'Validates email format',
      pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
      flags: 'g',
      matchMode: 'partial',
      enabled: false,
      caseSensitive: true,
      parameters: [
        { name: 'minLength', type: 'int', description: 'Minimum length' },
        { name: 'domain', type: 'word' },
      ],
      rules: [
        { id: 'r1', name: 'Rule 1', regex: '.*', output: {} },
      ],
      sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
    })
    const result = buildV2RegexNodeFile('regex-email', data)

    expect(result.name).toBe('Email Validator')
    expect(result.description).toBe('Validates email format')
    expect(result.pattern).toBe('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')
    expect(result.flags).toBe('g')
    expect(result.match_mode).toBe('partial')
    expect(result.enabled).toBe(false)
    expect(result.case_sensitive).toBe(true)
    expect(result.parameters).toEqual([
      { name: 'minLength', type: 'int', description: 'Minimum length' },
      { name: 'domain', type: 'word', description: '' },
    ])
    expect(result.rules).toHaveLength(1)
    expect(result.source_ref).toEqual({
      table_id: 'schema-1',
      column_id: 'col-email',
    })
  })

  it('handles extract match mode', () => {
    const data = makeRegexNodeData({ matchMode: 'extract' })
    const result = buildV2RegexNodeFile('regex-extract', data)

    expect(result.match_mode).toBe('extract')
  })

  it('handles sourceRef without columnId gracefully', () => {
    const data = makeRegexNodeData({
      sourceRef: { nodeId: 'schema-2', columnId: '' },
    })
    const result = buildV2RegexNodeFile('regex-partial-ref', data)

    expect(result.source_ref).toEqual({
      table_id: 'schema-2',
      column_id: '',
    })
  })

  it('omits source_ref when sourceRef is absent', () => {
    const data = makeRegexNodeData()
    const result = buildV2RegexNodeFile('regex-no-ref', data)

    expect(result.source_ref).toBeUndefined()
  })

  it('fills empty parameter description with default', () => {
    const data = makeRegexNodeData({
      parameters: [{ name: 'p1', type: 'float' }],
    })
    const result = buildV2RegexNodeFile('regex-params', data)

    expect(result.parameters).toEqual([{ name: 'p1', type: 'float', description: '' }])
  })

  it('preserves rules array when provided', () => {
    const rules = [
      { id: 'rule-1', name: 'Alpha', regex: '[a-z]+', output: { group: '{val:string}' } },
      { id: 'rule-2', name: 'Digit', regex: '\\d+', output: {} },
    ]
    const data = makeRegexNodeData({ rules: rules as RegexNodeData['rules'] })
    const result = buildV2RegexNodeFile('regex-rules', data)

    expect(result.rules).toEqual(rules)
  })
})
