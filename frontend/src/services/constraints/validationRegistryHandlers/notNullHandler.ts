/**
 * @file notNullHandler.ts
 * @description 非空约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateInline } from '@/api/validationApi'
import { validateNotNull } from '@/composables/nodes/constraints/useNotNull'

register({
  kind: 'notNull',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing

    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'not_null',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '\u975E\u7A7A\u6821\u9A8C\u5931\u8D25')],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u503C\u4E0D\u80FD\u4E3A\u7A7A'
      )
    }

    const result = await validateNotNull(
      String(ctx.sourceFilePath),
      ctx.columnName,
      ctx.sheetName,
      ctx.headerRow
    )
    return {
      status: result.errorCount > 0 ? 'error' : 'pass',
      validationErrors: result.errors.map(
        (err) => `\u7B2C ${err.row + 1} \u884C: \u503C\u4E0D\u80FD\u4E3A\u7A7A`
      ),
      lastValidation: {
        totalRows: result.totalRows,
        errorCount: result.errorCount,
        matchCount: Math.max(0, result.totalRows - result.errorCount),
      },
    }
  },
  resetOnDisconnect: defaultReset,
})
