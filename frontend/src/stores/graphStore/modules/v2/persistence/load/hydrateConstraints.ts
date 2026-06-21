/**
 * @file hydrateConstraints.ts
 * @description V2 约束节点水合模块
 *
 * 将后端 V2 项目配置中的约束定义反序列化为画布上的 Constraint 节点。
 * 支持所有约束类型（NotNull、Unique、ForeignKey、Conditional、Scripted、Range、Charset、DateLogic、AllowedValues）。
 *
 * 功能概述：
 * - hydrateManifestConstraintsFromV2Config: 主入口，遍历 manifest.constraints
 * - 按约束类型分派到具体水合逻辑
 * - 自动创建 Constraint 节点到对应 Schema 节点的边
 * - 处理 sourceRef / targetRef / ifRef / thenRef 等引用关系
 *
 * 架构设计：
 * - 纯函数设计，接收 config + existingNodes 作为参数
 * - 通过现有节点查找 Schema 节点以建立父子关联
 * - 返回 { nodes, edges } 供上层合并
 */

import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, SubGraphData } from '@/types/graph'
import type { ConstraintFileV2, FullConfigV2Response } from '@/types/projectV2'
import type { SchemaNodeData } from '@/types/nodes'
import { getConstraintNodeTypeByV2Type } from '@/services/constraints/validationRegistry'

