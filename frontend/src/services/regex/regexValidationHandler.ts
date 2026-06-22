/**
 * @file regexValidationHandler.ts
 * @description Regex node validation handler (edge-driven)
 *
 * Extracted from useRegexValidation.performRegexValidation.
 * Standalone function that receives pre-resolved source info.
 *
 * Supports two upstream types:
 * - Schema / jsonSchema: via sourcePreview -> extract column data -> API validation
 * - TransformOutput / manualData: directly from node rows -> API validation
 *
 * Extract mode: performs derived column writeback to Schema/SourcePreview nodes.
 */

import { logger } from '@/core/utils/logger'
import type { Edge, Node } from '@vue-flow/core'
import type { CustomNode, SchemaNodeData, SourcePreviewNodeData, SchemaColumn } from '@/types/graph'
import type { DataType } from '@/types/common'
import { validateAndExtractRegex } from '@/features/regex/services/regexExtractService'
import {
  coerceExtractedValue,
  outputParamTypeToDataType,
  parseOutputMappingValue,
} from '@/features/regex/services/regexOutputMapping'
import {
  ensureUniqueColumnNames,
  removeDerivedColumns,
} from '@/features/regex/composables/regexExtractUtils'
import { findEdge } from '@/services/canvas/vueFlowApi'
import { buildValidationContext } from '@/services/constraints/validationContext'

export interface RegexValidationResult {
  validationStatus: 'pass' | 'error' | 'idle'
  errorCount: number | undefined
  totalRows: number | undefined
  matchCount: number | undefined
  lastValidationTime: string | undefined
  columnId?: string
}

export async function validateRegexNode(params: {
  regexNode: CustomNode
  sourceNode: CustomNode
  columnName: string
  columnId?: string
  nodes: CustomNode[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  signal?: AbortSignal
}): Promise<RegexValidationResult | null> {
  const { regexNode, sourceNode, columnName, columnId, nodes, edges, updateNodeData, signal } =
    params
  const regexData = regexNode.data as unknown as Record<string, unknown>

  if (sourceNode.type === 'transformOutput' || sourceNode.type === 'manualData') {
    return validateRegexFromRows({
      regexNode,
      sourceNode,
      columnName,
      columnId,
      nodes,
      edges,
      updateNodeData,
      signal,
    })
  }

  const schemaNode = sourceNode
  const schemaData = schemaNode.data as SchemaNodeData

  if (!schemaData.sourceFile) {
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'idle',
      validationErrors: [],
      errorCount: undefined,
      totalRows: undefined,
      matchCount: undefined,
      lastValidationTime: undefined,
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'idle')
    return buildResult('idle', undefined, undefined, undefined, undefined, columnId)
  }

  if (regexData.matchMode === 'extract') {
    const extractResult = await tryUpdateExtractDerivedColumns({
      regexNode,
      schemaNode,
      columnName,
      columnId,
      nodes,
      edges,
      updateNodeData,
      signal,
    })
    if (extractResult !== null) return { ...extractResult, columnId }
  }

  if (regexData.matchMode === 'extract') {
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'idle',
      errorCount: undefined,
      totalRows: undefined,
      matchCount: undefined,
      lastValidationTime: undefined,
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'idle')
    return buildResult('idle', undefined, undefined, undefined, undefined, columnId)
  }

  if (!schemaData.sourceNodeId) return null

  const sourcePreviewNode = nodes.find(
    (n) => n.id === schemaData.sourceNodeId && n.type === 'sourcePreview'
  )
  if (!sourcePreviewNode) return null

  const sourceData = sourcePreviewNode.data as SourcePreviewNodeData
  const tableData: unknown[][] = Array.isArray(
    (sourceData as unknown as Record<string, unknown>).data
  )
    ? ((sourceData as unknown as Record<string, unknown>).data as unknown[][])
    : []

  const headerRowIndex =
    typeof schemaData.headerRow === 'number'
      ? schemaData.headerRow
      : typeof (sourceData as unknown as Record<string, unknown>).headerRow === 'number'
        ? ((sourceData as unknown as Record<string, unknown>).headerRow as number)
        : 0

  const headerRow = (tableData[headerRowIndex] || []).map((v) => String(v ?? '').trim())
  if (headerRow.length === 0) return null

  const targetColumnIndex = headerRow.findIndex((name) => name === String(columnName).trim())
  if (targetColumnIndex < 0) return null

  const dataStartIndex = headerRowIndex + 1
  const values = tableData
    .slice(dataStartIndex)
    .map((row) => String((row as unknown[])?.[targetColumnIndex] ?? ''))

  if (!String(regexData.pattern || '').trim()) {
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'idle',
      errorCount: undefined,
      totalRows: undefined,
      matchCount: undefined,
      lastValidationTime: undefined,
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'idle')
    return buildResult('idle', undefined, undefined, undefined, undefined, columnId)
  }

  const matchMode: 'full' | 'partial' = regexData.matchMode === 'partial' ? 'partial' : 'full'
  const request = {
    regex_pattern: regexData.pattern as string,
    regex_flags: (regexData.flags as string) || '',
    match_mode: matchMode,
    case_sensitive: regexData.caseSensitive !== false,
    values,
  }

  try {
    const data = (await validateAndExtractRegex(request, signal)) as unknown as Record<
      string,
      unknown
    >
    const status: 'pass' | 'error' = data.error_count === 0 ? 'pass' : 'error'
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: status,
      errorCount: Number(data.error_count),
      totalRows: Number(data.total_rows),
      matchCount: Number(data.match_count),
      lastValidationTime: new Date().toISOString(),
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, status)
    return buildResult(
      status,
      Number(data.error_count),
      Number(data.total_rows),
      Number(data.match_count),
      new Date().toISOString(),
      columnId
    )
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      return null
    }
    const totalRows = values.length
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'error',
      errorCount: totalRows,
      totalRows,
      matchCount: 0,
      lastValidationTime: new Date().toISOString(),
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'error')
    return buildResult('error', totalRows, totalRows, 0, new Date().toISOString(), columnId)
  }
}

