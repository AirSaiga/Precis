/**
 * @file columnValidation.ts
 * @description JSON Schema 列验证工具函数
 * 提供列定义验证、JSONPath 验证等功能
 */

import type { JsonSchemaColumn } from '@/types/nodes'

/**
 * 验证结果接口
 */
export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
}

/**
 * 验证错误接口
 */
export interface ValidationError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

/**
 * 验证列名是否合法
 *
 * @param name - 列名
 * @returns 是否合法
 */
export function isValidColumnName(name: string): boolean {
  if (!name || !name.trim()) {
    return false
  }

  if (/^\d/.test(name)) {
    return false
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return false
  }

  return name.length <= 50
}

/**
 * 验证 JSONPath 格式
 *
 * @param jsonPath - JSONPath 路径
 * @returns 是否合法
 */
export function isValidJsonPath(jsonPath: string): boolean {
  if (!jsonPath || !jsonPath.trim()) {
    return false
  }

  if (!jsonPath.startsWith('$')) {
    return false
  }

  const pathPattern = /^\$([.\[\]]+)?([a-zA-Z_][a-zA-Z0-9_]*|\*)?(\[\d+\]|\[\*\])?$/
  return pathPattern.test(jsonPath)
}

/**
 * 验证列定义
 *
 * @param column - 列定义对象
 * @returns 验证结果
 */
export function validateColumn(column: JsonSchemaColumn): ValidationResult {
  const errors: ValidationError[] = []

  if (!column.id) {
    errors.push({
      field: 'id',
      message: '列 ID 不能为空',
      severity: 'error',
    })
  }

  if (!isValidColumnName(column.columnName)) {
    errors.push({
      field: 'columnName',
      message: '列名不合法（只能包含字母、数字、下划线，不能以数字开头，长度不超过50）',
      severity: 'error',
    })
  }

  if (!isValidJsonPath(column.jsonPath)) {
    errors.push({
      field: 'jsonPath',
      message: 'JSONPath 格式不合法（必须以 $ 开头）',
      severity: 'error',
    })
  }

  if (!column.dataType) {
    errors.push({
      field: 'dataType',
      message: '数据类型不能为空',
      severity: 'error',
    })
  }

  if (column.constraints) {
    if (column.constraints.unique && column.constraints.notNull) {
      errors.push({
        field: 'constraints',
        message: '唯一性和非空约束可以同时设置',
        severity: 'warning',
      })
    }

    if (column.constraints.allowedValues && column.constraints.allowedValues.length === 0) {
      errors.push({
        field: 'constraints.allowedValues',
        message: '允许值列表不能为空',
        severity: 'error',
      })
    }
  }

  if (column.dataType === 'array' && !column.arrayItemType) {
    errors.push({
      field: 'arrayItemType',
      message: '数组类型必须指定元素类型',
      severity: 'warning',
    })
  }

  return {
    isValid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  }
}

/**
 * 验证列数组
 *
 * @param columns - 列定义数组
 * @returns 验证结果
 */
export function validateColumns(columns: JsonSchemaColumn[]): ValidationResult {
  const errors: ValidationError[] = []

  if (!columns || columns.length === 0) {
    errors.push({
      field: 'columns',
      message: '列定义不能为空',
      severity: 'error',
    })
    return { isValid: false, errors }
  }

  const columnNames = new Set<string>()
  const columnIds = new Set<string>()
  const jsonPaths = new Set<string>()

  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]
    const columnResult = validateColumn(column)

    for (const error of columnResult.errors) {
      errors.push({
        ...error,
        field: `columns[${i}].${error.field}`,
        message: `第 ${i + 1} 列: ${error.message}`,
      })
    }

    if (columnNames.has(column.columnName)) {
      errors.push({
        field: 'columnName',
        message: `列名 "${column.columnName}" 重复`,
        severity: 'error',
      })
    }
    columnNames.add(column.columnName)

    if (columnIds.has(column.id)) {
      errors.push({
        field: 'id',
        message: `列 ID "${column.id}" 重复`,
        severity: 'error',
      })
    }
    columnIds.add(column.id)

    if (jsonPaths.has(column.jsonPath)) {
      errors.push({
        field: 'jsonPath',
        message: `JSONPath "${column.jsonPath}" 重复`,
        severity: 'error',
      })
    }
    jsonPaths.add(column.jsonPath)
  }

  return {
    isValid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  }
}

/**
 * 验证嵌套列
 *
 * @param columns - 列定义数组
 * @param parentPath - 父级路径
 * @returns 验证结果
 */
export function validateNestedColumns(
  columns: JsonSchemaColumn[],
  parentPath: string = '$'
): ValidationResult {
  const errors: ValidationError[] = []
  const allPaths = new Set<string>()

  for (const column of columns) {
    const fullPath = `${parentPath}.${column.columnName}`

    if (allPaths.has(fullPath)) {
      errors.push({
        field: 'jsonPath',
        message: `嵌套路径 "${fullPath}" 重复`,
        severity: 'error',
      })
    }
    allPaths.add(fullPath)

    if (column.children && column.children.length > 0) {
      const childResult = validateNestedColumns(column.children, fullPath)
      errors.push(...childResult.errors)
    }
  }

  return {
    isValid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  }
}

/**
 * 获取验证错误摘要
 *
 * @param result - 验证结果
 * @returns 错误摘要
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.isValid) {
    return '验证通过'
  }

  const errorCount = result.errors.filter((e) => e.severity === 'error').length
  const warningCount = result.errors.filter((e) => e.severity === 'warning').length

  const parts: string[] = []
  if (errorCount > 0) {
    parts.push(`${errorCount} 个错误`)
  }
  if (warningCount > 0) {
    parts.push(`${warningCount} 个警告`)
  }

  return parts.join('，')
}

export default {
  isValidColumnName,
  isValidJsonPath,
  validateColumn,
  validateColumns,
  validateNestedColumns,
  getValidationSummary,
}