export function hydrateManifestConstraintsFromV2Config(params: {
  config: FullConfigV2Response
  existingNodes: CustomNode[]
}) {
  const { config, existingNodes } = params

  const nextNodes: CustomNode[] = []
  const nextEdges: Edge[] = []

  const constraintRefs = config.manifest.constraints || []
  constraintRefs.forEach((ref, idx) => {
    const c = config.constraints[ref.id]
    if (!c) return

    const nodeId = ref.id
    const nodeType = getConstraintNodeTypeByV2Type(c.type) ?? 'constraint'
    const pos = { x: 560 + (idx % 3) * 420, y: 80 + Math.floor(idx / 3) * 240 }

    if (c.type === 'AllowedValues') {
      const tableId = (c.refs as Record<string, unknown>).table_id as string
      const colId = (c.refs as Record<string, unknown>).column_id as string
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      const columnName =
        (schemaData?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === colId
        )?.columnName || ''
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'AllowedValues',
          table: tableName,
          column: columnName,
          allowedValues: new Set(
            ((c.params as Record<string, unknown>).allowed_values as unknown[]) || []
          ),
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: { nodeId: tableId, columnId: colId },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      nextEdges.push({
        id: `e-${tableId}-${nodeId}-${colId}`,
        source: tableId,
        target: nodeId,
        sourceHandle: `source-right-${colId}`,
        targetHandle: `target-input-${nodeId}`,
        type: 'smoothstep',
      } as Edge)
      return
    }

    if (c.type === 'ForeignKey') {
      const fromTableId = (c.refs as Record<string, unknown>).from_table_id as string
      const fromColId = (c.refs as Record<string, unknown>).from_column_id as string
      const toTableId = (c.refs as Record<string, unknown>).to_table_id as string
      const toColId = (c.refs as Record<string, unknown>).to_column_id as string
      const fromSchema = existingNodes.find((n) => n.id === fromTableId && n.type === 'schema')
      const fromData = fromSchema?.data as SchemaNodeData | undefined
      const toSchema = existingNodes.find((n) => n.id === toTableId && n.type === 'schema')
      const toData = toSchema?.data as SchemaNodeData | undefined
      const sourceTable = fromData?.tableName || ''
      const sourceColumn =
        (fromData?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === fromColId
        )?.columnName || ''
      const targetTable = toData?.tableName || ''
      const targetColumn =
        (toData?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === toColId
        )?.columnName || ''
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'ForeignKey',
          sourceTable,
          sourceColumn,
          targetTable,
          targetColumn,
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: { nodeId: fromTableId, columnId: fromColId },
          targetRef: { nodeId: toTableId, columnId: toColId },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      nextEdges.push({
        id: `e-${fromTableId}-${nodeId}-${fromColId}`,
        source: fromTableId,
        target: nodeId,
        sourceHandle: `source-right-${fromColId}`,
        targetHandle: `target-input-${nodeId}`,
        type: 'smoothstep',
      } as Edge)

      // 创建外键展示边（FK 节点 -> 目标 Schema 列），连接到目标列的右侧端点
      if (toTableId && toColId) {
        const edgeId = `fk-${fromTableId}-${toTableId}-${nodeId}`
        if (!nextEdges.some((e) => e.id === edgeId)) {
          const label = [sourceColumn, targetColumn].filter(Boolean).length
            ? `${sourceColumn} → ${targetColumn}`
            : 'ForeignKey'
          nextEdges.push({
            id: edgeId,
            source: nodeId,
            target: toTableId,
            sourceHandle: `source-output-${nodeId}`,
            targetHandle: `source-right-${toColId}`,
            type: 'smoothstep',
            animated: false,
            label,
            class: 'fk-display-edge',
            style: { stroke: 'var(--edge-fk-display)', strokeWidth: 1.6, strokeDasharray: '2 8' },
            data: {
              kind: 'fkDisplay',
              constraintId: nodeId,
              fromTableId,
              toTableId,
              fromColumnId: fromColId,
              toColumnId: toColId,
            },
          } as unknown as Edge)
        }
      }

      return
    }

    if (c.type === 'NotNull') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const colId = refs.column_id as string
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      const columnName =
        (schemaData?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === colId
        )?.columnName || ''
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'NotNull',
          table: tableName,
          column: columnName,
          validationErrors: [],
          sourceRef: { nodeId: tableId, columnId: colId },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      nextEdges.push({
        id: `e-${tableId}-${nodeId}-${colId}`,
        source: tableId,
        target: nodeId,
        sourceHandle: `source-right-${colId}`,
        targetHandle: `target-input-${nodeId}`,
        type: 'smoothstep',
      } as Edge)
      return
    }

    if (c.type === 'Unique') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const colIds = Array.isArray(refs.column_ids) ? (refs.column_ids as string[]) : []
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      // 单一约束只取第一列
      const columnName =
        colIds.length > 0
          ? (schemaData?.columns || []).find(
              (x) => (x as { id?: string; columnName?: string }).id === colIds[0]
            )?.columnName || ''
          : ''
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'Unique',
          table: tableName,
          column: columnName,
          validationErrors: [],
          sourceRef: colIds.length > 0 ? { nodeId: tableId, columnId: colIds[0] } : undefined,
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      if (colIds.length > 0) {
        nextEdges.push({
          id: `e-${tableId}-${nodeId}-${colIds[0]}`,
          source: tableId,
          target: nodeId,
          sourceHandle: `source-right-${colIds[0]}`,
          targetHandle: `target-input-${nodeId}`,
          type: 'smoothstep',
        } as Edge)
      }
      return
    }

    if (c.type === 'Conditional') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      const ifLogic = String(refs.if_logic || 'and')
      const thenColId = refs.then_column_id as string
      const thenColumnName =
        (schemaData?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === thenColId
        )?.columnName || ''
      const rawConditions = Array.isArray(refs.if_conditions)
        ? (refs.if_conditions as unknown[])
        : []
      const ifConditions = rawConditions.map((cond) => {
        const cRec = cond as Record<string, unknown>
        const ifColId = String(cRec?.if_column_id || '')
        const ifColName =
          (schemaData?.columns || []).find(
            (x) => (x as { id?: string; columnName?: string }).id === ifColId
          )?.columnName || ''
        return {
          operator: cRec?.operator,
          value: cRec?.value,
          values: cRec?.values,
          ref: ifColId ? { nodeId: tableId, columnId: ifColId } : undefined,
          column: ifColName,
        }
      })
      const first = ifConditions.find((x) => (x as { ref?: { columnId?: string } })?.ref?.columnId)
      const firstRec = first as Record<string, unknown> | undefined
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'Conditional',
          table: tableName,
          ifColumn: (firstRec?.column as string) || '',
          ifValue: typeof firstRec?.value === 'string' ? firstRec.value : '',
          thenColumn: thenColumnName,
          thenConditionConfig: (c.params as Record<string, unknown>)?.then_condition,
          ifLogic,
          ifConditions,
          ifRef: firstRec?.ref as { nodeId: string; columnId: string } | undefined,
          thenRef: thenColId ? { nodeId: tableId, columnId: thenColId } : undefined,
          validationStatus: 'idle',
          validationErrors: [],
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      nextEdges.push({
        id: `e-${tableId}-${nodeId}-${thenColId}`,
        source: tableId,
        target: nodeId,
        sourceHandle: `source-right-${thenColId}`,
        targetHandle: `target-input-${nodeId}`,
        type: 'smoothstep',
      } as Edge)
      return
    }

    if (c.type === 'Scripted') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const colId = (refs.column_id as string) || ''
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      const columnName = colId
        ? (schemaData?.columns || []).find(
            (x) => (x as { id?: string; columnName?: string }).id === colId
          )?.columnName || ''
        : ''
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'Scripted',
          table: tableName,
          column: columnName || undefined,
          script: String((c.params as Record<string, unknown>)?.expression || ''),
          constraintName: String((c.params as Record<string, unknown>)?.name || nodeId),
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: tableId && colId ? { nodeId: tableId, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      if (tableId && colId) {
        nextEdges.push({
          id: `e-${tableId}-${nodeId}-${colId}`,
          source: tableId,
          target: nodeId,
          sourceHandle: `source-right-${colId}`,
          targetHandle: `target-input-${nodeId}`,
          type: 'smoothstep',
        } as Edge)
      }
      return
    }

    // Range / Charset / DateLogic 约束的显式处理
    if (c.type === 'Range') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const colId = (refs.column_id as string) || ''
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      const columnName = colId
        ? (schemaData?.columns || []).find(
            (x) => (x as { id?: string; columnName?: string }).id === colId
          )?.columnName || ''
        : ''
      const params = (c.params || {}) as Record<string, unknown>
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'Range',
          table: tableName,
          column: columnName,
          minValue: typeof params.min === 'number' ? params.min : undefined,
          maxValue: typeof params.max === 'number' ? params.max : undefined,
          boundaryMode: String(params.boundary_mode || 'inclusive'),
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: tableId && colId ? { nodeId: tableId, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      if (tableId && colId) {
        nextEdges.push({
          id: `e-${tableId}-${nodeId}-${colId}`,
          source: tableId,
          target: nodeId,
          sourceHandle: `source-right-${colId}`,
          targetHandle: `target-input-${nodeId}`,
          type: 'smoothstep',
        } as Edge)
      }
      return
    }

    if (c.type === 'Charset') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const colId = (refs.column_id as string) || ''
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      const columnName = colId
        ? (schemaData?.columns || []).find(
            (x) => (x as { id?: string; columnName?: string }).id === colId
          )?.columnName || ''
        : ''
      const params = (c.params || {}) as Record<string, unknown>
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'Charset',
          table: tableName,
          column: columnName,
          charsetMode: String(params.charset_mode || 'ascii') as 'ascii' | 'chinese',
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: tableId && colId ? { nodeId: tableId, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      if (tableId && colId) {
        nextEdges.push({
          id: `e-${tableId}-${nodeId}-${colId}`,
          source: tableId,
          target: nodeId,
          sourceHandle: `source-right-${colId}`,
          targetHandle: `target-input-${nodeId}`,
          type: 'smoothstep',
        } as Edge)
      }
      return
    }

    if (c.type === 'DateLogic') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const colId = (refs.column_id as string) || ''
      const schemaNode = existingNodes.find((n) => n.id === tableId && n.type === 'schema')
      const schemaData = schemaNode?.data as SchemaNodeData | undefined
      const tableName = schemaData?.tableName || ''
      const columnName = colId
        ? (schemaData?.columns || []).find(
            (x) => (x as { id?: string; columnName?: string }).id === colId
          )?.columnName || ''
        : ''
      const params = (c.params || {}) as Record<string, unknown>
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'DateLogic',
          table: tableName,
          column: columnName,
          logicMode: String(params.logic_mode || 'compare') as 'compare' | 'calculation',
          compareOp: String(params.compare_op || 'gt') as
            | 'gt'
            | 'lt'
            | 'eq'
            | 'gte'
            | 'lte'
            | 'range',
          referenceDate:
            typeof params.reference_date === 'string' ? params.reference_date : undefined,
          referenceColumn:
            typeof params.reference_column === 'string' ? params.reference_column : undefined,
          calculationType: String(params.calculation_type || 'age') as 'age' | 'days_diff',
          targetValue: typeof params.target_value === 'string' ? params.target_value : undefined,
          targetColumn: typeof params.target_column === 'string' ? params.target_column : undefined,
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: tableId && colId ? { nodeId: tableId, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      if (tableId && colId) {
        nextEdges.push({
          id: `e-${tableId}-${nodeId}-${colId}`,
          source: tableId,
          target: nodeId,
          sourceHandle: `source-right-${colId}`,
          targetHandle: `target-input-${nodeId}`,
          type: 'smoothstep',
        } as Edge)
      }
      return
    }

    if (c.type === 'Composite') {
      const refs = c.refs ?? {}
      const tableId = refs.table_id as string
      const colId = (refs.column_id as string) || ''
      const params = (c.params || {}) as Record<string, unknown>
      nextNodes.push({
        id: nodeId,
        type: nodeType,
        position: pos,
        data: {
          configName: c.description || 'Composite',
          logic: String(params.logic || 'all') as 'all' | 'any' | 'none',
          subGraph: (params.sub_graph as SubGraphData | undefined) || {
            nodes: [],
            edges: [],
          },
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: tableId && colId ? { nodeId: tableId, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNodeData,
      })
      if (tableId && colId) {
        nextEdges.push({
          id: `e-${tableId}-${nodeId}-${colId}`,
          source: tableId,
          target: nodeId,
          sourceHandle: `source-right-${colId}`,
          targetHandle: `target-input-${nodeId}`,
          type: 'smoothstep',
        } as Edge)
      }
      return
    }

    nextNodes.push({
      id: nodeId,
      type: nodeType,
      position: pos,
      data: {
        ...(c as unknown as Record<string, unknown>),
        saveState: 'saved',
      } as unknown as CustomNodeData,
    })
  })

  return { nodes: nextNodes, edges: nextEdges }
}
