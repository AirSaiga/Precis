/**
 * @file allowedValuesHandler.ts
 * @description 允许值约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateAllowedValues, validateInline } from '@/api/validationApi'

register({
  kind: 'allowedValues',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const allowedValues = Array.from((nodeData.allowedValues || []) as unknown[])
      .map((v) => String(v).trim())
      .filter((v) => !!v && v !== '...')
    if (allowedValues.length === 0) {
      return {
        status: 'idle',
        validationErrors: [
          '\u8BF7\u5148\u914D\u7F6E\u5141\u8BB8\u503C\u5217\u8868\u540E\u518D\u8FDB\u884C\u6821\u9A8C',
        ],
        lastValidation: undefined,
      }
    }

    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'allowed_values',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        column_names: ctx.inlineColumnNames,
        column_data_type: ctx.columnDataType,
        validation_config: { allowed_values: allowedValues },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [
            String(response.error || '\u5141\u8BB8\u503C\u6821\u9A8C\u5931\u8D25'),
          ],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u503C\u4E0D\u5728\u5141\u8BB8\u503C\u5217\u8868\u4E2D'
      )
    }

    const response = await validateAllowedValues({
      validation_type: 'allowed_values',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: { allowed_values: allowedValues },
      column_data_type: ctx.columnDataType,
      json_path: ctx.jsonPath,
      json_format: ctx.jsonFormat,
      record_path: ctx.recordPath,
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '\u5141\u8BB8\u503C\u6821\u9A8C\u5931\u8D25')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '\u503C\u4E0D\u5728\u5141\u8BB8\u503C\u5217\u8868\u4E2D'
    )
  },
  resetOnDisconnect: defaultReset,
})
