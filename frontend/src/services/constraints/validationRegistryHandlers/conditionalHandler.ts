/**
 * @file conditionalHandler.ts
 * @description 条件约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateConditional, validateInline } from '@/api/validationApi'
import type { ConditionalValidationRequest } from '@/api/validation/core'

type IfCondition = NonNullable<
  NonNullable<ConditionalValidationRequest['validation_config']>['if_conditions']
>[number]

register({
  kind: 'conditional',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
      const hasThen = !!(nodeData.thenRef as Record<string, unknown> | undefined)?.columnId
      if (!hasThen) {
        return { status: 'idle', validationErrors: [], lastValidation: undefined }
      }
      const thenColumnName = ctx.columnName
      const hasIf =
        (Array.isArray(nodeData.ifConditions) && nodeData.ifConditions.length > 0) ||
        !!(nodeData.ifRef as Record<string, unknown> | undefined)?.columnId
      const skipIf = !!nodeData.skipIfCondition
      if (!hasIf && !skipIf) {
        return {
          status: 'idle',
          validationErrors: [
            '\u672A\u914D\u7F6E IF \u6761\u4EF6\uFF0C\u8BF7\u8FDE\u63A5 IF \u5217\u6216\u542F\u7528\u201C\u65E0\u6761\u4EF6\u89E6\u53D1\u201D',
          ],
          lastValidation: undefined,
        }
      }
      const validationConfig: Record<string, unknown> = {
        if_logic: (nodeData.ifLogic as 'and' | 'or' | undefined) || 'and',
        then_column: thenColumnName,
        then_condition: nodeData.thenConditionConfig as string | Record<string, unknown>,
        then_condition_config: nodeData.thenConditionConfig as string | Record<string, unknown>,
      }
      if (skipIf) {
        validationConfig.if_conditions = []
      } else {
        const rawIfConditions =
          Array.isArray(nodeData.ifConditions) && nodeData.ifConditions.length > 0
            ? nodeData.ifConditions
            : [{ ref: nodeData.ifRef, operator: 'eq', value: nodeData.ifValue }]
        const normalizedIf = rawIfConditions.map((c) => {
          const cond = c as { operator?: string; value?: unknown; values?: unknown[] }
          return {
            if_column: ctx.columnName,
            operator: cond.operator || 'eq',
            value: cond.value,
            values: Array.isArray(cond.values) ? cond.values : undefined,
          }
        })
        validationConfig.if_conditions = normalizedIf
        validationConfig.if_column = normalizedIf[0]?.if_column
        validationConfig.if_value = normalizedIf[0]?.value
      }
      const response = await validateInline({
        validation_type: 'conditional',
        target_column_name: thenColumnName,
        rows: ctx.inlineRows,
        column_names: ctx.inlineColumnNames,
        column_data_type: ctx.columnDataType,
        validation_config: validationConfig,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [
            String(response.error || '\u6761\u4EF6\u7EA6\u675F\u6821\u9A8C\u5931\u8D25'),
          ],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u4E0D\u6EE1\u8DB3\u6761\u4EF6'
      )
    }
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const ifConditions = Array.isArray(nodeData.ifConditions)
      ? (nodeData.ifConditions as unknown[])
      : []
    const hasIf =
      ifConditions.length > 0 || !!(nodeData.ifRef as Record<string, unknown> | undefined)?.columnId
    const hasThen = !!(nodeData.thenRef as Record<string, unknown> | undefined)?.columnId
    if (!hasIf || !hasThen) {
      return { status: 'idle', validationErrors: [], lastValidation: undefined }
    }
    type ColumnLike = { id?: string; columnName?: string }
    const schemaColumns = (((ctx.schemaNode.data || {}) as Record<string, unknown>).columns ||
      []) as ColumnLike[]
    const thenColumnName = schemaColumns.find(
      (c) => c.id === (nodeData.thenRef as Record<string, unknown>)?.columnId
    )?.columnName
    if (!thenColumnName) {
      return {
        status: 'missing',
        validationErrors: ['IF/THEN \u5217\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664'],
        lastValidation: undefined,
      }
    }
    const normalizedIf = (
      ifConditions.length > 0
        ? ifConditions
        : [
            {
              ref: nodeData.ifRef,
              operator: 'eq',
              value: nodeData.ifValue,
            },
          ]
    )
      .map((c) => {
        const cond = c as {
          ref?: { columnId?: string }
          operator?: string
          value?: unknown
          values?: unknown[]
        }
        return {
          if_column: schemaColumns.find((x) => x.id === cond.ref?.columnId)?.columnName || '',
          operator: cond.operator as 'eq' | 'neq' | 'in' | 'not_null' | 'greater_than',
          value: cond.value as string | number | boolean | undefined,
          values: Array.isArray(cond.values)
            ? (cond.values as (string | number | boolean)[])
            : undefined,
        }
      })
      .filter((c) => !!c.if_column) as IfCondition[]
    if (normalizedIf.length === 0) {
      return {
        status: 'missing',
        validationErrors: ['IF/THEN \u5217\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664'],
        lastValidation: undefined,
      }
    }
    const response = await validateConditional({
      validation_type: 'conditional',
      target_column_name: thenColumnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      column_data_type: ctx.columnDataType,
      json_path: ctx.jsonPath,
      json_format: ctx.jsonFormat,
      record_path: ctx.recordPath,
      validation_config: {
        if_logic: (nodeData.ifLogic as 'and' | 'or' | undefined) || 'and',
        if_conditions: normalizedIf,
        if_column: normalizedIf[0]?.if_column,
        if_value: normalizedIf[0]?.value,
        then_column: thenColumnName,
        then_condition: nodeData.thenConditionConfig as string | Record<string, unknown>,
        then_condition_config: nodeData.thenConditionConfig as string | Record<string, unknown>,
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [
          String(response.error || '\u6761\u4EF6\u7EA6\u675F\u6821\u9A8C\u5931\u8D25'),
        ],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '\u4E0D\u6EE1\u8DB3\u6761\u4EF6'
    )
  },
  resetOnDisconnect: defaultReset,
})
