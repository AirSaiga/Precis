import { describe, it, expect } from 'vitest'
import { isRegexNodeType, REGEX_NODE_TYPES } from '@/utils/nodes/regex'

describe('isRegexNodeType', () => {
  it('matches regex and regexExtract', () => {
    expect(isRegexNodeType('regex')).toBe(true)
    expect(isRegexNodeType('regexExtract')).toBe(true)
  })

  it('does not match other types', () => {
    expect(isRegexNodeType('schema')).toBe(false)
    expect(isRegexNodeType('notNullConstraint')).toBe(false)
    expect(isRegexNodeType('')).toBe(false)
    expect(isRegexNodeType(undefined)).toBe(false)
  })

  it('REGEX_NODE_TYPES contains exactly two types', () => {
    expect(Array.from(REGEX_NODE_TYPES).sort()).toEqual(['regex', 'regexExtract'])
  })
})
