/**
 * @file useJsonSchemaDrag.ts
 * @description JSON Schema节点拖拽Composable
 * 处理节点和列的拖拽排序
 */

import { ref } from 'vue'
import type { EmitFn } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import type { JsonSchemaNodeData } from '@/types/nodes'

/**
 * JSON Schema节点拖拽Composable
 * @param props - 组件属性，包含节点ID和数据
 * @param emit - Vue emit 函数
 * @returns 拖拽相关的方法和状态
 */
export function useJsonSchemaDrag(
  props: { id: string; data: JsonSchemaNodeData },
  emit: EmitFn<{ columnReorder: [Record<string, unknown>] }>
) {
  const store = useGraphStore()

  const isDragging = ref(false)
  const draggedColumnId = ref<string | null>(null)
  const dragOverColumnId = ref<string | null>(null)

  /**
   * 开始拖拽列
   */
  const startColumnDrag = (columnId: string) => {
    isDragging.value = true
    draggedColumnId.value = columnId
  }

  /**
   * 进入拖拽目标区域
   */
  const enterDragTarget = (columnId: string) => {
    if (columnId !== draggedColumnId.value) {
      dragOverColumnId.value = columnId
    }
  }

  /**
   * 离开拖拽目标区域
   */
  const leaveDragTarget = () => {
    dragOverColumnId.value = null
  }

  /**
   * 放下列
   */
  const dropColumn = (targetColumnId: string) => {
    if (!draggedColumnId.value || draggedColumnId.value === targetColumnId) {
      resetDragState()
      return
    }

    const sourceIndex = props.data.columns.findIndex((col) => col.id === draggedColumnId.value)
    const targetIndex = props.data.columns.findIndex((col) => col.id === targetColumnId)

    if (sourceIndex === -1 || targetIndex === -1) {
      resetDragState()
      return
    }

    // 移动列
    const columns = [...props.data.columns]
    const [removed] = columns.splice(sourceIndex, 1)
    if (!removed) {
      resetDragState()
      return
    }
    columns.splice(targetIndex, 0, removed)

    store.updateNodeData(props.id, {
      ...props.data,
      columns: columns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })

    emit('columnReorder', {
      columnId: draggedColumnId.value,
      targetColumnId: targetColumnId,
      newIndex: targetIndex,
    })

    resetDragState()
  }

  /**
   * 重置拖拽状态
   */
  const resetDragState = () => {
    isDragging.value = false
    draggedColumnId.value = null
    dragOverColumnId.value = null
  }

  /**
   * 向上移动列
   */
  const moveColumnUp = (columnId: string) => {
    const index = props.data.columns.findIndex((col) => col.id === columnId)
    if (index <= 0) return

    const columns = [...props.data.columns]
    const prev = columns[index - 1]
    const curr = columns[index]
    if (prev && curr) {
      columns[index - 1] = curr
      columns[index] = prev
    }

    store.updateNodeData(props.id, {
      ...props.data,
      columns: columns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })

    emit('columnReorder', {
      columnId: columnId,
      direction: 'up',
      newIndex: index - 1,
    })
  }

  /**
   * 向下移动列
   */
  const moveColumnDown = (columnId: string) => {
    const index = props.data.columns.findIndex((col) => col.id === columnId)
    if (index === -1 || index >= props.data.columns.length - 1) return

    const columns = [...props.data.columns]
    const curr = columns[index]
    const next = columns[index + 1]
    if (curr && next) {
      columns[index] = next
      columns[index + 1] = curr
    }

    store.updateNodeData(props.id, {
      ...props.data,
      columns: columns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })

    emit('columnReorder', {
      columnId: columnId,
      direction: 'down',
      newIndex: index + 1,
    })
  }

  return {
    isDragging,
    draggedColumnId,
    dragOverColumnId,
    startColumnDrag,
    enterDragTarget,
    leaveDragTarget,
    dropColumn,
    resetDragState,
    moveColumnUp,
    moveColumnDown,
  }
}