export interface RegexValidationSummary {
  totalValid: number
  totalInvalid: number
  totalErrorCount: number
  columnErrorMap: Map<string, string[]>
}

/**
 * 对指定 Schema 的所有 Regex 边执行校验（从 validationRegistryCore 拆出）
 *
 * @param params.schemaNode - Schema 源节点
 * @param params.schemaEdges - 从 Schema 出发的所有边
 * @param params.nodes - 画布所有节点
 * @param params.edges - 画布所有边
 * @param params.updateNodeData - 更新节点数据的回调
 * @returns 校验汇总结果；无 Regex 边时返回 null
 */
export async function validateRegexNodesForSchema(params: {
  schemaNode: CustomNode
  schemaEdges: Edge[]
  nodes: CustomNode[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<RegexValidationSummary | null> {
  const { schemaNode, schemaEdges, nodes, edges, updateNodeData } = params

  const regexEdges = schemaEdges.filter((e) => {
    const node = nodes.find((n) => n.id === e.target)
    return node?.type === 'regex'
  })

  if (regexEdges.length === 0) return null

  const columnErrorMap = new Map<string, string[]>()
  let totalValid = 0
  let totalInvalid = 0
  let totalErrorCount = 0

  for (const edge of regexEdges) {
    const regexNode = nodes.find((n) => n.id === edge.target)
    if (!regexNode) continue

    const regexData = regexNode.data as unknown as Record<string, unknown>
    // extract 模式的正则节点会产生派生列写回副作用，
    // 仅在用户显式点击校验时触发，全局/自动化校验跳过。
    if (regexData.matchMode === 'extract') continue

    const ctx = buildValidationContext({ schemaNode, constraintNode: regexNode, edge, nodes })
    if (!ctx) continue

    const result = await validateRegexNode({
      regexNode: regexNode as CustomNode,
      sourceNode: schemaNode as CustomNode,
      columnName: ctx.columnName,
      columnId: ctx.columnId,
      nodes: nodes as CustomNode[],
      edges,
      updateNodeData,
    })

    if (!result) continue

    if (result.validationStatus === 'pass') {
      totalValid++
    } else if (result.validationStatus === 'error') {
      totalInvalid++
      totalErrorCount += result.errorCount || 0
    }

    if (result.errorCount && result.errorCount > 0) {
      const existing = columnErrorMap.get(ctx.columnId) || []
      const regexErrors = [`Regex: ${result.errorCount} errors`]
      columnErrorMap.set(ctx.columnId, [...existing, ...regexErrors])
    }
  }

  return {
    totalValid,
    totalInvalid,
    totalErrorCount,
    columnErrorMap,
  }
}

function buildResult(
  status: 'pass' | 'error' | 'idle',
  errorCount: number | undefined,
  totalRows: number | undefined,
  matchCount: number | undefined,
  lastValidationTime: string | undefined,
  columnId?: string
): RegexValidationResult {
  return {
    validationStatus: status,
    errorCount,
    totalRows,
    matchCount,
    lastValidationTime,
    columnId,
  }
}

async function validateRegexFromRows(params: {
  regexNode: CustomNode
  sourceNode: CustomNode
  columnName: string
  columnId?: string
  nodes: CustomNode[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  signal?: AbortSignal
}): Promise<RegexValidationResult | null> {
  const { regexNode, sourceNode, columnName, columnId, nodes, edges, updateNodeData, signal } =
    params
  const regexData = regexNode.data as unknown as Record<string, unknown>

  if (!String(regexData.pattern || '').trim()) {
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'idle',
      errorCount: undefined,
      totalRows: undefined,
      matchCount: undefined,
      lastValidationTime: undefined,
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'idle')
    return buildResult('idle', undefined, undefined, undefined, undefined, columnId)
  }

  const sourceData = sourceNode.data as unknown as Record<string, unknown>
  const values = Array.isArray((sourceData as Record<string, unknown>).rows)
    ? ((sourceData as Record<string, unknown>).rows as unknown[]).map((r) =>
        String((r as unknown[])?.[0] ?? '')
      )
    : []

  const matchMode: 'full' | 'partial' | 'extract' =
    regexData.matchMode === 'extract'
      ? 'full'
      : regexData.matchMode === 'partial'
        ? 'partial'
        : 'full'

  const request = {
    regex_pattern: regexData.pattern as string,
    regex_flags: (regexData.flags as string) || '',
    match_mode: matchMode,
    case_sensitive: regexData.caseSensitive !== false,
    values,
  }

  try {
    const data = (await validateAndExtractRegex(request, signal)) as unknown as Record<
      string,
      unknown
    >
    const status: 'pass' | 'error' = data.error_count === 0 ? 'pass' : 'error'
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: status,
      errorCount: Number(data.error_count),
      totalRows: Number(data.total_rows),
      matchCount: Number(data.match_count),
      lastValidationTime: new Date().toISOString(),
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, status)
    return buildResult(
      status,
      Number(data.error_count),
      Number(data.total_rows),
      Number(data.match_count),
      new Date().toISOString(),
      columnId
    )
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      return null
    }
    const totalRows = values.length
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'error',
      errorCount: totalRows,
      totalRows,
      matchCount: 0,
      lastValidationTime: new Date().toISOString(),
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'error')
    return buildResult('error', totalRows, totalRows, 0, new Date().toISOString(), columnId)
  }
}

