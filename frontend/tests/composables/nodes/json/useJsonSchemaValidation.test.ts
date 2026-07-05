/**
 * @file useJsonSchemaValidation.test.ts
 * @description useJsonSchemaValidation 的针对性单元测试
 *
 * 重点覆盖 P1-7 修复：validateNotNull 的双层语义
 * （nullable 类型层 + constraints.notNull 约束层）
 *
 * 该 composable 大部分方法是纯函数式（接受 column + value，返回 boolean），
 * 仅需构造最小 props 对象即可测试，无需 Pinia/Vue 响应式环境。
 */
import { describe, it, expect } from 'vitest'
import { useJsonSchemaValidation } from '@/composables/nodes/json/useJsonSchemaValidation'
import type { JsonSchemaColumn, JsonSchemaNodeData } from '@/types/nodes'

/** 构造最小 props（composable 只读取 props.id，不依赖 data 内容做响应式） */
function makeProps(overrides?: Partial<JsonSchemaNodeData>) {
  return {
    id: 'node_1',
    data: {
      configName: 'test',
      tableName: 'test_table',
      columns: [],
      saveState: 'draft' as const,
      ...overrides,
    },
  }
}

/** 构造一个 JSON 列 */
function makeColumn(overrides?: Partial<JsonSchemaColumn>): JsonSchemaColumn {
  return {
    id: 'col_1',
    columnName: 'name',
    jsonPath: '$.name',
    dataType: 'string',
    nullable: true,
    constraints: {},
    ...overrides,
  }
}

describe('useJsonSchemaValidation', () => {
  const { validateNotNull, validateJsonPath, validateDataType } =
    useJsonSchemaValidation(makeProps())

  describe('validateNotNull — 双层语义（P1-7）', () => {
    it('nullable=true（默认）：null 值通过', () => {
      const col = makeColumn({ nullable: true })
      expect(validateNotNull(col, null)).toBe(true)
      expect(validateNotNull(col, undefined)).toBe(true)
    })

    it('nullable=false（类型层）：null 值违反', () => {
      const col = makeColumn({ nullable: false })
      expect(validateNotNull(col, null)).toBe(false)
      expect(validateNotNull(col, undefined)).toBe(false)
    })

    it('constraints.notNull=true（约束层）：null 值违反', () => {
      const col = makeColumn({ nullable: true, constraints: { notNull: true } })
      expect(validateNotNull(col, null)).toBe(false)
      expect(validateNotNull(col, undefined)).toBe(false)
    })

    it('constraints.notNull 与 nullable=false 双重禁止：null 值违反', () => {
      const col = makeColumn({ nullable: false, constraints: { notNull: true } })
      expect(validateNotNull(col, null)).toBe(false)
    })

    it('非 null 值：无论 nullable/notNull 配置均通过', () => {
      const col = makeColumn({ nullable: false, constraints: { notNull: true } })
      expect(validateNotNull(col, 'value')).toBe(true)
      expect(validateNotNull(col, 0)).toBe(true)
      expect(validateNotNull(col, false)).toBe(true)
    })

    it('nullable 未设置 + 无 notNull 约束：null 值通过（向后兼容）', () => {
      const col = makeColumn({ nullable: undefined, constraints: {} })
      expect(validateNotNull(col, null)).toBe(true)
    })
  })

  describe('validateJsonPath', () => {
    it('合法路径', () => {
      expect(validateJsonPath('$.name')).toBe(true)
      expect(validateJsonPath('$.user.name')).toBe(true)
      expect(validateJsonPath('$')).toBe(true)
    })

    it('非法路径', () => {
      expect(validateJsonPath('')).toBe(false)
      expect(validateJsonPath('name')).toBe(false) // 缺 $
      expect(validateJsonPath('@name')).toBe(false)
    })
  })

  describe('validateDataType', () => {
    it('string 类型匹配字符串值', () => {
      const col = makeColumn({ dataType: 'string' })
      expect(validateDataType(col, 'hello')).toBe(true)
      expect(validateDataType(col, 123)).toBe(false)
    })

    it('number 类型匹配数值', () => {
      const col = makeColumn({ dataType: 'number' })
      expect(validateDataType(col, 42)).toBe(true)
      expect(validateDataType(col, NaN)).toBe(false)
    })

    it('array 类型匹配数组', () => {
      const col = makeColumn({ dataType: 'array' })
      expect(validateDataType(col, [1, 2, 3])).toBe(true)
      expect(validateDataType(col, { a: 1 })).toBe(false)
    })

    it('null 值在 nullable=true 时通过', () => {
      const col = makeColumn({ dataType: 'string', nullable: true })
      expect(validateDataType(col, null)).toBe(true)
    })

    it('null 值在 nullable=false 时失败（除非 dataType 为 null）', () => {
      const col = makeColumn({ dataType: 'string', nullable: false })
      expect(validateDataType(col, null)).toBe(false)
      const nullCol = makeColumn({ dataType: 'null' })
      expect(validateDataType(nullCol, null)).toBe(true)
    })
  })
})
