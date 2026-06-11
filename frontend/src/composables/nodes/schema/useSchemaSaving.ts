/**
 * @file useSchemaSaving.ts
 * @description Schema保存逻辑
 * 负责保存逻辑、保存状态管理、关闭逻辑
 */

import { useGraphStore } from '@/stores/graphStore'
import type { SchemaNodeData } from '@/types/graph'
import { useNodeSaving } from '../shared/useNodeSaving'

/**
 * Schema保存逻辑
 * @param props - 组件属性
 * @param emit - Vue的emit函数
 * @param hoveredColumn - 当前悬停的列ID
 * @returns Schema保存相关的方法和状态
 */
export function useSchemaSaving(
  props: { id: string; data: SchemaNodeData },
  emit: any,
  hoveredColumn: { value: string | null }
) {
  const store = useGraphStore()
  const updateNodeData = store.updateNodeData

  const nodeSaving = useNodeSaving({
    nodeId: props.id,
    nodeData: props.data,
    emit,
    eventPrefix: 'schema-node',
    shouldConfirmClose: () => props.data.saveState === 'draft',
    onPatternBind: (columnId, patternData, columns) =>
      columns.map((col: any) =>
        col.id === columnId ? { ...col, dataType: 'Expression' as const } : col
      ),
    addConstraint: (columnId, constraintType) => {
      store.addConstraintToColumn(props.id, columnId, constraintType as 'notNull' | 'unique')
    },
    getTargetColumnId: () => hoveredColumn.value,
    nodeType: 'schema',
  })

  /**
   * 处理SourcePreviewNode断开连接
   */
  const handleSourceNodeDisconnected = (detail: { sourceNodeId: string; targetNodeId: string; edgeId: string }) => {
    const { targetNodeId } = detail

    if (targetNodeId === props.id) {
      updateNodeData(props.id, {
        ...props.data,
        tableName: 'new_table',
        sourceFile: undefined,
        sourceFilePath: undefined,
        sheetName: undefined,
        outputPortConnected: false,
      })
    }
  }

  /**
   * 处理Pattern拖拽
   */
  const handlePatternDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'

    const target = event.target as HTMLElement | null
    const row = target?.closest?.('.column-row') as HTMLElement | null
    const columnId = row?.dataset?.columnId
    if (columnId) {
      hoveredColumn.value = columnId
    }
  }

  /**
   * 处理键盘事件
   */
  const handleKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      emit('save', props.data)
    }
  }

  return {
    // 保存状态
    isSaving: nodeSaving.isSaving,
    saveSuccess: nodeSaving.saveSuccess,
    saveError: nodeSaving.saveError,
    saveBtnHovered: nodeSaving.saveBtnHovered,
    closeBtnHovered: nodeSaving.closeBtnHovered,
    nodeHovered: nodeSaving.nodeHovered,
    showCloseConfirm: nodeSaving.showCloseConfirm,

    // 保存方法
    handleSave: nodeSaving.handleSave,
    handleSaveComplete: nodeSaving.handleSaveComplete,
    handleSaveCompleteDOM: nodeSaving.handleSaveCompleteDOM,

    // 关闭方法
    handleClose: nodeSaving.handleClose,
    confirmCloseWithoutSave: nodeSaving.confirmCloseWithoutSave,
    saveAndClose: nodeSaving.saveAndClose,
    cancelClose: nodeSaving.cancelClose,

    // 校验方法
    handleValidate: nodeSaving.handleValidate,

    // 事件处理
    handleSourceNodeDisconnected,
    handlePatternDragOver,
    handlePatternDrop: nodeSaving.handlePatternDrop,
    handleKeydown,

    // 辅助方法
    bindPatternToColumn: nodeSaving.bindPatternToColumn,
    addConstraintToColumn: nodeSaving.addConstraintToColumn,
  }
}
