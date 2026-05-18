/**
 * @file constraintContextAware.ts
 * @description V2 约束上下文感知导入模块
 *
 * @deprecated 本模块的逻辑已下沉到 constraint.ts 的 importConstraint 中。
 * 外键展示边（FK Display Edge）现在由 `importConstraint` 统一在导入时创建，
 * 所有入口（拖拽、资源树、右键菜单）均直接调用 `importV2ResourceToCanvas`。
 * 保留此文件仅作向后兼容，后续将移除。
 *
 * 历史功能：
 * - importV2ConstraintContextAware: 根据约束类型选择导入策略
 * - 非外键约束：委托给标准约束导入流程
 * - 外键约束：自动确保 from/to Schema 节点存在，并绘制关系边
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { getV2Constraint } from '@/api/projectV2Api'

export function createV2ConstraintContextAwareImport(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  ensureSchemaNodeFromV2: (
    tableId: string,
    position: { x: number; y: number }
  ) => Promise<CustomNode>
  importV2ResourceToCanvas: (
    kind: 'schema' | 'constraint' | 'regex' | 'pattern',
    resourceId: string,
    position: { x: number; y: number },
    options?: { includeDeps?: boolean; moveIfExists?: boolean }
  ) => Promise<string | null>
}) {
  const { edges, selectedNodeId, ensureSchemaNodeFromV2, importV2ResourceToCanvas } = params

  async function importV2ConstraintContextAware(
    constraintId: string,
    position: { x: number; y: number }
  ) {
    const c = await getV2Constraint(constraintId)
    if (c.type !== 'ForeignKey') {
      await importV2ResourceToCanvas('constraint', constraintId, position, {
        includeDeps: true,
        moveIfExists: true,
      })
      return
    }

    const refs = (c as unknown as Record<string, unknown>).refs as
      | Record<string, unknown>
      | undefined
    const fromTableId = String(refs?.from_table_id || '')
    const fromColId = String(refs?.from_column_id || '')
    const toTableId = String(refs?.to_table_id || '')
    const toColId = String(refs?.to_column_id || '')
    if (!fromTableId || !toTableId) return

    const fromSchema = await ensureSchemaNodeFromV2(fromTableId, {
      x: position.x - 460,
      y: position.y - 140,
    })
    const toSchema = await ensureSchemaNodeFromV2(toTableId, {
      x: position.x - 460,
      y: position.y + 140,
    })

    const fromCols = (fromSchema.data as unknown as Record<string, unknown>)?.columns as
      | unknown[]
      | undefined
    const fromCol = fromCols?.find((x: any) => x.id === fromColId) as
      | Record<string, unknown>
      | undefined
    const fromColName = (fromCol?.columnName as string) || ''
    const toCols = (toSchema.data as unknown as Record<string, unknown>)?.columns as
      | unknown[]
      | undefined
    const toCol = toCols?.find((x: any) => x.id === toColId) as Record<string, unknown> | undefined
    const toColName = (toCol?.columnName as string) || ''
    const label = [fromColName, toColName].filter(Boolean).length
      ? `${fromColName} → ${toColName}`
      : 'ForeignKey'

    const edgeId = `fk-${fromTableId}-${toTableId}-${constraintId}`
    if (!edges.value.some((e) => e.id === edgeId)) {
      edges.value.push({
        id: edgeId,
        source: fromTableId,
        target: toTableId,
        type: 'smoothstep',
        animated: false,
        label,
        class: 'fk-display-edge',
        style: { stroke: 'var(--edge-fk-display)', strokeWidth: 1.6, strokeDasharray: '2 8' },
        data: {
          kind: 'fkConstraint',
          constraintId,
          fromTableId,
          toTableId,
          fromColumnId: fromColId,
          toColumnId: toColId,
        },
      } as Edge)
    }

    selectedNodeId.value = fromTableId
  }

  return { importV2ConstraintContextAware }
}
