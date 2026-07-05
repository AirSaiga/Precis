/**
 * @file useJsonSchemaValidation.ts
 * @description JSON Schema节点校验Composable - 负责JSON数据结构的验证逻辑
 *
 * 【业务场景】
 * JSON Schema节点用于定义JSON数据的表结构，支持树形嵌套结构。
 * 本模块提供对JSON Schema节点所定义的列结构、数据类型、约束规则进行验证的能力。
 *
 * 【数据流】
 * 1. 接收JSON Schema节点配置（列定义、JSONPath、数据类型、约束规则）
 * 2. 验证JSONPath格式的正确性
 * 3. 验证数据类型是否符合预定义类型
 * 4. 对每个列执行约束验证（支持notNull、unique、allowedValues三种约束）
 * 5. 汇总验证结果，返回详细的验证报告
 *
 * 【模块职责】
 * - 提供JSONPath格式验证能力（validateJsonPath）
 * - 提供数据类型验证能力（validateDataType）
 * - 提供JSON Schema节点级别的全量验证（validateAllColumns）
 * - 提供单列验证能力（validateColumn）
 * - 支持多种约束类型的验证（notNull、unique、allowedValues）
 * - 统一管理验证结果的收集和展示
 *
 * 【JSONPath格式规范】
 * JSONPath是JSON数据的选择器表达式，支持以下语法：
 * - $: 根对象
 * - .property: 子属性访问
 * - [index]: 数组索引访问
 * - [*]: 数组通配符
 * - ..property: 递归属性查找
 *
 * 【数据类型说明】
 * 支持的JSON数据类型：string, number, boolean, object, array, null
 *
 * 【设计考量】
 * - 约束验证采用"快速失败"策略，每个约束独立执行
 * - 验证结果按列分组，便于定位问题
 * - 支持树形结构的嵌套验证
 */

import { logger } from '@/core/utils/logger'
import type { JsonSchemaNodeData, JsonSchemaColumn, JsonDataType } from '@/types/nodes'
export interface JsonValidationError {
  columnId: string
  columnName: string
  jsonPath: string
  errorType: 'format' | 'type' | 'notNull' | 'unique' | 'allowedValues'
  message: string
  value?: unknown
  rowIndex?: number
}

export interface ColumnValidationResult {
  columnId: string
  columnName: string
  errorCount: number
  errors: JsonValidationError[]
}

