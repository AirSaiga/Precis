import { describe, it, expect } from 'vitest'
import {
  isValidColumnName,
  isValidJsonPath,
  validateColumn,
  validateColumns,
  validateNestedColumns,
  getValidationSummary,
} from '@/utils/nodes/json/columnValidation'
import type { JsonSchemaColumn } from '@/types/nodes'

function makeJsonColumn(overrides?: Partial<JsonSchemaColumn>): JsonSchemaColumn {
  return {
    id: 'col_1',
    columnName: 'name',
    jsonPath: '$.name',
    dataType: 'string',
    nullable: true,
    isExpanded: false,
    constraints: {},
    validationErrors: [],
    ...overrides,
  }
}

describe('isValidColumnName', () => {
  it('合法列名', () => {
    expect(isValidColumnName('name')).toBe(true)
    expect(isValidColumnName('_private')).toBe(true)
    expect(isValidColumnName('col_1')).toBe(true)
    expect(isValidColumnName('A')).toBe(true)
  })

  it('空字符串或空白', () => {
    expect(isValidColumnName('')).toBe(false)
    expect(isValidColumnName('  ')).toBe(false)
  })

  it('以数字开头', () => {
    expect(isValidColumnName('1abc')).toBe(false)
  })

  it('包含特殊字符', () => {
    expect(isValidColumnName('my-col')).toBe(false)
    expect(isValidColumnName('my.col')).toBe(false)
    expect(isValidColumnName('my col')).toBe(false)
  })

  it('超过 50 字符', () => {
    expect(isValidColumnName('a'.repeat(51))).toBe(false)
    expect(isValidColumnName('a'.repeat(50))).toBe(true)
  })
})

describe('isValidJsonPath', () => {
  it('合法路径', () => {
    expect(isValidJsonPath('$')).toBe(true)
    expect(isValidJsonPath('$.name')).toBe(true)
    expect(isValidJsonPath('$.items[0]')).toBe(true)
    expect(isValidJsonPath('$.items[*]')).toBe(true)
  })

  it('空字符串', () => {
    expect(isValidJsonPath('')).toBe(false)
    expect(isValidJsonPath('  ')).toBe(false)
  })

  it('不以 $ 开头', () => {
    expect(isValidJsonPath('name')).toBe(false)
    expect(isValidJsonPath('@.name')).toBe(false)
  })
})

