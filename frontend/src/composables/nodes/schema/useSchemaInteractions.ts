/**
 * @file useSchemaInteractions.ts
 * @description Schema节点交互逻辑
 * 负责处理节点的拖拽、键盘事件、列连接等交互行为
 */

import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import type { SchemaNodeData, SchemaColumn } from '@/types/graph'

/**
 * Schema节点交互逻辑
 * @param props - 组件属性
 * @param emit - Vue emit 函数
 * @returns 交互相关的方法和状态
 */
export function useSchemaInteractions(props: { id: string; data: SchemaNodeData }, emit: any) {
  const { t } = useI18n()
  const { findNode } = useVueFlow()
  const store = useGraphStore()
  const updateNodeData = store.updateNodeData

  const snappingColumnIds = ref<Set<string>>(new Set())
  const knownEdgeIds = ref<Set<string>>(new Set())
  const editingColumnName = ref('')

  /**
   * 触发某一列的右端点吸附动画
   * @param columnId - Schema 列 ID
   */
  const triggerColumnSnapAnimation = (columnId: string) => {
    const next = new Set(snappingColumnIds.value)
    next.add(columnId)
    snappingColumnIds.value = next

    window.setTimeout(() => {
      const after = new Set(snappingColumnIds.value)
      after.delete(columnId)
      snappingColumnIds.value = after
    }, 420)
  }

  /**
   * 处理列输出连接事件
   * @param event - 连接事件对象
   */
  const handleColumnOutputConnect = (event: {
    handleId: string
    targetNodeId: string
    targetHandleId: string
  }) => {
    const { handleId, targetNodeId } = event
    const columnId = handleId.replace('source-right-', '')
    const targetNode = findNode(targetNodeId)

    if (targetNode && targetNode.type !== 'schema') {
      const constraintType = constraintNodeTypeMap[targetNode.type]
      if (constraintType) {
        const updatedColumns = props.data.columns.map((col) => {
          if (col.id === columnId) {
            const currentConstraints = col.constraints || {}
            return {
              ...col,
              constraints: { ...currentConstraints, [constraintType]: true },
            }
          }
          return col
        })
        updateNodeData(props.id, {
          ...props.data,
          columns: updatedColumns,
          saveState: 'draft',
          updatedAt: new Date().toISOString(),
        })
        emit('constraint-create', { columnId, constraintType, targetNodeId })
      }
    }
  }

  /**
   * 创建表关系（外键约束）
   * @param sourceColumnId - 源列 ID
   * @param targetColumnId - 目标列 ID
   * @param targetNodeId - 目标节点 ID
   */
  const createTableRelation = (
    sourceColumnId: string,
    targetColumnId: string,
    targetNodeId: string
  ) => {
    const sourceColumn = props.data.columns.find((col) => col.id === sourceColumnId)
    if (sourceColumn) {
      const relationData = {
        type: 'foreign_key',
        sourceColumn: sourceColumn.columnName,
        targetColumn: targetNodeId,
        targetColumnId: targetColumnId,
        constraintName: `FK_${props.data.tableName}_${sourceColumn.columnName}`,
        relationType: 'many_to_one',
      }
      emit('constraint-create', relationData)
      const updatedColumns = props.data.columns.map((col) =>
        col.id === sourceColumnId ? { ...col, relation: relationData, isForeignKey: true } : col
      )
      updateNodeData(props.id, {
        ...props.data,
        columns: updatedColumns,
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
    }
  }

  /**
   * 监听新增连接并触发吸附动画
   */
  const watchConnectionChanges = () => {
    watch(
      () => store.edges.map((e) => e.id),
      (newEdgeIdList) => {
        const currentKnown = knownEdgeIds.value
        const newEdges = store.edges.filter((e) => !currentKnown.has(e.id))

        for (const edge of newEdges) {
          if (edge.source !== props.id) continue
          if (!edge.sourceHandle || !edge.sourceHandle.startsWith('source-right-')) continue

          const targetNode = store.nodes.find((n) => n.id === edge.target)
          const isInstantConstraint =
            targetNode?.type === 'uniqueConstraint' || targetNode?.type === 'notNullConstraint'
          if (!isInstantConstraint) continue

          const columnId = edge.sourceHandle.replace('source-right-', '')
          triggerColumnSnapAnimation(columnId)
        }

        knownEdgeIds.value = new Set(newEdgeIdList)
      },
      { deep: false }
    )
  }

  /**
   * 初始化已知边集合
   */
  const initKnownEdgeIds = () => {
    knownEdgeIds.value = new Set(store.edges.map((e) => e.id))
  }

  const constraintNodeTypeMap: Record<string, string> = {
    notNullConstraint: 'notNull',
    uniqueConstraint: 'unique',
    allowedValuesConstraint: 'allowedValues',
    foreignKeyConstraint: 'foreignKey',
    conditionalConstraint: 'conditional',
    scriptedConstraint: 'scripted',
  }

  return {
    snappingColumnIds,
    editingColumnName,
    triggerColumnSnapAnimation,
    handleColumnOutputConnect,
    createTableRelation,
    watchConnectionChanges,
    initKnownEdgeIds,
    constraintNodeTypeMap,
  }
}
