/**
 * @file constraint.ts
 * @description V2 Constraint（约束）导入模块
 *
 * 负责将 V2 项目配置中的独立约束文件导入为画布约束节点。
 * 支持多种约束类型：Unique、NotNull、AllowedValues、ForeignKey、
 * Range、Conditional、Scripted、Charset、DateLogic 等。
 *
 * 核心功能：
 * - importConstraint: 根据约束 ID 加载并创建约束节点
 * - 自动解析约束引用的表和列，建立节点间的边关系
 * - 支持依赖自动导入（includeDeps）和位置更新（moveIfExists）
 *
 * 数据流：
 * V2 约束配置 → getV2Constraint API → 约束数据 → CustomNode → 画布 + Edge
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { SchemaNodeData } from '@/types/nodes'
import { getV2Constraint } from '@/api/projectV2Api'
import { logger } from '@/core/utils/logger'

export function createV2ConstraintImporter(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  ensureSchemaNode: (tableId: string, position: { x: number; y: number }) => Promise<CustomNode>
  ensureSchemaToConstraintEdge: (tableId: string, constraintId: string, columnId: string) => void
}) {
  const { nodes, edges, selectedNodeId, ensureSchemaNode, ensureSchemaToConstraintEdge } = params

  async function importConstraint(
    resourceId: string,
    position: { x: number; y: number },
    options?: { includeDeps?: boolean; moveIfExists?: boolean }
  ): Promise<string> {
    const includeDeps = options?.includeDeps !== false
    const moveIfExists = options?.moveIfExists === true

    const existingNode = nodes.value.find((n) => n.id === resourceId)
    if (existingNode) {
      if (moveIfExists) {
        existingNode.position = { ...position }
      }
      selectedNodeId.value = resourceId
      return resourceId
    }

    const c = await getV2Constraint(resourceId)
    const constraintTypeToNodeType: Record<string, string> = {
      Unique: 'uniqueConstraint',
      NotNull: 'notNullConstraint',
      AllowedValues: 'allowedValuesConstraint',
      ForeignKey: 'foreignKeyConstraint',
      Range: 'rangeConstraint',
      Conditional: 'conditionalConstraint',
      Scripted: 'scriptedConstraint',
      Charset: 'charsetConstraint',
      DateLogic: 'dateLogicConstraint',
    }
    const nodeType = constraintTypeToNodeType[c.type] || 'constraint'

    if (c.type === 'AllowedValues') {
      const tableId = c.refs.table_id as string
      const colId = c.refs.column_id as string
      const schemaNode = includeDeps
        ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y })
        : nodes.value.find((n) => n.id === tableId)

      const tableName = (schemaNode?.data as SchemaNodeData | undefined)?.tableName || ''
      const columnName =
        ((schemaNode?.data as SchemaNodeData | undefined)?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === colId
        )?.columnName || ''

      const constraintNode: CustomNode = {
        id: resourceId,
        type: nodeType,
        position,
        data: {
          configName: c.description || 'AllowedValues',
          table: tableName,
          column: columnName,
          allowedValues: new Set((c.params.allowed_values as unknown[]) || []),
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: { nodeId: tableId, columnId: colId },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      }
      nodes.value.push(constraintNode)
      if (tableId && colId) ensureSchemaToConstraintEdge(tableId, resourceId, colId)
      selectedNodeId.value = constraintNode.id
      return constraintNode.id
    }

    if (c.type === 'Range') {
      const tableId = c.refs.table_id as string
      const colId = c.refs.column_id as string
      const schemaNode = includeDeps
        ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y })
        : nodes.value.find((n) => n.id === tableId)

      const tableName = (schemaNode?.data as SchemaNodeData | undefined)?.tableName || ''
      const columnName =
        ((schemaNode?.data as SchemaNodeData | undefined)?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === colId
        )?.columnName || ''

      const constraintNode: CustomNode = {
        id: resourceId,
        type: nodeType,
        position,
        data: {
          configName: c.description || 'Range',
          table: tableName,
          column: columnName,
          minValue: (c.params as Record<string, unknown>)?.min,
          maxValue: (c.params as Record<string, unknown>)?.max,
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: { nodeId: tableId, columnId: colId },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      }
      nodes.value.push(constraintNode)
      if (tableId && colId) ensureSchemaToConstraintEdge(tableId, resourceId, colId)
      selectedNodeId.value = constraintNode.id
      return constraintNode.id
    }

    if (c.type === 'ForeignKey') {
      const fromTableId = c.refs.from_table_id as string
      const fromColId = c.refs.from_column_id as string
      const toTableId = c.refs.to_table_id as string
      const toColId = c.refs.to_column_id as string

      const fromSchema = includeDeps
        ? await ensureSchemaNode(fromTableId, { x: position.x - 460, y: position.y - 140 })
        : nodes.value.find((n) => n.id === fromTableId)
      const toSchema = includeDeps
        ? await ensureSchemaNode(toTableId, { x: position.x - 460, y: position.y + 140 })
        : nodes.value.find((n) => n.id === toTableId)

      const sourceTable = (fromSchema?.data as SchemaNodeData | undefined)?.tableName || ''
      const sourceColumn =
        ((fromSchema?.data as SchemaNodeData | undefined)?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === fromColId
        )?.columnName || ''
      const targetTable = (toSchema?.data as SchemaNodeData | undefined)?.tableName || ''
      const targetColumn =
        ((toSchema?.data as SchemaNodeData | undefined)?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === toColId
        )?.columnName || ''
      
      logger.info('[constraint.ts] FK 节点导入 - 列信息:', {
        fromTableId,
        fromColId,
        sourceTable,
        sourceColumn,
        toTableId,
        toColId,
        targetTable,
        targetColumn,
        toSchemaExists: !!toSchema,
        toSchemaColumns: (toSchema?.data as SchemaNodeData | undefined)?.columns?.map((c: any) => ({ id: c.id, name: c.columnName })),
      })

      const constraintNode: CustomNode = {
        id: resourceId,
        type: nodeType,
        position,
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
          config: {
            ruleType: 'EXIST_IN',
            targetNodeId: toTableId,
            targetColumn: targetColumn
          },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      }
      
      nodes.value.push(constraintNode)
      if (fromTableId && fromColId) ensureSchemaToConstraintEdge(fromTableId, resourceId, fromColId)

      // 创建外键展示边（FK 节点 -> 目标 Schema 列），连接到目标列的右侧端点
      if (toTableId && toColId) {
        const edgeId = `fk-${fromTableId}-${toTableId}-${resourceId}`
        if (!edges.value.some((e) => e.id === edgeId)) {
          const label = [sourceColumn, targetColumn].filter(Boolean).length
            ? `${sourceColumn} → ${targetColumn}`
            : 'ForeignKey'
          edges.value.push({
            id: edgeId,
            source: resourceId,
            target: toTableId,
            sourceHandle: `source-output-${resourceId}`,
            targetHandle: `source-right-${toColId}`,
            type: 'smoothstep',
            animated: false,
            label,
            class: 'fk-display-edge',
            style: { stroke: 'var(--edge-fk-display)', strokeWidth: 1.6, strokeDasharray: '2 8' },
            data: {
              kind: 'fkConstraint',
              constraintId: resourceId,
              fromTableId,
              toTableId,
              fromColumnId: fromColId,
              toColumnId: toColId,
            },
          } as unknown as Edge)
        }
      }

      selectedNodeId.value = constraintNode.id
      return constraintNode.id
    }

    if (c.type === 'NotNull') {
      const tableId = c.refs.table_id as string
      const colId = c.refs.column_id as string
      const schemaNode = includeDeps
        ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y })
        : nodes.value.find((n) => n.id === tableId)
      const tableName = (schemaNode?.data as SchemaNodeData | undefined)?.tableName || ''
      const columnName =
        ((schemaNode?.data as SchemaNodeData | undefined)?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === colId
        )?.columnName || ''
      const constraintNode: CustomNode = {
        id: resourceId,
        type: nodeType,
        position,
        data: {
          configName: c.description || 'NotNull',
          table: tableName,
          column: columnName,
          validationErrors: [],
          sourceRef: { nodeId: tableId, columnId: colId },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      }
      nodes.value.push(constraintNode)
      if (tableId && colId) ensureSchemaToConstraintEdge(tableId, resourceId, colId)
      selectedNodeId.value = constraintNode.id
      return constraintNode.id
    }

    if (c.type === 'Unique') {
      const tableId = c.refs.table_id as string
      const colIds = Array.isArray(c.refs.column_ids) ? (c.refs.column_ids as string[]) : []
      const schemaNode = includeDeps
        ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y })
        : nodes.value.find((n) => n.id === tableId)
      const tableName = (schemaNode?.data as SchemaNodeData | undefined)?.tableName || ''
      // 单一约束只取第一列
      const columnName =
        colIds.length > 0
          ? ((schemaNode?.data as SchemaNodeData | undefined)?.columns || []).find(
              (x) => (x as { id?: string; columnName?: string }).id === colIds[0]
            )?.columnName || ''
          : ''
      const constraintNode: CustomNode = {
        id: resourceId,
        type: nodeType,
        position,
        data: {
          configName: c.description || 'Unique',
          table: tableName,
          column: columnName,
          validationErrors: [],
          sourceRef: { nodeId: tableId, columnId: colIds[0] || '' },
          saveState: 'saved',
        } as unknown as CustomNodeData,
      }
      nodes.value.push(constraintNode)
      if (tableId && colIds[0]) ensureSchemaToConstraintEdge(tableId, resourceId, colIds[0])
      selectedNodeId.value = constraintNode.id
      return constraintNode.id
    }

    if (c.type === 'Conditional') {
      const tableId = c.refs.table_id as string
      const schemaNode = includeDeps
        ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y })
        : nodes.value.find((n) => n.id === tableId)
      const tableName = (schemaNode?.data as SchemaNodeData | undefined)?.tableName || ''
      const ifLogic = String((c.refs as Record<string, unknown>).if_logic || 'and')
      const thenColId = c.refs.then_column_id as string
      const thenColumnName =
        ((schemaNode?.data as SchemaNodeData | undefined)?.columns || []).find(
          (x) => (x as { id?: string; columnName?: string }).id === thenColId
        )?.columnName || ''
      const rawConditions = Array.isArray(c.refs.if_conditions)
        ? (c.refs.if_conditions as unknown[])
        : []
      const ifConditions = rawConditions.map((cond) => {
        const cRec = cond as Record<string, unknown>
        const ifColId = String(cRec?.if_column_id || '')
        const ifColName =
          ((schemaNode?.data as SchemaNodeData | undefined)?.columns || []).find(
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
      const constraintNode: CustomNode = {
        id: resourceId,
        type: nodeType,
        position,
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
      }
      nodes.value.push(constraintNode)
      if (tableId && thenColId) ensureSchemaToConstraintEdge(tableId, resourceId, thenColId)
      selectedNodeId.value = constraintNode.id
      return constraintNode.id
    }

    if (c.type === 'Scripted') {
      const tableId = c.refs.table_id as string
      const colId = (c.refs.column_id as string) || ''
      const schemaNode =
        tableId && includeDeps
          ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y })
          : nodes.value.find((n) => n.id === tableId)
      const tableName = (schemaNode?.data as SchemaNodeData | undefined)?.tableName || ''
      const columnName = colId
        ? ((schemaNode?.data as SchemaNodeData | undefined)?.columns || []).find(
            (x) => (x as { id?: string; columnName?: string }).id === colId
          )?.columnName || ''
        : ''
      const constraintNode: CustomNode = {
        id: resourceId,
        type: nodeType,
        position,
        data: {
          configName: c.description || 'Scripted',
          table: tableName,
          column: columnName || undefined,
          script: String((c.params as Record<string, unknown>)?.expression || ''),
          constraintName: String((c.params as Record<string, unknown>)?.name || resourceId),
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: tableId && colId ? { nodeId: tableId, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNodeData,
      }
      nodes.value.push(constraintNode)
      if (tableId && colId) ensureSchemaToConstraintEdge(tableId, resourceId, colId)
      selectedNodeId.value = constraintNode.id
      return constraintNode.id
    }

    const constraintNode: CustomNode = {
      id: resourceId,
      type: nodeType,
      position,
      data: {
        ...(c as unknown as Record<string, unknown>),
        saveState: 'saved',
      } as unknown as CustomNodeData,
    }
    nodes.value.push(constraintNode)

    // 尝试为未知类型的约束建立连线（如果 refs 中包含 table_id 和 column_id）
    const fallbackTableId = (c.refs as Record<string, unknown>)?.table_id as string | undefined
    const fallbackColId = (c.refs as Record<string, unknown>)?.column_id as string | undefined
    if (fallbackTableId && fallbackColId) {
      ensureSchemaToConstraintEdge(fallbackTableId, resourceId, fallbackColId)
    }

    selectedNodeId.value = constraintNode.id
    return constraintNode.id
  }

  return { importConstraint }
}
