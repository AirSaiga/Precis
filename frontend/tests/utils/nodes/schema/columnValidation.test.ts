import { describe, it, expect } from 'vitest'
import {
  findMissingColumns,
  extractColumnNamesFromHeader,
  checkColumnMatch,
  compareColumns,
} from '@/utils/nodes/schema/columnValidation'
import type { SchemaColumn } from '@/types/graph'

function makeColumn(name: string, overrides?: Partial<SchemaColumn>): SchemaColumn {
  return {
    id: name,
    columnName: name,
    dataType: 'String',
    expressionType: 'none',
    constraints: {},
    validationErrors: [],
    ...overrides,
  }
}

describe('findMissingColumns', () => {
  it('schema 无列时返回空数组', () => {
    expect(findMissingColumns(['a', 'b'], [])).toEqual([])
  })

  it('所有列都存在时返回空数组', () => {
    const cols = [makeColumn('a'), makeColumn('b')]
    expect(findMissingColumns(['a', 'b', 'c'], cols)).toEqual([])
  })

  it('返回缺失的列名', () => {
    const cols = [makeColumn('a'), makeColumn('b'), makeColumn('c')]
    expect(findMissingColumns(['a'], cols)).toEqual(['b', 'c'])
  })

  it('source 为空时返回所有 schema 列名', () => {
    const cols = [makeColumn('x'), makeColumn('y')]
    expect(findMissingColumns([], cols)).toEqual(['x', 'y'])
  })
})

describe('extractColumnNamesFromHeader', () => {
  it('空输入返回空数组', () => {
    expect(extractColumnNamesFromHeader([])).toEqual([])
    expect(extractColumnNamesFromHeader(null as any)).toEqual([])
  })

  it('提取并 trim 列名', () => {
    expect(extractColumnNamesFromHeader([' Name ', 'Age', 'Email'])).toEqual([
      'Name',
      'Age',
      'Email',
    ])
  })

  it('非字符串值转为字符串', () => {
    expect(extractColumnNamesFromHeader([1, null, undefined])).toEqual(['1', 'null', 'undefined'])
  })
})

describe('checkColumnMatch', () => {
  it('source 为空时返回 null', () => {
    expect(checkColumnMatch([], [makeColumn('a')])).toBeNull()
  })

  it('schema 为空时返回 null', () => {
    expect(checkColumnMatch(['a'], [])).toBeNull()
  })

  it('完全匹配时返回 null', () => {
    const cols = [makeColumn('a'), makeColumn('b')]
    expect(checkColumnMatch(['a', 'b'], cols)).toBeNull()
  })

  it('有缺失列时返回结果', () => {
    const cols = [makeColumn('a'), makeColumn('b'), makeColumn('c')]
    const result = checkColumnMatch(['a'], cols)
    expect(result).not.toBeNull()
    expect(result!.missingColumns).toEqual(['b', 'c'])
    expect(result!.missingCount).toBe(2)
    expect(result!.previewMissing).toBe('b, c')
    expect(result!.hasMore).toBe(false)
  })

  it('超过 5 个缺失列时 hasMore 为 true', () => {
    const cols = Array.from({ length: 7 }, (_, i) => makeColumn(`col${i}`))
    const result = checkColumnMatch(['only'], cols)
    expect(result!.hasMore).toBe(true)
    expect(result!.missingCount).toBe(7)
    expect(result!.previewMissing.split(', ')).toHaveLength(5)
  })
})

describe('compareColumns', () => {
  it('schema 为空时返回 schemaEmpty=true', () => {
    const result = compareColumns(['a', 'b'], [])
    expect(result.schemaEmpty).toBe(true)
    expect(result.needsAction).toBe(true)
    expect(result.isMatch).toBe(false)
  })

  it('完全匹配时返回 isMatch=true', () => {
    const cols = [makeColumn('a'), makeColumn('b')]
    const result = compareColumns(['a', 'b'], cols)
    expect(result.isMatch).toBe(true)
    expect(result.needsAction).toBe(false)
    expect(result.newInSource).toEqual([])
    expect(result.staleInSchema).toEqual([])
  })

  it('source 有新列时返回 newInSource', () => {
    const cols = [makeColumn('a')]
    const result = compareColumns(['a', 'b', 'c'], cols)
    expect(result.newInSource).toEqual(['b', 'c'])
    expect(result.needsAction).toBe(true)
  })

  it('schema 有残留列时返回 staleInSchema', () => {
    const cols = [makeColumn('a'), makeColumn('b')]
    const result = compareColumns(['a'], cols)
    expect(result.staleInSchema).toEqual(['b'])
  })

  it('衍生列不计入 staleInSchema', () => {
    const cols = [
      makeColumn('a'),
      makeColumn('derived', { expressionType: 'implicit' }),
      makeColumn('bound', { isBound: true }),
      makeColumn('extracted', { extractedConfig: { source: 'regex' } }),
    ]
    const result = compareColumns(['a'], cols)
    expect(result.staleInSchema).toEqual([])
  })

  it('双向差异', () => {
    const cols = [makeColumn('old'), makeColumn('keep')]
    const result = compareColumns(['keep', 'new'], cols)
    expect(result.newInSource).toEqual(['new'])
    expect(result.staleInSchema).toEqual(['old'])
    expect(result.isMatch).toBe(false)
  })
})
