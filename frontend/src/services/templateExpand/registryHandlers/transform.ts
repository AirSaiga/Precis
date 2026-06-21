/**
 * Transform 节点的模板展开后置钩子
 *
 * 模板展开走 addNodes + addEdges 直通路径，绕过了 useConnections.onConnect 中的
 * 转换计算逻辑。每个 Transform 节点需要：
 *   1. 读取上游 manualData / transformOutput 的 rows
 *   2. 通过 transformCalculations 计算输出
 *   3. 逐列写入合成 transformOutput 节点的 rows 字段
 *
 * 多列 transform（StringSplit/RegexExtract）：Stage 2c 已为每列创建独立合成节点
 * （id: output-${transformId}-${colIndex}），本 handler 按列索引逐个写入，
 * 对齐 useTransformSave 的「一列一节点」语义。
 */
import { registerTemplateExpandHandler } from '../registryCore'
import { computeTransformResult } from '@/composables/nodes/transform/transformCalculations'
import type { CustomNode } from '@/types/graph'
import type { DataType } from '@/types/common'

function readUpstreamRows(upstreamNode: CustomNode | undefined): string[][] {
  if (!upstreamNode) return []
  const data = upstreamNode.data as unknown as Record<string, unknown>
  return (data.rows as string[][]) || []
}

/** 读取上游节点的列数据类型，用于 MathExpr 等 transform 的输出类型兜底 */
function readUpstreamColumnDataType(upstreamNode: CustomNode | undefined): string | undefined {
  if (!upstreamNode) return undefined
  const data = upstreamNode.data as unknown as Record<string, unknown>
  return data.columnDataType as string | undefined
}

registerTemplateExpandHandler({
  priority: 50,
  match: (dagNode) => dagNode.kind === 'transform' && dagNode.item !== undefined,
  execute: (dagNode, ctx) => {
    const transformId = dagNode.id
    const item = dagNode.item!

    const transformNode = ctx.nodes.value.find((n) => n.id === transformId)
    if (!transformNode) return

    const transformData = transformNode.data as unknown as Record<string, unknown>

    const upstreamNodeId = (transformData.inputFromNode as string) || item.inputFromNode || null
    if (!upstreamNodeId) return
    const upstreamNode = ctx.nodes.value.find((n) => n.id === upstreamNodeId)
    const upstreamRows = readUpstreamRows(upstreamNode)
    if (upstreamRows.length === 0) return

    const transformType = (transformData.transformType as string) || item.type
    const params = (transformData.params as Record<string, unknown>) || {}

    const { columns, rowsByColumn, outputDataType } = computeTransformResult(
      transformType,
      upstreamRows,
      params,
      {
        inputColumn: transformData.inputColumn as string | undefined,
        outputColumns: transformData.outputColumns as string[] | undefined,
      }
    )
    if (columns.length === 0 || rowsByColumn.length === 0) return

    // MathExpr 特殊处理：outputType 未指定时回退到上游列数据类型（对齐 useTransformSave）
    const upstreamColumnDataType = readUpstreamColumnDataType(upstreamNode)
    const finalOutputDataType =
      transformType === 'MathExpr' && !outputDataType ? upstreamColumnDataType : outputDataType

    // 逐列写入对应的合成 transformOutput 节点（id: output-${transformId}-${i}）
    // computeTransformResult 的 mapXxxOutputType 返回 string 但运行时均为合法 DataType，这里收窄类型
    const typedOutputDataType = finalOutputDataType as DataType | undefined
    for (let i = 0; i < columns.length; i++) {
      const outputNodeId = `output-${transformId}-${i}`
      ctx.updateNodeData(outputNodeId, {
        configName: columns[i] || outputNodeId,
        columnName: columns[i] || 'output',
        rows: rowsByColumn[i] || [],
        columnDataType: typedOutputDataType,
        saveState: 'saved',
      })
    }
  },
})
