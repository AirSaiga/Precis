import { describe, it, expect } from 'vitest'
import { parseColumnSpecs } from '@/services/builders/parseColumnSpec'
import type { ColumnSpecV2 } from '@/types/projectV2'

/**
 * 构造 ColumnSpecV2 的工厂函数（避免内联硬编码完整对象）。
 */
function makeColumnSpec(overrides: Partial<ColumnSpecV2> & { name: string }): ColumnSpecV2 {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    type: overrides.type ?? 'string',
    ...overrides,
  }
}

describe('parseColumnSpecs - 基础类型映射', () => {
  it('普通节点（isJsonSchema=false）用 fromBackendType 映射字符串类型（保留大写 DataType）', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({ name: 'id', type: 'integer' }),
        makeColumnSpec({ name: 'name', type: 'string' }),
        makeColumnSpec({ name: 'price', type: 'float' }),
      ],
      { isJsonSchema: false }
    )
    // 普通节点返回大写 DataType（fromBackendType 原值），不再做危险的 .toLowerCase() 强转
    expect(cols[0].dataType).toBe('Integer')
    expect(cols[1].dataType).toBe('String')
    expect(cols[2].dataType).toBe('Float')
  })

  it('JSON 节点（isJsonSchema=true）用 fromJsonBackendType 映射', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({ name: 'count', type: 'integer' }),
        makeColumnSpec({ name: 'tags', type: 'JsonArray' }),
        makeColumnSpec({ name: 'meta', type: 'JsonObject' }),
      ],
      { isJsonSchema: true }
    )
    expect(cols[0].dataType).toBe('number') // integer → number（JSON 体系）
    expect(cols[1].dataType).toBe('array')
    expect(cols[2].dataType).toBe('object')
  })

  it('JSON 节点的根级标量列也走 fromJsonBackendType（修复 Bug 3）', () => {
    // 无 json_path、无 children 的根级列，JSON 节点下不应走 fromBackendType
    const cols = parseColumnSpecs([makeColumnSpec({ name: 'amount', type: 'float' })], {
      isJsonSchema: true,
    })
    expect(cols[0].dataType).toBe('number')
  })
})

describe('parseColumnSpecs - Expr 对象类型还原（Bug 1）', () => {
  it('还原 Expr 对象配置的 boundPattern / boundRegistry / isBound / expressionType', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'email',
          type: {
            name: 'Expr',
            registry: 'expression_registry',
            pattern: '^\\S+@\\S+$',
          },
        }),
      ],
      { isJsonSchema: false }
    )
    const col = cols[0] as JsonSchemaColumnLike
    expect(col.boundPattern).toBe('^\\S+@\\S+$')
    expect(col.boundRegistry).toBe('expression_registry')
    expect(col.isBound).toBe(true)
    expect(col.expressionType).toBe('explicit')
  })

  it('Expr 无 pattern 时标记为 implicit', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'phone',
          type: { name: 'Expr', registry: 'mobile_registry' },
        }),
      ],
      { isJsonSchema: false }
    )
    const col = cols[0] as JsonSchemaColumnLike
    expect(col.boundPattern).toBeUndefined()
    expect(col.isBound).toBe(false)
    expect(col.expressionType).toBe('implicit')
  })

  it('JSON 节点出现 Expr 时仍还原 boundPattern（便于回写），dataType 降级', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'email',
          type: { name: 'Expr', registry: 'email_registry', pattern: '.+' },
        }),
      ],
      { isJsonSchema: true }
    )
    const col = cols[0] as JsonSchemaColumnLike
    expect(col.boundPattern).toBe('.+')
    expect(col.boundRegistry).toBe('email_registry')
    expect(col.isBound).toBe(true)
    // JSON 体系下 Expr 无对应类型，dataType 降级为 string
    expect(col.dataType).toBe('string')
  })
})

describe('parseColumnSpecs - Extracted 对象类型还原（Bug 1）', () => {
  it('还原 Extracted 对象配置的 extractedConfig', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'username',
          type: {
            name: 'Extracted',
            source_column: 'email',
            extract_key: 'username',
            result_type: 'string',
          },
        }),
      ],
      { isJsonSchema: false }
    )
    const col = cols[0] as JsonSchemaColumnLike
    expect(col.extractedConfig).toEqual({
      sourceColumn: 'email',
      extractKey: 'username',
      resultType: 'string',
    })
  })

  it('Extracted 缺失字段时填充空值', () => {
    const cols = parseColumnSpecs([makeColumnSpec({ name: 'x', type: { name: 'Extracted' } })], {
      isJsonSchema: false,
    })
    const col = cols[0] as JsonSchemaColumnLike
    expect(col.extractedConfig).toEqual({
      sourceColumn: '',
      extractKey: '',
      resultType: undefined,
    })
  })
})