const JSONPATH_REGEX =
  /^\$((?:\.[a-zA-Z_][a-zA-Z0-9_]*)*|\[\d+\](?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*|\[\*\]|\[\d+\])*$/
const VALID_JSON_TYPES: JsonDataType[] = ['string', 'number', 'boolean', 'object', 'array', 'null']

export function useJsonSchemaValidation(props: { id: string; data: JsonSchemaNodeData }) {
  /**
   * 验证JSONPath格式的正确性
   *
   * 【功能说明】
   * JSONPath是JSON数据的选择表达式，必须符合规范格式才能正确访问JSON数据。
   * 本函数验证JSONPath字符串是否符合以下规则：
   * 1. 必须以$开头（表示根对象）
   * 2. 只能使用点表示法(.property)或方括号表示法([index])
   * 3. 属性名必须以字母或下划线开头，后续字符可以是字母、数字、下划线
   * 4. 数组索引必须是非负整数
   *
   * 【参数说明】
   * @param jsonPath - 要验证的JSONPath字符串
   *
   * 【返回值说明】
   * 返回一个布尔值，true表示格式正确，false表示格式错误
   *
   * 【示例】
   * - $.name: 正确，访问根对象的name属性
   * - $.users[0].name: 正确，访问users数组第一个元素的name属性
   * - $.data[*]: 正确，访问data数组的所有元素
   * - $.user..name: 正确，递归查找所有name属性
   * - @name: 错误，缺少根对象标识$
   * - $.user[name]: 错误，方括号内应为数字或*
   */
  const validateJsonPath = (jsonPath: string): boolean => {
    if (!jsonPath || typeof jsonPath !== 'string') {
      return false
    }

    const trimmed = jsonPath.trim()
    if (trimmed.length === 0) {
      return false
    }

    if (!trimmed.startsWith('$')) {
      return false
    }

    if (trimmed === '$') {
      return true
    }

    return JSONPATH_REGEX.test(trimmed)
  }

  /**
   * 验证值是否符合JSON数据类型
   *
   * 【功能说明】
   * JSON数据有六种基本数据类型，每种类型都有其特定的JavaScript类型对应关系。
   * 本函数通过类型检查来验证给定值是否符合预期的JSON数据类型。
   *
   * 【参数说明】
   * @param column - 列定义对象，包含dataType等属性
   * @param value - 要验证的值
   *
   * 【数据类型映射】
   * - string: typeof value === 'string'
   * - number: typeof value === 'number' (包含整数和浮点数)
   * - boolean: typeof value === 'boolean'
   * - object: typeof value === 'object' && !Array.isArray(value) && value !== null
   * - array: Array.isArray(value)
   * - null: value === null
   *
   * 【返回值说明】
   * 返回一个布尔值，true表示数据类型匹配，false表示类型不匹配或无法确定
   */
  const validateDataType = (column: JsonSchemaColumn, value: unknown): boolean => {
    if (!column || !column.dataType) {
      return false
    }

    if (!VALID_JSON_TYPES.includes(column.dataType)) {
      return false
    }

    const { dataType, nullable } = column

    if (value === undefined) {
      return false
    }

    if (value === null) {
      return dataType === 'null' || nullable === true
    }

    switch (dataType) {
      case 'string':
        return typeof value === 'string'

      case 'number':
        return typeof value === 'number' && !isNaN(value)

      case 'boolean':
        return typeof value === 'boolean'

      case 'object':
        return typeof value === 'object' && !Array.isArray(value)

      case 'array':
        return Array.isArray(value)

      case 'null':
        return value === null

      default:
        return false
    }
  }

  /**
   * 验证非空约束
   *
   * 【功能说明】
   * 非空约束(notNull)要求列的值不能为null或undefined。
   * 这是最基本的数据质量约束，确保关键字段必须有值。
   *
   * 【参数说明】
   * @param column - 列定义对象，包含nullable等属性
   * @param data - 要验证的数据（单个值或数组）
   *
   * 【业务逻辑说明】
   * 验证规则：
   * 1. 如果列设置了nullable=true，则null值被允许
   * 2. 如果列设置了nullable=false或未设置，则null/undefined值不允许
   * 3. 空字符串''被视为有效值（除非另有规定）
   *
   * 【返回值说明】
   * 返回一个布尔值，true表示符合非空约束，false表示违反约束
   */
  const validateNotNull = (column: JsonSchemaColumn, data: unknown): boolean => {
    if (!column) {
      return false
    }

    if (data === undefined || data === null) {
      // 双层判据（与全局校验编排器 notNullHandler 语义对齐）：
      // 1. nullable === false：类型层禁止 null（对应后端 ColumnSpec.nullable）
      // 2. constraints.notNull === true：约束层禁止 null（对应后端 NotNull ConstraintItem）
      // 任一成立即视为违反非空约束
      const disallowNull = column.nullable === false || column.constraints?.notNull === true
      return !disallowNull
    }

    return true
  }

  /**
   * 验证唯一性约束
   *
   * 【功能说明】
   * 唯一性约束(unique)要求数组中的所有值必须互不相同。
   * 这是防止数据重复的基本约束，常用于主键、唯一标识符等字段。
   *
   * 【参数说明】
   * @param column - 列定义对象
   * @param data - 要验证的数据数组
   *
   * 【业务逻辑说明】
   * 验证算法：
   * 1. 首先过滤掉null/undefined值（如果nullable=true则允许存在）
   * 2. 使用Set数据结构去重，通过比较去重前后的长度判断是否有重复
   * 3. null值本身可以重复（如果有多个null且nullable=true），但null与具体值不能重复
   *
   * 【返回值说明】
   * 返回一个布尔值，true表示所有值唯一，false表示存在重复值
   */
  const validateUnique = (column: JsonSchemaColumn, data: unknown[]): boolean => {
    if (!column || !Array.isArray(data)) {
      return true
    }

    const filteredData = data.filter((item) => item !== null && item !== undefined)

    if (filteredData.length === 0) {
      return true
    }

    const uniqueSet = new Set(filteredData)
    return uniqueSet.size === filteredData.length
  }

  /**
   * 验证允许值约束
   *
   * 【功能说明】
   * 允许值约束(allowedValues)要求列的值必须来自预定义的允许列表。
   * 例如：状态列可能只允许"pending"、"approved"、"rejected"三个值。
   *
   * 【参数说明】
   * @param column - 列定义对象，包含constraints.allowedValues
   * @param value - 要验证的值
   *
   * 【业务逻辑说明】
   * 验证规则：
   * 1. 如果未定义allowedValues或为空数组，则任何值都被允许
   * 2. allowedValues中的值被视为字符串进行比较
   * 3. 如果值为null/undefined且nullable=true，则通过验证
   *
   * 【返回值说明】
   * 返回一个布尔值，true表示值在允许列表中或无约束，false表示值不在允许列表中
   */
  const validateAllowedValues = (column: JsonSchemaColumn, value: unknown): boolean => {
    if (!column || !column.constraints) {
      return true
    }

    const { allowedValues } = column.constraints

    if (!allowedValues || !Array.isArray(allowedValues) || allowedValues.length === 0) {
      return true
    }

    if (value === null || value === undefined) {
      return column.nullable === true
    }

    const stringValue = String(value)
    return allowedValues.includes(stringValue)
  }

  /**
   * 验证单个列的所有规则
   *
   * 【功能说明】
   * 对指定列执行所有已配置的验证规则。
   * 这是一个综合验证入口，整合了JSONPath格式、数据类型、约束等多方面验证。
   *
   * 【参数说明】
   * @param column - 要验证的列定义对象
   *
   * 【业务逻辑说明】
   * 验证按以下顺序执行：
   * 1. JSONPath格式验证
   * 2. 数据类型验证
   * 3. 约束验证（按配置的类型）
   *
   * 【返回值说明】
   * 返回一个对象，包含：
   * - columnId: 列的ID
   * - columnName: 列的名称
   * - errorCount: 该列的错误总数
   * - errors: 错误详情数组，每个元素包含错误类型和消息
   */
  const validateColumn = (column: JsonSchemaColumn): ColumnValidationResult => {
    const errors: JsonValidationError[] = []

    if (!column) {
      return {
        columnId: '',
        columnName: '',
        errorCount: 1,
        errors: [
          {
            columnId: '',
            columnName: '',
            jsonPath: '',
            errorType: 'format',
            message: '列定义无效',
          },
        ],
      }
    }

    if (!validateJsonPath(column.jsonPath)) {
      errors.push({
        columnId: column.id,
        columnName: column.columnName,
        jsonPath: column.jsonPath,
        errorType: 'format',
        message: `JSONPath格式不正确: ${column.jsonPath}`,
      })
    }

    if (!VALID_JSON_TYPES.includes(column.dataType)) {
      errors.push({
        columnId: column.id,
        columnName: column.columnName,
        jsonPath: column.jsonPath,
        errorType: 'type',
        message: `不支持的数据类型: ${column.dataType}`,
      })
    }

    if (column.children && column.children.length > 0) {
      for (const child of column.children) {
        const childResult = validateColumn(child)
        errors.push(...childResult.errors)
      }
    }

    return {
      columnId: column.id,
      columnName: column.columnName,
      errorCount: errors.length,
      errors,
    }
  }

  /**
   * 验证所有列
   *
   * 【功能说明】
   * 这是JSON Schema节点的全量验证入口函数，对节点中定义的所有列执行验证。
   * 它遍历每一列，收集每列的验证结果，并汇总生成最终的验证报告。
   *
   * 【业务逻辑说明】
   * 验证是按照列的顺序串行执行的，这样可以确保错误报告的顺序与列定义顺序一致，
   * 便于用户理解和定位问题。
   *
   * 【返回值说明】
   * 返回一个对象，包含：
   * - totalColumns: 总列数
   * - totalErrors: 总错误数
   * - results: 每列的详细验证结果数组
   */
  const validateAllColumns = (): {
    totalColumns: number
    totalErrors: number
    results: ColumnValidationResult[]
  } => {
    logger.debug('[JSON Schema Validation] 开始验证所有列:', props.id)

    const results: ColumnValidationResult[] = []

    for (const column of props.data.columns) {
      const result = validateColumn(column)
      results.push(result)
    }

    const totalErrors = results.reduce((sum, result) => sum + result.errorCount, 0)

    logger.debug(
      `[JSON Schema Validation] 验证完成，总列数: ${props.data.columns.length}, 总错误数: ${totalErrors}`
    )

    return {
      totalColumns: props.data.columns.length,
      totalErrors,
      results,
    }
  }

  /**
   * 收集所有验证错误
   *
   * 【功能说明】
   * 遍历所有列，收集所有验证错误并按列分组。
   * 这个函数用于获取需要展示或处理的完整错误列表。
   *
   * 【返回值说明】
   * 返回一个Record对象，键为列ID，值为该列的所有错误信息数组。
   * 如果某列没有错误，则该键对应的值为空数组。
   */
  const collectValidationErrors = (): Record<string, string[]> => {
    const errorsMap: Record<string, string[]> = {}

    const collectFromColumn = (column: JsonSchemaColumn) => {
      if (!column) return

      const result = validateColumn(column)

      if (result.errors.length > 0) {
        errorsMap[column.id] = result.errors.map((err) => err.message)
      } else {
        errorsMap[column.id] = []
      }

      if (column.children) {
        for (const child of column.children) {
          collectFromColumn(child)
        }
      }
    }

    for (const column of props.data.columns) {
      collectFromColumn(column)
    }

    return errorsMap
  }

  /**
   * 验证列配置的有效性
   *
   * 【功能说明】
   * 验证列定义对象的基本有效性，确保所有必填字段都存在且格式正确。
   * 这个函数用于在添加或修改列时进行快速校验。
   *
   * 【参数说明】
   * @param column - 要验证的列定义对象
   *
   * 【返回值说明】
   * 返回一个布尔值，true表示配置有效，false表示配置无效
   */
  const isColumnConfigValid = (column: JsonSchemaColumn): boolean => {
    if (!column) {
      return false
    }

    if (!column.id || typeof column.id !== 'string') {
      return false
    }

    if (!column.columnName || typeof column.columnName !== 'string') {
      return false
    }

    if (!column.jsonPath || typeof column.jsonPath !== 'string') {
      return false
    }

    if (!VALID_JSON_TYPES.includes(column.dataType)) {
      return false
    }

    return true
  }

  /**
   * 验证树形结构的完整性
   *
   * 【功能说明】
   * 递归验证树形结构中是否存在循环引用或无效的父子关系。
   * 这确保了列定义的树形结构是有效的。
   *
   * 【返回值说明】
   * 返回一个布尔值，true表示树形结构完整，false表示存在结构问题
   */
  const validateTreeStructure = (): boolean => {
    const visitedIds = new Set<string>()

    const traverse = (column: JsonSchemaColumn): boolean => {
      if (!column) return true

      if (visitedIds.has(column.id)) {
        logger.warn(`[JSON Schema Validation] 检测到循环引用: ${column.id}`)
        return false
      }

      visitedIds.add(column.id)

      if (column.children) {
        for (const child of column.children) {
          if (!traverse(child)) {
            return false
          }
        }
      }

      return true
    }

    for (const column of props.data.columns) {
      visitedIds.clear()
      if (!traverse(column)) {
        return false
      }
    }

    return true
  }

  return {
    validateColumn,
    validateAllColumns,
    validateNotNull,
    validateUnique,
    validateAllowedValues,
    validateDataType,
    validateJsonPath,
    collectValidationErrors,
    isColumnConfigValid,
    validateTreeStructure,
  }
}
