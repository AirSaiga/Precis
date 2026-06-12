/**
 * @file foreignKeyHandler.ts
 * @description 外键约束验证处理器 + 目标引用解析器
 */

import type { Node } from '@vue-flow/core'
import {
  defaultReset,
  getTargetValues,
  register,
  registerTargetRefResolver,
  requireSource,
  toResult,
} from '../validationRegistryCore'
import { validateForeignKey, validateInline } from '@/api/validationApi'

register({
  kind: 'foreignKey',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>

    const targetRef = nodeData.targetRef as Record<string, unknown> | undefined
    const targetNodeId = targetRef?.nodeId as string | undefined
    const targetColumnId = targetRef?.columnId as string | undefined

    let targetColumn = ((nodeData.config as Record<string, unknown> | undefined)?.targetColumn ||
      nodeData.targetColumn) as string

    if (!targetColumn && targetColumnId && targetNodeId) {
      const targetNode = (ctx as unknown as Record<string, unknown>).nodes as Node[] | undefined
      const targetSchemaNode = targetNode?.find((n: Node) => n.id === targetNodeId)
      if (targetSchemaNode) {
        const targetSchemaData = (targetSchemaNode.data || {}) as Record<string, unknown>
        const columns = (targetSchemaData.columns || []) as Array<{
          id: string
          columnName: string
        }>
        const foundColumn = columns.find((c) => c.id === targetColumnId)
        if (foundColumn) {
          targetColumn = foundColumn.columnName
        }
      }
    }

    if (!targetNodeId || !targetColumn) {
      return {
        status: 'idle',
        validationErrors: [
          '\u8BF7\u9009\u62E9\u76EE\u6807\u5217\u540E\u518D\u8FDB\u884C\u6821\u9A8C',
        ],
        lastValidation: undefined,
      }
    }
    const targetNode = (
      (ctx as unknown as Record<string, unknown>).nodes as Node[] | undefined
    )?.find((n: Node) => n.id === targetNodeId)
    const targetValues = getTargetValues(targetNode, targetColumn, ctx.nodes)
    if (targetValues.length === 0) {
      return {
        status: 'missing',
        validationErrors: [
          '\u76EE\u6807\u8868\u7F3A\u5C11\u53EF\u7528\u6570\u636E\u6E90\u6216\u76EE\u6807\u5217\u4E0D\u5B58\u5728\uFF0C\u65E0\u6CD5\u63D0\u53D6\u53C2\u7167\u503C',
        ],
        lastValidation: undefined,
      }
    }
    const targetTable =
      (((targetNode?.data || {}) as Record<string, unknown>)?.tableName as string) ||
      (nodeData.targetTable as string) ||
      'target'

    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'foreign_key',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        validation_config: {
          target_table: targetTable,
          target_column: targetColumn as string,
          target_values: targetValues,
        },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '\u5916\u952E\u6821\u9A8C\u5931\u8D25')],
          lastValidation: undefined,
        }
      }
      const rows = response.data.error_rows || []
      const filtered = nodeData.allowNull
        ? rows.filter((err) => {
            const v = (err as unknown as Record<string, unknown>)?.cell_value
            return !(v === null || v === undefined || String(v).trim() === '')
          })
        : rows
      return toResult(
        filtered,
        response.data.total_rows || 0,
        '\u5916\u952E\u7EA6\u675F\u4E0D\u6EE1\u8DB3'
      )
    }

    const response = await validateForeignKey({
      validation_type: 'foreign_key',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: {
        target_table: targetTable,
        target_column: targetColumn as string,
        target_values: targetValues,
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '\u5916\u952E\u6821\u9A8C\u5931\u8D25')],
        lastValidation: undefined,
      }
    }
    const rows = response.data.error_rows || []
    const filtered = nodeData.allowNull
      ? rows.filter((err) => {
          const v = (err as unknown as Record<string, unknown>)?.cell_value
          return !(v === null || v === undefined || String(v).trim() === '')
        })
      : rows
    return toResult(
      filtered,
      response.data.total_rows || 0,
      '\u5916\u952E\u7EA6\u675F\u4E0D\u6EE1\u8DB3'
    )
  },
  resetOnDisconnect: defaultReset,
})

// 注册外键约束的目标引用解析器
// 当目标 Schema 的数据源就绪时，自动重新验证引用该目标的 FK 约束
registerTargetRefResolver('foreignKeyConstraint', (nodeData) => {
  const targetRef = nodeData.targetRef as Record<string, unknown> | undefined
  const configTargetNodeId = (nodeData.config as Record<string, unknown> | undefined)?.targetNodeId
  const ids: string[] = []
  if (targetRef?.nodeId) ids.push(targetRef.nodeId as string)
  if (configTargetNodeId && !ids.includes(configTargetNodeId as string)) {
    ids.push(configTargetNodeId as string)
  }
  return ids
})
