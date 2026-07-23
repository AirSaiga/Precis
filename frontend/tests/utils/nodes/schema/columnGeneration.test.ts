import { describe, it, expect } from 'vitest'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import type { SchemaColumn } from '@/types/graph'

function makeColumn(overrides: Partial<SchemaColumn> = {}): SchemaColumn {
  return {
    id: 'col-1',
    columnName: 'name',
    dataType: 'String',
    expressionType: 'none',
    constraints: {},
    validationErrors: [],
    ...overrides,
  }
}

describe('generateColumnsFromSource', () => {
  it('空 headerRow 返回空数组', () => {
    expect(generateColumnsFromSource(null as unknown as unknown[])).toEqual([])
    expect(generateColumnsFromSource(undefined as unknown as unknown[])).toEqual([])
  })

  it('从 headerRow 生成新列', () => {
    const result = generateColumnsFromSource(['id', 'name', 'age'])
    expect(result).toHaveLength(3)
    expect(result[0].columnName).toBe('id')
    expect(result[1].columnName).toBe('name')
    expect(result[2].columnName).toBe('age')
  })

  it('空列名回退为 column_N', () => {
    const result = generateColumnsFromSource(['', 'name', ''])
    expect(result[0].columnName).toBe('column_1')
    expect(result[1].columnName).toBe('name')
    expect(result[2].columnName).toBe('column_3')
  })

  it('使用 sampleDataRow 推断数据类型', () => {
    const result = generateColumnsFromSource(['id', 'score', 'active'], [], ['42', '3.14', 'true'])
    expect(result[0].dataType).toBe('Integer')
    expect(result[1].dataType).toBe('Float')
    expect(result[2].dataType).toBe('Boolean')
  })

  it('无 sampleDataRow 时默认 String 类型', () => {
    const result = generateColumnsFromSource(['col1'])
    expect(result[0].dataType).toBe('String')
  })

  it('保留已存在列的定义（ID、约束）', () => {
    const existing = [makeColumn({ id: 'uuid-123', columnName: 'name', dataType: 'Integer' })]
    const result = generateColumnsFromSource(['name'], existing)
    expect(result[0].id).toBe('uuid-123')
    // 默认保留原有类型
    expect(result[0].dataType).toBe('Integer')
  })

  it('forceReinferTypes=true 时重新推断已存在列的类型', () => {
    const existing = [makeColumn({ id: 'uuid-123', columnName: 'age', dataType: 'String' })]
    const result = generateColumnsFromSource(['age'], existing, ['25'], { forceReinferTypes: true })
    expect(result[0].dataType).toBe('Integer')
  })

  it('forceReinferTypes=false 时保留原有类型', () => {
    const existing = [makeColumn({ columnName: 'age', dataType: 'String' })]
    const result = generateColumnsFromSource(['age'], existing, ['25'], {
      forceReinferTypes: false,
    })
    expect(result[0].dataType).toBe('String')
  })

  it('保留衍生列（expressionType=implicit）', () => {
    const existing = [
      makeColumn({ columnName: 'source_col', expressionType: 'none' }),
      makeColumn({ columnName: 'derived_col', expressionType: 'implicit' }),
    ]
    const result = generateColumnsFromSource(['new_col'], existing)
    // source_col 是普通列且不在源数据中，被丢弃
    // derived_col 是衍生列，被保留
    const names = result.map((c) => c.columnName)
    expect(names).toContain('new_col')
    expect(names).toContain('derived_col')
    expect(names).not.toContain('source_col')
  })

  it('保留衍生列（expressionType=explicit）', () => {
    const existing = [makeColumn({ columnName: 'calc_col', expressionType: 'explicit' })]
    const result = generateColumnsFromSource(['new_col'], existing)
    expect(result.map((c) => c.columnName)).toContain('calc_col')
  })

  it('保留 isBound=true 的列', () => {
    const existing = [makeColumn({ columnName: 'bound_col', isBound: true })]
    const result = generateColumnsFromSource(['new_col'], existing)
    expect(result.map((c) => c.columnName)).toContain('bound_col')
  })

  it('保留有 extractedConfig 的列', () => {
    const existing = [
      makeColumn({
        columnName: 'extracted_col',
        extractedConfig: { pattern: '\\d+' },
      } as Partial<SchemaColumn>),
    ]
    const result = generateColumnsFromSource(['new_col'], existing)
    expect(result.map((c) => c.columnName)).toContain('extracted_col')
  })

  it('源数据中已有的列不重复添加', () => {
    const existing = [makeColumn({ columnName: 'name' })]
    const result = generateColumnsFromSource(['name', 'age'], existing)
    const nameCols = result.filter((c) => c.columnName === 'name')
    expect(nameCols).toHaveLength(1)
  })

  it('列名匹配时 trim 处理', () => {
    const existing = [makeColumn({ id: 'uuid-1', columnName: ' name ' })]
    const result = generateColumnsFromSource(['name'], existing)
    expect(result[0].id).toBe('uuid-1')
  })

  it('新列使用列名作为 ID', () => {
    const result = generateColumnsFromSource(['my_col'])
    expect(result[0].id).toBe('my_col')
  })

  it('新列包含默认 constraints 和 validationErrors', () => {
    const result = generateColumnsFromSource(['col'])
    expect(result[0].constraints).toEqual({})
    expect(result[0].validationErrors).toEqual([])
    expect(result[0].expressionType).toBe('none')
  })
})
