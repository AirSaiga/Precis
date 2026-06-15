/**
 * @fileoverview Transform 保存编排 Composable
 *
 * 职责：
 * - 接收 Inspector 最新写入的节点数据
 * - 根据转换类型分发到对应的计算函数
 * - 调用 useTransformOutputManager 创建/更新输出节点
 *
 * 这是 TransformNode.vue 中 handleSave + 所有 generate*Output 函数的统一替代。
 */

import type { TransformNodeData, ManualDataNodeData, TransformOutputNodeData } from '@/types/nodes'
import { useGraphStore } from '@/stores/graphStore'
import { useTransformOutputManager } from './useTransformOutputManager'
import { ROW_CHANGING_TRANSFORMS } from './transformTypeRegistry'
import {
  computeStringSplit,
  computeRegexExtract,
  computeDigits,
  computeSubstring,
  computeWeightedSum,
  computeModulo,
  computeMapValue,
  computeMathExpr,
  computeReplace,
  computeStrip,
  computeUpperCase,
  computeLowerCase,
  computeDateFormat,
  computeLookup,
  computeCastType,
  computeConcat,
  computeConditionalAssign,
  computeSummary,
  resolveOutputColumns,
  mapMathExprOutputType,
  mapCastTypeOutputType,
} from './transformCalculations'

/** 从上游节点获取数据行 */
function getUpstreamRows(upstreamNode: any): string[][] {
  if (upstreamNode?.type === 'manualData') {
    return (upstreamNode.data as ManualDataNodeData).rows
  }
  if (upstreamNode?.type === 'transformOutput') {
    return (upstreamNode.data as TransformOutputNodeData).rows
  }
  return []
}

/** 从上游节点获取列数据类型 */
function getUpstreamColumnDataType(upstreamNode: any): string | undefined {
  if (upstreamNode?.type === 'manualData') {
    return (upstreamNode.data as ManualDataNodeData).columnDataType
  }
  if (upstreamNode?.type === 'transformOutput') {
    return (upstreamNode.data as TransformOutputNodeData).columnDataType
  }
  return undefined
}

