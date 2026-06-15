/**
 * @file uniqueHandler.ts
 * @description 唯一性约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateInline } from '@/api/validationApi'
import { validateUnique } from '@/composables/nodes/constraints/useUnique'

register({
  kind: 'unique',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing

    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'unique',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        column_names: ctx.inlineColumnNames,
        column_data_type: ctx.columnDataType,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [
            String(response.error || '\u552F\u4E00\u6027\u6821\u9A8C\u5931\u8D25'),
          ],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u503C\u91CD\u590D'
      )
    }

    const result = await validateUnique(
      String(ctx.sourceFilePath),
      ctx.columnName,
      ctx.sheetName,
      ctx.headerRow
    )
    return {
      status: result.errorCount > 0 ? 'error' : 'pass',
      validationErrors: result.errors.map(
        (err) => `\u7B2C ${err.row + 1} \u884C: \u503C '${err.value}' \u91CD\u590D`
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
