/**
 * @fileoverview ForeignKey builder — FK 特殊双引用处理
 *
 * FK 约束有两个列引用（sourceRef + targetRef），
 * 需要创建两条边：一条约束输入边 + 一条 FK 展示边。
 */

import type { BuildInput, BuildResult } from './types'
import { registerBuilder } from './registry'

function buildForeignKey(input: BuildInput): BuildResult {
  const { fkRefs, tableName, configName, nodeId, mode, saveState, embedded } = input

  if (!fkRefs) {
    // 缺少 FK 引用，降级为空数据
    return {
      nodeData: {
        configName,
        saveState: saveState || (mode === 'connect' ? 'draft' : 'saved'),
      },
      edgeDescriptors: [],
    }
  }

  const nodeData: Record<string, unknown> = {
    configName,
    sourceTable: fkRefs.source.columnName ? tableName : '',
    sourceColumn: fkRefs.source.columnName,
    targetTable: fkRefs.target.columnName
      ? input.refs?.to_table_name
        ? String(input.refs.to_table_name)
        : ''
      : '',
    targetColumn: fkRefs.target.columnName,
    validationStatus: 'idle',
    validationErrors: [],
    sourceRef: { nodeId: fkRefs.source.nodeId, columnId: fkRefs.source.columnId },
    targetRef: { nodeId: fkRefs.target.nodeId, columnId: fkRefs.target.columnId },
    config: {
      ruleType: 'EXIST_IN',
      targetNodeId: fkRefs.target.nodeId,
      targetColumn: fkRefs.target.columnName,
    },
    saveState: saveState || (mode === 'connect' ? 'draft' : 'saved'),
  }

  if (embedded) {
    nodeData.embedded = true
  }

  const edgeDescriptors = []

  // 约束输入边：Schema → FK 节点
  if (fkRefs.source.nodeId && fkRefs.source.columnId) {
    edgeDescriptors.push({
      kind: 'constraint' as const,
      sourceNodeId: fkRefs.source.nodeId,
      targetNodeId: nodeId,
      columnId: fkRefs.source.columnId,
    })
  }

  // FK 展示边：FK 节点 → 目标 Schema
  if (fkRefs.target.nodeId && fkRefs.target.columnId) {
    const label = [fkRefs.source.columnName, fkRefs.target.columnName].filter(Boolean).length
      ? `${fkRefs.source.columnName} → ${fkRefs.target.columnName}`
      : 'ForeignKey'

    edgeDescriptors.push({
      kind: 'fkDisplay' as const,
      sourceNodeId: nodeId,
      targetNodeId: fkRefs.target.nodeId,
      columnId: fkRefs.target.columnId,
      sourceHandle: `source-output-${nodeId}`,
      targetHandle: `source-right-${fkRefs.target.columnId}`,
      extra: {
        label,
        edgeId: `fk-${fkRefs.source.nodeId}-${fkRefs.target.nodeId}-${nodeId}`,
        fromTableId: fkRefs.source.nodeId,
        toTableId: fkRefs.target.nodeId,
        fromColumnId: fkRefs.source.columnId,
        toColumnId: fkRefs.target.columnId,
        constraintId: nodeId,
      },
    })
  }

  return { nodeData, edgeDescriptors }
}

registerBuilder('foreignKey', buildForeignKey)