describe('parseColumnSpecs - 嵌套 children', () => {
  it('递归还原 JSON 嵌套子列', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'user',
          type: 'JsonObject',
          children: [
            makeColumnSpec({ name: 'name', type: 'string', json_path: 'user.name' }),
            makeColumnSpec({
              name: 'address',
              type: 'JsonObject',
              json_path: 'user.address',
              children: [
                makeColumnSpec({ name: 'city', type: 'string', json_path: 'user.address.city' }),
              ],
            }),
          ],
        }),
      ],
      { isJsonSchema: true }
    )
    expect(cols[0].children).toHaveLength(2)
    expect(cols[0].children![0].columnName).toBe('name')
    expect(cols[0].children![0].dataType).toBe('string')
    expect(cols[0].children![1].children).toHaveLength(1)
    expect(cols[0].children![1].children![0].columnName).toBe('city')
    expect(cols[0].children![1].isExpanded).toBe(false)
  })

  it('嵌套子列中的 Expr 也被还原', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'profile',
          type: 'JsonObject',
          children: [
            makeColumnSpec({
              name: 'email',
              type: { name: 'Expr', registry: 'email_reg', pattern: '.+@.+' },
              json_path: 'profile.email',
            }),
          ],
        }),
      ],
      { isJsonSchema: true }
    )
    const child = cols[0].children![0] as JsonSchemaColumnLike
    expect(child.boundPattern).toBe('.+@.+')
    expect(child.isBound).toBe(true)
  })
})

describe('parseColumnSpecs - nullable / primaryKey / jsonPath 保留（Bug 5）', () => {
  it('保留 nullable / primaryKey / json_path 字段', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'id',
          type: 'integer',
          primary_key: true,
          nullable: false,
        }),
        makeColumnSpec({
          name: 'email',
          type: 'string',
          json_path: '$.email',
        }),
      ],
      { isJsonSchema: true }
    )
    expect(cols[0].primaryKey).toBe(true)
    expect(cols[0].nullable).toBe(false)
    expect(cols[1].jsonPath).toBe('$.email')
  })

  it('缺失 nullable/primaryKey 时为 undefined', () => {
    const cols = parseColumnSpecs([makeColumnSpec({ name: 'a', type: 'string' })], {
      isJsonSchema: false,
    })
    expect(cols[0].nullable).toBeUndefined()
    expect(cols[0].primaryKey).toBeUndefined()
  })

  it('expand 字段映射为 isExpanded', () => {
    const cols = parseColumnSpecs(
      [
        makeColumnSpec({
          name: 'obj',
          type: 'JsonObject',
          expand: true,
          children: [makeColumnSpec({ name: 'inner', type: 'string' })],
        }),
      ],
      { isJsonSchema: true }
    )
    expect(cols[0].isExpanded).toBe(true)
  })
})

describe('parseColumnSpecs - 边界情况', () => {
  it('空数组返回空数组', () => {
    expect(parseColumnSpecs([], { isJsonSchema: false })).toEqual([])
  })

  it('undefined 返回空数组', () => {
    expect(parseColumnSpecs(undefined, { isJsonSchema: false })).toEqual([])
  })

  it('未识别的字符串类型降级为 string（JSON）/ String（普通）', () => {
    const jsonCols = parseColumnSpecs([makeColumnSpec({ name: 'x', type: 'UnknownType' })], {
      isJsonSchema: true,
    })
    expect(jsonCols[0].dataType).toBe('string')

    const normalCols = parseColumnSpecs([makeColumnSpec({ name: 'x', type: 'UnknownType' })], {
      isJsonSchema: false,
    })
    // 普通节点未识别类型降级为大写 'String'
    expect(normalCols[0].dataType).toBe('String')
  })
})

/**
 * 辅助类型：用于断言 parseColumnSpecs 输出上的可选字段。
 * JsonSchemaColumn 在运行时承载 boundPattern 等字段，这里用宽松类型便于断言。
 */
interface JsonSchemaColumnLike {
  dataType: string
  boundPattern?: string
  boundRegistry?: string
  isBound?: boolean
  expressionType?: string
  extractedConfig?: {
    sourceColumn: string
    extractKey: string
    resultType?: string
  }
}
