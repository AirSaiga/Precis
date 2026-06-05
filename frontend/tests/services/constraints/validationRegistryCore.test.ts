/**
 * @fileoverview validationRegistryCore 纯函数单元测试
 *
 * 测试不依赖 Vue Flow 运行时的纯函数：
 * - CONSTRAINT_TYPES 元数据完整性
 * - 类型映射查询（typeToMeta, kindToMeta）
 * - toResult 错误转换
 * - requireSource 数据源检查
 * - getTargetValues 目标值提取
 * - buildValidationContext 上下文构建
 */

import { describe, it, expect } from 'vitest'
import {
  CONSTRAINT_TYPES,
  typeToMeta,
  kindToMeta,
  toResult,
  requireSource,
  getTargetValues,
  buildValidationContext,
  isConstraintNodeType,
  getConstraintKindByNodeType,
  requiresInputHandle,
  getConstraintMetaByKind,
  getV2ConstraintTypeByKind,
  getV2ConstraintTypeByNodeType,
  defaultReset,
} from '@/services/constraints/validationRegistryCore'

describe('validationRegistryCore - 元数据', () => {
  it('CONSTRAINT_TYPES 包含 10 种约束', () => {
    expect(CONSTRAINT_TYPES).toHaveLength(10)
  })

  it('每个 meta 有完整的 nodeType, kind, v2Type', () => {
    for (const meta of CONSTRAINT_TYPES) {
      expect(meta.nodeType).toBeTruthy()
      expect(meta.kind).toBeTruthy()
      expect(meta.v2Type).toBeTruthy()
      expect(typeof meta.requireInputHandle).toBe('boolean')
    }
  })

  it('typeToMeta 和 kindToMeta 大小等于 CONSTRAINT_TYPES', () => {
    expect(typeToMeta.size).toBe(CONSTRAINT_TYPES.length)
    expect(kindToMeta.size).toBe(CONSTRAINT_TYPES.length)
  })

  it('typeToMeta 键全部以 Constraint 结尾', () => {
    for (const key of typeToMeta.keys()) {
      expect(key).toMatch(/Constraint$/)
    }
  })
})

describe('validationRegistryCore - 类型查询', () => {
  it('isConstraintNodeType 识别合法类型', () => {
    expect(isConstraintNodeType('notNullConstraint')).toBe(true)
    expect(isConstraintNodeType('foreignKeyConstraint')).toBe(true)
  })

  it('isConstraintNodeType 拒绝非法类型', () => {
    expect(isConstraintNodeType('schema')).toBe(false)
    expect(isConstraintNodeType('')).toBe(false)
    expect(isConstraintNodeType(undefined)).toBe(false)
  })

  it('getConstraintKindByNodeType 正确映射', () => {
    expect(getConstraintKindByNodeType('notNullConstraint')).toBe('notNull')
    expect(getConstraintKindByNodeType('foreignKeyConstraint')).toBe('foreignKey')
  })

  it('getConstraintKindByNodeType 空字符串返回空', () => {
    expect(getConstraintKindByNodeType('')).toBe('')
    expect(getConstraintKindByNodeType(undefined)).toBe('')
  })

  it('requiresInputHandle 正确判断', () => {
    expect(requiresInputHandle('foreignKeyConstraint')).toBe(true)
    expect(requiresInputHandle('notNullConstraint')).toBe(false)
    expect(requiresInputHandle('')).toBe(false)
    expect(requiresInputHandle(undefined)).toBe(false)
  })

  it('getV2ConstraintTypeByKind 正确映射', () => {
    expect(getV2ConstraintTypeByKind('notNull')).toBe('NotNull')
    expect(getV2ConstraintTypeByKind('foreignKey')).toBe('ForeignKey')
  })

  it('getV2ConstraintTypeByNodeType 正确映射', () => {
    expect(getV2ConstraintTypeByNodeType('uniqueConstraint')).toBe('Unique')
    expect(getV2ConstraintTypeByNodeType('')).toBe('')
    expect(getV2ConstraintTypeByNodeType(undefined)).toBe('')
  })

  it('getConstraintMetaByKind 返回完整 meta', () => {
    const meta = getConstraintMetaByKind('range')
    expect(meta).toBeTruthy()
    expect(meta!.nodeType).toBe('rangeConstraint')
    expect(meta!.v2Type).toBe('Range')
  })

  it('getConstraintMetaByKind 不存在的 kind 返回 null', () => {
    expect(getConstraintMetaByKind('nonexistent' as any)).toBeNull()
  })
})

describe('validationRegistryCore - toResult', () => {
  it('空 errorRows 返回 pass', () => {
    const result = toResult([], 100, 'fallback')
    expect(result.status).toBe('pass')
    expect(result.validationErrors).toEqual([])
    expect(result.lastValidation?.totalRows).toBe(100)
    expect(result.lastValidation?.errorCount).toBe(0)
    expect(result.lastValidation?.matchCount).toBe(100)
  })

  it('有 errorRows 返回 error', () => {
    const errors = [
      { row_index: 0, error_message: 'is null' },
      { row_index: 4, error_message: 'is null' },
    ]
    const result = toResult(errors, 50, 'fallback')
    expect(result.status).toBe('error')
    expect(result.validationErrors).toEqual(['第 1 行: is null', '第 5 行: is null'])
    expect(result.lastValidation?.errorCount).toBe(2)
    expect(result.lastValidation?.matchCount).toBe(48)
  })

  it('errorRows 为 undefined 时视为空数组', () => {
    const result = toResult(undefined, 10, 'fallback')
    expect(result.status).toBe('pass')
    expect(result.lastValidation?.errorCount).toBe(0)
  })

  it('error_message 缺失时使用 fallbackMessage', () => {
    const result = toResult([{ row_index: 0 }], 10, 'Validation failed')
    expect(result.validationErrors[0]).toContain('Validation failed')
  })

  it('row_index 缺失时显示 "-"', () => {
    const result = toResult([{ error_message: 'err' }], 10, 'fallback')
    expect(result.validationErrors[0]).toContain('第 - 行')
  })
})