function updateRegexConnectionEdgesForNode(
  regexNodeId: string,
  edges: Edge[],
  validationStatus: 'pass' | 'error' | 'idle'
) {
  try {
    for (const edge of edges) {
      if (edge.target !== regexNodeId || edge.label !== 'Regex Validation') continue
      let className = ''
      if (typeof edge.class === 'string') {
        className = edge.class
          .replace(/validation-pass/g, '')
          .replace(/validation-error/g, '')
          .replace(/validation-idle/g, '')
          .trim()
      }
      const updatedClassName =
        validationStatus === 'idle'
          ? className
          : `${className} validation-${validationStatus}`.trim()
      const vfEdge = findEdge(edge.id)
      if (vfEdge) {
        vfEdge.class = updatedClassName || undefined
      }
    }
  } catch (error) {
    logger.error('update connection edges failed:', error)
  }
}

async function tryUpdateExtractDerivedColumns(params: {
  regexNode: CustomNode
  schemaNode: CustomNode
  columnName: string
  columnId?: string
  nodes: CustomNode[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  signal?: AbortSignal
}): Promise<RegexValidationResult | null> {
  const { regexNode, schemaNode, columnName, columnId, nodes, edges, updateNodeData, signal } =
    params
  const regexData = regexNode.data as unknown as Record<string, unknown>
  const schemaData = schemaNode.data as SchemaNodeData

  if (regexData.matchMode !== 'extract') return null
  if (!schemaData.sourceNodeId) return null

  const sourcePreviewNode = nodes.find(
    (n) => n.id === schemaData.sourceNodeId && n.type === 'sourcePreview'
  )
  if (!sourcePreviewNode) return null

  const sourceData = sourcePreviewNode.data as SourcePreviewNodeData
  const tableData: unknown[][] = Array.isArray(
    (sourceData as unknown as Record<string, unknown>).data
  )
    ? ((sourceData as unknown as Record<string, unknown>).data as unknown[][])
    : []

  const headerRowIndex =
    typeof schemaData.headerRow === 'number'
      ? schemaData.headerRow
      : typeof (sourceData as unknown as Record<string, unknown>).headerRow === 'number'
        ? ((sourceData as unknown as Record<string, unknown>).headerRow as number)
        : 0

  const headerRow = (tableData[headerRowIndex] || []).map((v) => String(v ?? '').trim())
  if (headerRow.length === 0) return null

  const targetColumnIndex = headerRow.findIndex((name) => name === String(columnName).trim())
  if (targetColumnIndex < 0) return null

  const dataStartIndex = headerRowIndex + 1
  const values = tableData
    .slice(dataStartIndex)
    .map((row) => String((row as unknown[])?.[targetColumnIndex] ?? ''))

  const request = {
    regex_pattern: regexData.pattern as string,
    regex_flags: (regexData.flags as string) || '',
    match_mode: 'extract' as const,
    case_sensitive: regexData.caseSensitive !== false,
    values,
  }

  if (!String(request.regex_pattern || '').trim()) {
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'idle',
      errorCount: undefined,
      totalRows: undefined,
      matchCount: undefined,
      lastValidationTime: undefined,
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'idle')
    return buildResult('idle', undefined, undefined, undefined, undefined, columnId)
  }

  let data: Record<string, unknown>
  try {
    data = (await validateAndExtractRegex(request, signal)) as unknown as Record<string, unknown>
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      return null
    }
    const totalRows = values.length
    updateNodeData(regexNode.id, {
      ...regexData,
      validationStatus: 'error',
      errorCount: totalRows,
      totalRows,
      matchCount: 0,
      lastValidationTime: new Date().toISOString(),
    })
    updateRegexConnectionEdgesForNode(regexNode.id, edges, 'error')
    return buildResult('error', totalRows, totalRows, 0, new Date().toISOString(), columnId)
  }

  const validationStatus: 'pass' | 'error' = data.error_count === 0 ? 'pass' : 'error'
  updateNodeData(regexNode.id, {
    ...regexData,
    validationStatus,
    errorCount: Number(data.error_count),
    totalRows: Number(data.total_rows),
    matchCount: Number(data.match_count),
    lastValidationTime: new Date().toISOString(),
  })
  updateRegexConnectionEdgesForNode(regexNode.id, edges, validationStatus)

  const groupNames: string[] = Array.isArray(data.group_names) ? (data.group_names as string[]) : []
  const extractedColumns: Record<string, string[]> =
    (data.extracted_columns as Record<string, string[]> | undefined) || {}

  const outputMapping = (regexData.rules as unknown[] | undefined)?.[0] as unknown as
    | Record<string, unknown>
    | undefined
  const outputEntries = Object.entries(
    (outputMapping?.output as Record<string, unknown>) || {}
  ).filter(([k]) => String(k ?? '').trim() !== '')
  const hasOutputMapping = outputEntries.length > 0
  if (!hasOutputMapping && groupNames.length === 0)
    return buildResult(
      validationStatus,
      Number(data.error_count),
      Number(data.total_rows),
      Number(data.match_count),
      new Date().toISOString(),
      columnId
    )

  const { data: cleanedSourceData } = removeDerivedColumns(
    sourceData as unknown as Record<string, unknown>,
    regexNode.id,
    headerRowIndex
  )
  const cleanedMatrix: unknown[][] = Array.isArray(
    (cleanedSourceData as unknown as Record<string, unknown>).data
  )
    ? ((cleanedSourceData as unknown as Record<string, unknown>).data as unknown[][])
    : []
  const cleanedHeader = (cleanedMatrix[headerRowIndex] || []).map((v) => String(v ?? '').trim())
  const existingNames = new Set(cleanedHeader)
  const suffix = String(regexNode.id).slice(0, 6)

  const derivedSourceKeys = hasOutputMapping ? outputEntries.map(([k]) => String(k)) : groupNames
  const derivedColumnDataTypes: DataType[] = hasOutputMapping
    ? outputEntries.map(([, v]) => {
        const binding = parseOutputMappingValue(v)
        return binding.kind === 'param' ? outputParamTypeToDataType(binding.type) : 'String'
      })
    : groupNames.map(() => 'String')

  const newColumnNames = ensureUniqueColumnNames(derivedSourceKeys, existingNames, suffix)

  const mappedValueLists = hasOutputMapping
    ? outputEntries.map(([, v]) => {
        const binding = parseOutputMappingValue(v)
        if (binding.kind === 'static') {
          return Array.from({ length: values.length }, () => binding.value)
        }
        const rawList = extractedColumns[binding.name] || []
        return Array.from({ length: values.length }, (_, idx) =>
          coerceExtractedValue(String(rawList[idx] ?? ''), binding.type)
        )
      })
    : []

  const nextMatrix = cleanedMatrix.map((row, rowIndex) => {
    const nextRow = Array.isArray(row) ? [...row] : []
    if (rowIndex === headerRowIndex) {
      nextRow.push(...newColumnNames)
      return nextRow
    }
    if (rowIndex < dataStartIndex) {
      nextRow.push(...newColumnNames.map(() => ''))
      return nextRow
    }
    const dataRowIndex = rowIndex - dataStartIndex
    if (hasOutputMapping) {
      for (let i = 0; i < mappedValueLists.length; i++) {
        const valueList = mappedValueLists[i] || []
        nextRow.push(String(valueList[dataRowIndex] ?? ''))
      }
    } else {
      for (let i = 0; i < groupNames.length; i++) {
        const groupName = groupNames[i]
        if (groupName === undefined) continue
        const valueList = extractedColumns[groupName] || []
        nextRow.push(String(valueList[dataRowIndex] ?? ''))
      }
    }
    return nextRow
  })

  const nextSourceData: Record<string, unknown> = {
    ...(cleanedSourceData as unknown as Record<string, unknown>),
    data: nextMatrix,
    actualColCount: (nextMatrix[headerRowIndex] || []).length,
    colCount: (nextMatrix[headerRowIndex] || []).length,
    totalCols: (nextMatrix[headerRowIndex] || []).length,
    previewColCount: (nextMatrix[headerRowIndex] || []).length,
    derivedColumnsByRegex: {
      ...(((cleanedSourceData as unknown as Record<string, unknown>)
        .derivedColumnsByRegex as Record<string, unknown>) || {}),
      [regexNode.id]: { columnNames: newColumnNames, groupNames: derivedSourceKeys },
    },
  }

  updateNodeData(sourcePreviewNode.id, nextSourceData)

  const keptColumns = (schemaData.columns || []).filter(
    (c) =>
      !String((c as unknown as Record<string, unknown>).id || '').startsWith(
        `extract-${regexNode.id}-`
      )
  )
  const existingSchemaColumnNames = new Set(
    keptColumns.map((c) => (c as unknown as Record<string, unknown>).columnName as string)
  )

  const updatedColumns = keptColumns.map((col) => {
    const { extracted_keys, ...rest } = col as unknown as Record<string, unknown>
    return rest
  })

  const appendedColumns = [...updatedColumns]

  for (let i = 0; i < newColumnNames.length; i++) {
    const sourceKey = derivedSourceKeys[i]
    const columnNameResolved = newColumnNames[i]
    if (columnNameResolved === undefined) continue
    if (existingSchemaColumnNames.has(columnNameResolved)) continue
    appendedColumns.push({
      id: columnNameResolved,
      columnName: columnNameResolved,
      dataType: derivedColumnDataTypes[i] || 'String',
      extractedConfig: {
        sourceColumn: columnName,
        extractKey: sourceKey,
        resultType: derivedColumnDataTypes[i] || 'String',
      },
      constraints: {},
      validationErrors: [],
    } as Record<string, unknown>)
  }

  updateNodeData(schemaNode.id, {
    ...schemaData,
    columns: appendedColumns as unknown as SchemaColumn[],
    saveState: 'draft',
    updatedAt: new Date().toISOString(),
  })

  return buildResult(
    validationStatus,
    Number(data.error_count),
    Number(data.total_rows),
    Number(data.match_count),
    new Date().toISOString(),
    columnId
  )
}
