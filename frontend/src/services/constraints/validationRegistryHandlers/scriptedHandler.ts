/**
 * @file scriptedHandler.ts
 * @description 脚本约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateInline, validateScripted } from '@/api/validationApi'

register({
  kind: 'scripted',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const inlineScript = String(nodeData.script || '').trim()
      if (!inlineScript) {
        return {
          status: 'idle',
          validationErrors: [
            '\u8BF7\u5148\u914D\u7F6E\u811A\u672C\u540E\u518D\u8FDB\u884C\u6821\u9A8C',
          ],
          lastValidation: undefined,
        }
      }
      const response = await validateInline({
        validation_type: 'scripted',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        column_names: ctx.inlineColumnNames,
        column_data_type: ctx.columnDataType,
        validation_config: {
          script: inlineScript,
          script_name: String(nodeData.configName || 'custom_script'),
        },
        allow_unsafe_eval: true,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '\u811A\u672C\u6821\u9A8C\u5931\u8D25')],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u811A\u672C\u6821\u9A8C\u5931\u8D25'
      )
    }
    const script = String(nodeData.script || '').trim()
    if (!script) {
      return {
        status: 'idle',
        validationErrors: [
          '\u8BF7\u5148\u914D\u7F6E\u811A\u672C\u540E\u518D\u8FDB\u884C\u6821\u9A8C',
        ],
        lastValidation: undefined,
      }
    }
    const response = await validateScripted({
      validation_type: 'scripted',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      column_data_type: ctx.columnDataType,
      json_path: ctx.jsonPath,
      json_format: ctx.jsonFormat,
      record_path: ctx.recordPath,
      validation_config: {
        script,
        script_name: String(nodeData.configName || 'custom_script'),
      },
      allow_unsafe_eval: true,
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '\u811A\u672C\u6821\u9A8C\u5931\u8D25')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '\u811A\u672C\u6821\u9A8C\u5931\u8D25'
    )
  },
  resetOnDisconnect: defaultReset,
})