describe('validationRegistryCore - requireSource', () => {
  it('有 inlineRows 时返回 null（不需要文件源）', () => {
    const ctx = { inlineRows: [['a'], ['b']] } as any
    expect(requireSource(ctx)).toBeNull()
  })

  it('空 inlineRows 时检查文件路径', () => {
    const ctx = { inlineRows: [], sourceFile: '', sourceFilePath: '' } as any
    const result = requireSource(ctx)
    expect(result).toBeTruthy()
    expect(result!.status).toBe('idle')
  })

  it('有 sourceFile 和 sourceFilePath 时返回 null', () => {
    const ctx = { sourceFile: 'test.csv', sourceFilePath: '/path/test.csv' } as any
    expect(requireSource(ctx)).toBeNull()
  })

  it('缺 sourceFile 时返回 idle', () => {
    const ctx = { sourceFile: '', sourceFilePath: '/path/test.csv' } as any
    const result = requireSource(ctx)
    expect(result).toBeTruthy()
    expect(result!.status).toBe('idle')
  })
})

describe('validationRegistryCore - getTargetValues', () => {
  it('从 schema 节点提取目标列的值', () => {
    const schemaNode = {
      type: 'schema',
      data: {
        columns: [{ id: 'c1', columnName: 'id' }],
        originalData: [
          ['id', 'name'],
          ['1', 'Alice'],
          ['2', 'Bob'],
          ['3', 'Alice'],
          ['', 'Empty'],
          [null, 'NullRow'],
        ],
        headerRow: 0,
      },
    } as any

    const values = getTargetValues(schemaNode, 'id')
    expect(values).toEqual(['1', '2', '3'])
  })

  it('非 schema 节点返回空数组', () => {
    expect(getTargetValues({ type: 'sourcePreview' } as any, 'col')).toEqual([])
  })

  it('undefined 节点返回空数组', () => {
    expect(getTargetValues(undefined, 'col')).toEqual([])
  })

  it('无数据行时返回空数组', () => {
    const schemaNode = {
      type: 'schema',
      data: { columns: [{ id: 'c1', columnName: 'id' }] },
    } as any
    expect(getTargetValues(schemaNode, 'id')).toEqual([])
  })

  it('列名不匹配时返回空数组', () => {
    const schemaNode = {
      type: 'schema',
      data: {
        columns: [{ id: 'c1', columnName: 'name' }],
        originalData: [['name'], ['Alice']],
        headerRow: 0,
      },
    } as any
    expect(getTargetValues(schemaNode, 'id')).toEqual([])
  })
})

describe('validationRegistryCore - buildValidationContext', () => {
  it('从 sourceHandle 提取 columnId', () => {
    const schemaNode = {
      data: {
        columns: [{ id: 'col-1', columnName: 'email' }],
        localPath: '/data/users.csv',
        sourceFile: 'users.csv',
        sheetName: 'Sheet1',
        headerRow: 0,
      },
    } as any
    const constraintNode = { type: 'notNullConstraint' } as any
    const edge = { sourceHandle: 'source-right-col-1' } as any

    const ctx = buildValidationContext({ schemaNode, constraintNode, edge, nodes: [] })
    expect(ctx).toBeTruthy()
    expect(ctx!.columnId).toBe('col-1')
    expect(ctx!.columnName).toBe('email')
    expect(ctx!.sourceFilePath).toBe('/data/users.csv')
    expect(ctx!.sheetName).toBe('Sheet1')
  })

  it('sourceHandle 不以 source-right- 开头时返回 null', () => {
    const schemaNode = { data: { columns: [] } } as any
    const edge = { sourceHandle: 'source-left-col-1' } as any
    const ctx = buildValidationContext({ schemaNode, constraintNode: {} as any, edge, nodes: [] })
    expect(ctx).toBeNull()
  })

  it('columnId 在 columns 中找不到时返回 null', () => {
    const schemaNode = { data: { columns: [] } } as any
    const edge = { sourceHandle: 'source-right-missing' } as any
    const ctx = buildValidationContext({ schemaNode, constraintNode: {} as any, edge, nodes: [] })
    expect(ctx).toBeNull()
  })
})

describe('validationRegistryCore - defaultReset', () => {
  it('重置 validationStatus 为 idle', () => {
    const result = defaultReset({ validationStatus: 'error', validationErrors: ['err'], foo: 'bar' })
    expect(result.validationStatus).toBe('idle')
    expect(result.validationErrors).toEqual([])
    expect(result.lastValidation).toBeUndefined()
    expect(result.foo).toBe('bar')
  })
})
