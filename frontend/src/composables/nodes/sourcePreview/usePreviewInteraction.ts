/**
 * @file usePreviewInteraction.ts
 * @description 数据源预览交互逻辑
 * 负责右键菜单、拖拽
 */

import { logger } from '@/core/utils/logger'
import { reactive } from 'vue'
import type { EmitFn } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDragStore, type DragEventPayload } from '@/stores/dragStore'
import type { SourcePreviewNodeData } from '../types'

/**
 * 右键菜单状态接口
 */
interface ContextMenuState {
  show: boolean
  x: number
  y: number
  rowIndex: number
}

/**
 * 数据源预览交互逻辑
 * @param props - 组件属性
 * @param emit - Vue的emit函数
 * @returns 交互逻辑相关的方法和状态
 */
export function usePreviewInteraction(
  props: { data: SourcePreviewNodeData },
  emit: EmitFn<{ dragstart: [DragEventPayload]; dragend: [] }>
) {
  const { t } = useI18n()
  const dragStore = useDragStore()

  // 右键菜单状态
  const contextMenu = reactive<ContextMenuState>({
    show: false,
    x: 0,
    y: 0,
    rowIndex: -1,
  })

  /**
   * 行右键菜单事件处理
   * @param event - 鼠标右键点击事件
   * @param rowIndex - 右键点击的行索引
   */
  const onRowContextMenu = (event: MouseEvent, rowIndex: number) => {
    event.preventDefault()
    contextMenu.show = true
    contextMenu.x = event.clientX
    contextMenu.y = event.clientY
    contextMenu.rowIndex = rowIndex
  }

  /**
   * 关闭右键菜单
   */
  const closeContextMenu = () => {
    contextMenu.show = false
    contextMenu.rowIndex = -1
  }

  /**
   * 复制行数据到剪贴板
   * @param previewRows - 预览数据行
   */
  const copyRowToClipboard = async (previewRows: string[][]) => {
    if (contextMenu.rowIndex >= 0) {
      try {
        const rowData = previewRows[contextMenu.rowIndex] ?? []
        const textData = rowData.join('\t')
        await navigator.clipboard.writeText(textData)
        logger.debug(t('customNodes.sourcePreviewNode.rowDataCopied'))
      } catch (error) {
        logger.error('Copy failed:', error)
      }
      closeContextMenu()
    }
  }

  /**
   * 通过右键菜单设置表头行
   * @param setHeaderRow - 设置表头行的函数
   * @param previewRows - 预览数据行
   * @param notifyDataChange - 通知数据变更的函数
   */
  const setAsHeaderRowViaMenu = async (
    setHeaderRow: (
      rowIndex: number,
      previewRows: string[][],
      notifyDataChange: () => void
    ) => Promise<void>,
    previewRows: string[][],
    notifyDataChange: () => void
  ) => {
    if (contextMenu.rowIndex >= 0) {
      await setHeaderRow(contextMenu.rowIndex, previewRows, notifyDataChange)
      closeContextMenu()
    }
  }

  /**
   * 字段拖拽开始事件处理
   * @param event - 拖拽事件对象
   * @param fieldName - 被拖拽字段的名称
   * @param fieldIndex - 被拖拽字段的索引
   */
  const onFieldDragStart = (event: DragEvent, fieldName: unknown, fieldIndex: number) => {
    if (!event.dataTransfer) return

    const target = event.currentTarget as HTMLElement
    const rowElement = target.closest('.preview-row')
    if (!rowElement || !rowElement.classList.contains('header-row')) {
      return
    }

    const dragData: DragEventPayload = {
      type: 'field_binding',
      sourceNodeId: props.data.id,
      sourceNodeName: props.data.sourceName,
      fieldName: String(fieldName),
      fieldIndex: fieldIndex,
      localPath: props.data.localPath,
      sourceType: props.data.sourceType,
    }

    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/json', JSON.stringify(dragData))

    emit('dragstart', dragData)
    dragStore.startDrag(dragData)

    logger.debug('🔄 字段拖拽开始:', dragData)
    target?.classList.add('dragging')
  }

  /**
   * 字段拖拽结束事件处理
   * @param event - 拖拽事件对象
   */
  const onFieldDragEnd = (event: DragEvent) => {
    const target = event.currentTarget as HTMLElement
    target?.classList.remove('dragging')

    emit('dragend')
    dragStore.endDrag()

    logger.debug('🔄 字段拖拽结束')
  }

  return {
    contextMenu,
    onRowContextMenu,
    closeContextMenu,
    copyRowToClipboard,
    setAsHeaderRowViaMenu,
    onFieldDragStart,
    onFieldDragEnd,
  }
}
