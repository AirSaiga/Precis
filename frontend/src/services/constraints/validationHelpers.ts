/**
 * @file validationHelpers.ts
 * @description 约束校验公共工具函数
 *
 * 提供 handler 复用的工具：默认重置、结果构建、数据源检查、目标值提取。
 * 这些纯函数被 10 个 handler 文件广泛使用，是 handler 实现的基础设施。
 */

import type { Node } from '@vue-flow/core'

import type { ConstraintValidationContext, ConstraintValidationResult } from './types'
import { extractJsonTargetValues } from '@/utils/nodes/json/columnFinder'

/**
 * 默认断连重置：将校验状态恢复为 idle
 *
 * 断开连接时，约束节点的 validationStatus → 'idle'、validationErrors → []、lastValidation → undefined。
 * 特殊约束（如 ForeignKey）可在 handler 中自定义 resetOnDisconnect 覆盖此行为。
 */
export const defaultReset = (nodeData: Record<string, unknown>) => ({
  ...nodeData,
  validationStatus: 'idle',
  validationErrors: [],
  lastValidation: undefined,
})

/**
 * 将后端返回的错误行列表转换为标准 ConstraintValidationResult
 *
 * @param errorRows - 后端 API 返回的错误行数组
 * @param totalRows - 总行数
 * @param fallbackMessage - 错误行缺少 message 时的兜底文案
 */
export const toResult = (
  errorRows: unknown[] | undefined,
  totalRows: number,
  fallbackMessage: string
): ConstraintValidationResult => {
  const rows = Array.isArray(errorRows) ? errorRows : []
  const errorCount = rows.length
  const messages = rows.map((err) => {
    const errRec = err as Record<string, unknown>
    const row = typeof errRec?.row_index === 'number' ? (errRec.row_index as number) + 1 : '-'
    const msg = (errRec?.error_message as string) || fallbackMessage
    return `第 ${row} 行: ${msg}`
  })
  return {
    status: errorCount > 0 ? 'error' : 'pass',
    validationErrors: messages,
    lastValidation: {
      totalRows,
      errorCount,
      matchCount: Math.max(0, totalRows - errorCount),
    },
  }
}

/**
 * 数据源防护检查
 *
 * 所有 handler 首先调用此函数检查数据源是否就绪：
 * - 如果缺少 sourceFile/sourceFilePath 且无 inlineRows，返回 idle 状态（跳过校验）
 * - 行内数据源（TransformOutput/ManualData）通过 inlineRows 传递数据，无需文件路径
 *
 * @returns null 表示数据源就绪可继续校验；非 null 表示应直接返回该结果
 */
export const requireSource = (
  ctx: ConstraintValidationContext
): ConstraintValidationResult | null => {
  // 行内数据源（TransformOutput / ManualData）无需文件路径
  if (ctx.inlineRows && ctx.inlineRows.length > 0) {
    return null
  }
  if (!ctx.sourceFile || !ctx.sourceFilePath) {
    return { status: 'idle', validationErrors: [], lastValidation: undefined }
  }
  return null
}

/**
 * 提取目标 Schema 节点指定列的全部唯一值（用于外键参照完整性检查）
 *
 * 支持 Tabular 数据源（sourcePreview/schema）和 JSON 数据源（jsonSourcePreview/jsonSchema）。
 * JSON 路径委托给 extractJsonTargetValues（含 50000 条上限保护）。
 *
 * @param targetSchemaNode - 目标 Schema 节点
 * @param targetColumnName - 要提取的列名
 * @param nodes - 画布所有节点（用于查找关联的 SourcePreview 节点）
 * @returns 去重后的值列表
 */
export const getTargetValues = (
  targetSchemaNode: Node | undefined,
  targetColumnName: string,
  nodes?: Node[]
): string[] => {
  if (
    !targetSchemaNode ||
    (targetSchemaNode.type !== 'schema' &&
      targetSchemaNode.type !== 'jsonSchema' &&
      targetSchemaNode.type !== 'sourcePreview' &&
      targetSchemaNode.type !== 'jsonSourcePreview')
  )
    return []

  const targetSchemaData = (targetSchemaNode.data || {}) as Record<string, unknown>

  // JSON 数据源：直接从 rawData 对象数组中提取字段值
  if (targetSchemaNode.type === 'jsonSourcePreview') {
    const rawData = (targetSchemaData?.rawData as unknown[]) || []
    return extractJsonTargetValues(rawData, targetColumnName)
  }

  if (targetSchemaNode.type === 'jsonSchema') {
    let rawData: unknown[] = []
    if (Array.isArray(targetSchemaData?.originalData) || Array.isArray(targetSchemaData?.data)) {
      rawData =
        (targetSchemaData?.originalData as unknown[]) || (targetSchemaData?.data as unknown[]) || []
    } else if (nodes) {
      const sourceNodeId = targetSchemaData?.sourceNodeId as string | undefined
      if (sourceNodeId) {
        const sourcePreviewNode = nodes.find((n) => n.id === sourceNodeId)
        if (sourcePreviewNode?.type === 'jsonSourcePreview') {
          rawData = ((sourcePreviewNode.data || {}) as Record<string, unknown>)
            ?.rawData as unknown[]
        }
      }
    }
    return extractJsonTargetValues(rawData, targetColumnName)
  }

  // Tabular 数据源
  let rows =
    (targetSchemaData?.originalData as unknown[]) || (targetSchemaData?.data as unknown[]) || []

  // 如果 Schema 节点自身没有数据行，尝试从关联的 SourcePreview 节点获取
  if ((!Array.isArray(rows) || rows.length === 0) && nodes) {
    const sourceNodeId = targetSchemaData?.sourceNodeId as string | undefined
    if (sourceNodeId) {
      const sourcePreviewNode = nodes.find((n) => n.id === sourceNodeId)
      if (sourcePreviewNode?.type === 'sourcePreview') {
        const spData = (sourcePreviewNode.data || {}) as Record<string, unknown>
        rows = (spData?.data as unknown[]) || []
      }
    }
  }

  if (!Array.isArray(rows) || rows.length === 0) return []
  const headerRowIndex =
    typeof targetSchemaData?.headerRow === 'number' ? (targetSchemaData.headerRow as number) : 0
  const header = (rows[headerRowIndex] as unknown[]) || []
  const colIndex = Array.isArray(header)
    ? header.findIndex((h) => String(h ?? '').trim() === targetColumnName)
    : -1
  if (colIndex < 0) return []
  const values = rows
    .slice(headerRowIndex + 1)
    .map((r) => (Array.isArray(r) ? (r as unknown[])[colIndex] : undefined))
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .map((v) => String(v))
  return Array.from(new Set(values))
}
