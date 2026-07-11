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
 *
 * message 为兜底文案；messageKey/params 供 UI 层按当前 locale 渲染（i18n 治理）。
 */
export interface ValidationError {
  field: string
  message: string
  /** i18n key，缺失时回退到 message */
  messageKey?: string
  /** messageKey 对应的插值参数 */
  params?: Record<string, unknown>
  severity: 'error' | 'warning'
}

/** 构造带 i18n key 的 ValidationError 的便捷工厂 */
function vError(
  field: string,
  message: string,
  severity: 'error' | 'warning',
  messageKey: string,
  params?: Record<string, unknown>
): ValidationError {
  return { field, message, severity, messageKey, params }
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
    errors.push(vError('id', '列 ID 不能为空', 'error', 'validation.column.idEmpty'))
  }

  if (!isValidColumnName(column.columnName)) {
    errors.push(
      vError(
        'columnName',
        '列名不合法（只能包含字母、数字、下划线，不能以数字开头，长度不超过50）',
        'error',
        'validation.column.nameInvalid'
      )
    )
  }

  if (!isValidJsonPath(column.jsonPath)) {
    errors.push(
      vError(
        'jsonPath',
        'JSONPath 格式不合法（必须以 $ 开头）',
        'error',
        'validation.column.jsonPathInvalid'
      )
    )
  }

  if (!column.dataType) {
    errors.push(vError('dataType', '数据类型不能为空', 'error', 'validation.column.dataTypeEmpty'))
  }

  if (column.constraints) {
    if (column.constraints.unique && column.constraints.notNull) {
      errors.push(
        vError(
          'constraints',
          '唯一性和非空约束可以同时设置',
          'warning',
          'validation.column.uniqueAndNotNull'
        )
      )
    }

    if (column.constraints.allowedValues && column.constraints.allowedValues.length === 0) {
      errors.push(
        vError(
          'constraints.allowedValues',
          '允许值列表不能为空',
          'error',
          'validation.column.allowedValuesEmpty'
        )
      )
    }
  }

  if (column.dataType === 'array' && !column.arrayItemType) {
    errors.push(
      vError(
        'arrayItemType',
        '数组类型必须指定元素类型',
        'warning',
        'validation.column.arrayItemTypeMissing'
      )
    )
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
    errors.push(vError('columns', '列定义不能为空', 'error', 'validation.column.columnsEmpty'))
    return { isValid: false, errors }
  }

  const columnNames = new Set<string>()
  const columnIds = new Set<string>()
  const jsonPaths = new Set<string>()

  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]
    if (!column) continue
    const columnResult = validateColumn(column)

    for (const error of columnResult.errors) {
      // 透传 messageKey/params，并把字段路径与文案加上列序号前缀
      errors.push({
        ...error,
        field: `columns[${i}].${error.field}`,
        message: `第 ${i + 1} 列: ${error.message}`,
        messageKey: error.messageKey,
        params: { ...error.params, index: i + 1 },
      })
    }

    if (columnNames.has(column.columnName)) {
      errors.push(
        vError(
          'columnName',
          `列名 "${column.columnName}" 重复`,
          'error',
          'validation.column.nameDuplicate',
          {
            name: column.columnName,
          }
        )
      )
    }
    columnNames.add(column.columnName)

    if (columnIds.has(column.id)) {
      errors.push(
        vError('id', `列 ID "${column.id}" 重复`, 'error', 'validation.column.idDuplicate', {
          id: column.id,
        })
      )
    }
    columnIds.add(column.id)

    if (jsonPaths.has(column.jsonPath)) {
      errors.push(
        vError(
          'jsonPath',
          `JSONPath "${column.jsonPath}" 重复`,
          'error',
          'validation.column.jsonPathDuplicate',
          {
            path: column.jsonPath,
          }
        )
      )
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
      errors.push(
        vError(
          'jsonPath',
          `嵌套路径 "${fullPath}" 重复`,
          'error',
          'validation.column.nestedPathDuplicate',
          {
            path: fullPath,
          }
        )
      )
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
/**
 * 获取验证错误摘要
 *
 * 注意：本函数返回拼接好的字符串（历史行为）。若需按 locale 渲染，调用方应改用
 * t('validation.summary.pass') / t('validation.summary.errors', { count }) 等 key。
 * 此处保留中文兜底，不再硬编码进 i18n 以避免双重维护。
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