describe('validateColumn', () => {
  it('有效列返回 isValid=true', () => {
    const result = validateColumn(makeJsonColumn())
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('缺少 id', () => {
    const result = validateColumn(makeJsonColumn({ id: '' }))
    expect(result.isValid).toBe(false)
    expect(result.errors.some((e) => e.field === 'id')).toBe(true)
  })

  it('非法列名', () => {
    const result = validateColumn(makeJsonColumn({ columnName: '1bad' }))
    expect(result.isValid).toBe(false)
    expect(result.errors.some((e) => e.field === 'columnName')).toBe(true)
  })

  it('非法 JSONPath', () => {
    const result = validateColumn(makeJsonColumn({ jsonPath: 'bad' }))
    expect(result.isValid).toBe(false)
    expect(result.errors.some((e) => e.field === 'jsonPath')).toBe(true)
  })

  it('缺少 dataType', () => {
    const result = validateColumn(makeJsonColumn({ dataType: '' as any }))
    expect(result.isValid).toBe(false)
    expect(result.errors.some((e) => e.field === 'dataType')).toBe(true)
  })

  it('空 allowedValues 列表报错', () => {
    const result = validateColumn(makeJsonColumn({ constraints: { allowedValues: [] as any } }))
    expect(result.errors.some((e) => e.field === 'constraints.allowedValues')).toBe(true)
  })

  it('unique + notNull 组合是 warning', () => {
    const result = validateColumn(makeJsonColumn({ constraints: { unique: true, notNull: true } }))
    const warning = result.errors.find((e) => e.field === 'constraints')
    expect(warning?.severity).toBe('warning')
  })

  it('array 类型缺少 arrayItemType 是 warning', () => {
    const result = validateColumn(makeJsonColumn({ dataType: 'array' }))
    const warning = result.errors.find((e) => e.field === 'arrayItemType')
    expect(warning?.severity).toBe('warning')
  })
})

describe('validateColumns', () => {
  it('空数组返回错误', () => {
    const result = validateColumns([])
    expect(result.isValid).toBe(false)
    expect(result.errors.some((e) => e.field === 'columns')).toBe(true)
  })

  it('有效列数组返回 isValid=true', () => {
    const result = validateColumns([
      makeJsonColumn(),
      makeJsonColumn({ id: 'c2', columnName: 'age', jsonPath: '$.age' }),
    ])
    expect(result.isValid).toBe(true)
  })

  it('重复列名报错', () => {
    const result = validateColumns([
      makeJsonColumn({ id: 'c1', columnName: 'name', jsonPath: '$.name' }),
      makeJsonColumn({ id: 'c2', columnName: 'name', jsonPath: '$.name2' }),
    ])
    expect(result.errors.some((e) => e.message.includes('重复'))).toBe(true)
  })

  it('重复列 ID 报错', () => {
    const result = validateColumns([
      makeJsonColumn({ id: 'dup', columnName: 'a', jsonPath: '$.a' }),
      makeJsonColumn({ id: 'dup', columnName: 'b', jsonPath: '$.b' }),
    ])
    expect(result.errors.some((e) => e.message.includes('ID'))).toBe(true)
  })

  it('重复 JSONPath 报错', () => {
    const result = validateColumns([
      makeJsonColumn({ id: 'c1', columnName: 'a', jsonPath: '$.same' }),
      makeJsonColumn({ id: 'c2', columnName: 'b', jsonPath: '$.same' }),
    ])
    expect(result.errors.some((e) => e.message.includes('JSONPath'))).toBe(true)
  })

  it('子列验证错误带索引前缀', () => {
    const result = validateColumns([makeJsonColumn({ id: '' })])
    expect(result.errors[0].field).toMatch(/columns\[0\]/)
  })
})

describe('validateNestedColumns', () => {
  it('无嵌套时通过', () => {
    const cols = [makeJsonColumn({ columnName: 'a' }), makeJsonColumn({ columnName: 'b' })]
    const result = validateNestedColumns(cols)
    expect(result.isValid).toBe(true)
  })

  it('检测重复嵌套路径', () => {
    const cols = [makeJsonColumn({ columnName: 'a' }), makeJsonColumn({ columnName: 'a' })]
    const result = validateNestedColumns(cols)
    expect(result.isValid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('重复'))).toBe(true)
  })

  it('递归验证子列', () => {
    const child = makeJsonColumn({ columnName: 'dup' })
    const cols = [{ ...makeJsonColumn({ columnName: 'parent' }), children: [child, child] }]
    const result = validateNestedColumns(cols)
    expect(result.errors.some((e) => e.message.includes('重复'))).toBe(true)
  })
})

describe('getValidationSummary', () => {
  it('通过时返回通过消息', () => {
    expect(getValidationSummary({ isValid: true, errors: [] })).toBe('验证通过')
  })

  it('只有错误时', () => {
    const result = getValidationSummary({
      isValid: false,
      errors: [{ field: 'x', message: 'err', severity: 'error' }],
    })
    expect(result).toContain('1 个错误')
  })

  it('只有警告时（isValid=false）', () => {
    const result = getValidationSummary({
      isValid: false,
      errors: [{ field: 'x', message: 'warn', severity: 'warning' }],
    })
    expect(result).toContain('1 个警告')
  })

  it('错误和警告都有时', () => {
    const result = getValidationSummary({
      isValid: false,
      errors: [
        { field: 'x', message: 'err', severity: 'error' },
        { field: 'y', message: 'warn', severity: 'warning' },
      ],
    })
    expect(result).toContain('1 个错误')
    expect(result).toContain('1 个警告')
  })
})