export function useTransformSave() {
  const graphStore = useGraphStore()
  const { createOutputNodes } = useTransformOutputManager()

  /**
   * 执行 Transform 保存：计算输出并生成子节点
   *
   * @param nodeId - Transform 节点 ID
   */
  async function handleSave(nodeId: string): Promise<void> {
    let storeNode = graphStore.nodes.find((n) => n.id === nodeId)
    if (!storeNode) return

    // 1. 保存自身状态
    graphStore.updateNodeData(nodeId, {
      ...storeNode.data,
      saveState: 'saved',
      lastSaved: new Date().toISOString(),
    })

    // updateNodeData 使用不可变更新，必须重新获取引用
    storeNode = graphStore.nodes.find((n) => n.id === nodeId)
    if (!storeNode) return

    // 2. 自动生成输出节点
    const transformData = storeNode.data as TransformNodeData
    if (!transformData.inputFromNode) return

    const upstreamNode = graphStore.nodes.find((n) => n.id === transformData.inputFromNode)
    const upstreamType = upstreamNode?.type
    if (upstreamType !== 'manualData' && upstreamType !== 'transformOutput') return

    const upstreamRows = getUpstreamRows(upstreamNode)
    const upstreamColumnDataType = getUpstreamColumnDataType(upstreamNode)
    const oldOutputIds = transformData.outputNodeIds || []
    const basePosition = storeNode.position || { x: 0, y: 0 }

    const type = transformData.transformType

    // ============================================================
    // 按类型分发计算
    // ============================================================

    if (type === 'StringSplit') {
      const result = computeStringSplit(upstreamRows, {
        delimiter: (transformData.params?.delimiter as string) || ',',
        maxsplit: (transformData.params?.maxsplit as number) ?? -1,
      })
      const columns = resolveOutputColumns(transformData, result.columns)
      await createOutputNodes(nodeId, oldOutputIds, columns, result.rowsByColumn, basePosition)
      return
    }

    if (type === 'RegexExtract') {
      let outputColumns = transformData.outputColumns
      if (!outputColumns || outputColumns.length === 0) {
        outputColumns = ['extract_1']
      }
      const rowsByColumn = computeRegexExtract(
        upstreamRows,
        {
          pattern: (transformData.params?.pattern as string) || '',
          flags: (transformData.params?.flags as string) || '',
        },
        outputColumns
      )
      await createOutputNodes(nodeId, oldOutputIds, outputColumns, rowsByColumn, basePosition)
      return
    }

    if (type === 'Digits') {
      const rows = computeDigits(upstreamRows)
      const columns = resolveOutputColumns(transformData, 'digits')
      await createOutputNodes(nodeId, oldOutputIds, columns, [rows], basePosition)
      return
    }

    if (type === 'Substring') {
      const rows = computeSubstring(upstreamRows, {
        start: (transformData.params?.start as number) ?? 0,
        end: transformData.params?.end as number | undefined,
        length: transformData.params?.length as number | undefined,
      })
      const baseName = transformData.inputColumn || 'result'
      const columns = resolveOutputColumns(transformData, `${baseName}_result`)
      await createOutputNodes(nodeId, oldOutputIds, columns, [rows], basePosition)
      return
    }

    if (type === 'WeightedSum') {
      const rows = computeWeightedSum(
        upstreamRows,
        (transformData.params?.weights as number[]) || []
      )
      const columns = resolveOutputColumns(transformData, 'weighted_sum')
      await createOutputNodes(nodeId, oldOutputIds, columns, [rows], basePosition)
      return
    }

    if (type === 'Modulo') {
      const divisor = parseFloat(String((transformData.params?.divisor as number) ?? 1)) || 1
      const rows = computeModulo(upstreamRows, divisor)
      const columns = resolveOutputColumns(transformData, 'modulo_result')
      await createOutputNodes(nodeId, oldOutputIds, columns, [rows], basePosition)
      return
    }

    if (type === 'MapValue') {
      const mapping = (transformData.params?.mapping as Array<string | number>) || []
      const rows = computeMapValue(upstreamRows, mapping)
      const columns = resolveOutputColumns(transformData, 'mapped')
      await createOutputNodes(nodeId, oldOutputIds, columns, [rows], basePosition)
      return
    }

    if (ROW_CHANGING_TRANSFORMS.has(type)) {
      const summary = computeSummary(upstreamRows, type)
      const columns = [summary.columnName]
      await createOutputNodes(nodeId, oldOutputIds, columns, [summary.rows], basePosition)
      return
    }

    // ============================================================
    // 单列/多列变换统一分支
    // ============================================================

    const baseName = transformData.inputColumn || 'result'

    // Concat 特殊处理：遵循后端命名优先级 output_column → outputColumns[0] → concat_result
    // 否则 output_column 参数形同虚设（检查器暴露了该字段）
    const concatOutputColumn = (transformData.params?.output_column as string) || ''
    const columns =
      type === 'Concat' && concatOutputColumn
        ? [concatOutputColumn]
        : resolveOutputColumns(
            transformData,
            type === 'Concat' ? 'concat_result' : `${baseName}_result`
          )
    let rows: string[][]
    let outputDataType: string | undefined

    switch (type) {
      case 'MathExpr': {
        const outputType = (transformData.params?.output_type as string) || ''
        rows = computeMathExpr(upstreamRows, {
          expression: (transformData.params?.expression as string) || '',
          outputType,
        })
        outputDataType = outputType ? mapMathExprOutputType(outputType) : upstreamColumnDataType
        break
      }
      case 'Replace':
        rows = computeReplace(upstreamRows, {
          old: (transformData.params?.old as string) || '',
          new: (transformData.params?.new as string) || '',
          count: (transformData.params?.count as number) ?? -1,
        })
        break
      case 'Strip':
        rows = computeStrip(upstreamRows, (transformData.params?.chars as string) || '')
        break
      case 'UpperCase':
        rows = computeUpperCase(upstreamRows)
        break
      case 'LowerCase':
        rows = computeLowerCase(upstreamRows)
        break
      case 'DateFormat':
        rows = computeDateFormat(upstreamRows, {
          inputFormat: (transformData.params?.input_format as string) || '%Y-%m-%d',
          outputFormat: (transformData.params?.output_format as string) || '%Y/%m/%d',
        })
        outputDataType = 'Date'
        break
      case 'Lookup':
        rows = computeLookup(
          upstreamRows,
          (transformData.params?.mapping as Record<string, string>) || {},
          (transformData.params?.default as string) ?? undefined
        )
        break
      case 'CastType':
        {
          const targetType = (transformData.params?.target_type as string) || 'string'
          rows = computeCastType(upstreamRows, targetType)
          outputDataType = mapCastTypeOutputType(targetType)
        }
        break
      case 'Concat':
        rows = computeConcat(upstreamRows, {
          columns: (transformData.params?.columns as string) || '',
          separator: (transformData.params?.separator as string) || '',
        })
        break
      case 'ConditionalAssign':
        rows = computeConditionalAssign(upstreamRows, {
          conditions:
            (transformData.params?.conditions as Array<{
              column: string
              op: string
              value: string
            }>) || [],
          logic: (transformData.params?.logic as string) || 'and',
          then_value: (transformData.params?.then_value as string) ?? '',
          else_value: (transformData.params?.else_value as string) ?? undefined,
        })
        break
      default:
        // 未知类型：复制上游数据作为占位预览
        rows = upstreamRows
        break
    }

    await createOutputNodes(nodeId, oldOutputIds, columns, [rows], basePosition, outputDataType)
  }

  return { handleSave }
}
