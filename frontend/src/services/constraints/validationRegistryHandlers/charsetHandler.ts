/**
 * @file charsetHandler.ts
 * @description 字符集约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateCharset, validateInline } from '@/api/validationApi'

register({
  kind: 'charset',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>

    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'charset',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        validation_config: {
          charset_mode: (nodeData.charsetMode as 'ascii' | 'chinese' | undefined) || 'ascii',
        },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '\u5B57\u7B26\u96C6\u6821\u9A8C\u5931\u8D25')],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u5B57\u7B26\u96C6\u4E0D\u7B26\u5408\u7EA6\u675F'
      )
    }

    const response = await validateCharset({
      validation_type: 'charset',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: {
        charset_mode: (nodeData.charsetMode as 'ascii' | 'chinese' | undefined) || 'ascii',
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '\u5B57\u7B26\u96C6\u6821\u9A8C\u5931\u8D25')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '\u5B57\u7B26\u96C6\u4E0D\u7B26\u5408\u7EA6\u675F'
    )
  },
  resetOnDisconnect: defaultReset,
})
