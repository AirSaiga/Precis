/**
 * @file useHeaderRow.ts
 * @description 表头行管理
 * 负责表头设置、表头指示器交互
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import { eventBus } from '@/core/eventBus'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SourcePreviewNodeData } from '../types'

/**
 * 表头行管理
 * @param props - 组件属性
 * @param emit - Vue的emit函数
 * @returns 表头管理相关的方法和状态
 */
export function useHeaderRow(props: { id: string; data: SourcePreviewNodeData }, emit: any) {
  const { t } = useI18n()

  // 潜在的表头行索引
  const potentialHeaderRow = ref<number | null>(null)

  /**
   * 计算预览表头
   */
  const previewHeaders = computed(() => {
    if (
      props.data.headerRow !== undefined &&
      props.data.headerRow >= 0 &&
      props.data.data &&
      props.data.data[props.data.headerRow]
    ) {
      const headerRow = props.data.data[props.data.headerRow]
      if (Array.isArray(headerRow)) {
        return headerRow
      } else if (typeof headerRow === 'object') {
        return Object.values(headerRow)
      }
    }
    return []
  })

  /**
   * 判断指定行是否为表头行
   * @param rowIndex - 要判断的行索引
   * @returns 如果是表头行返回true，否则返回false
   */
  const isHeaderRow = (rowIndex: number): boolean => {
    // 如果 headerRow 未定义，默认使用第一行（索引0）
    const effectiveHeaderRow = props.data.headerRow ?? 0
    return rowIndex === effectiveHeaderRow
  }

  /**
   * 行指示器悬停处理
   * @param rowIndex - 悬停的行索引
   */
  const onRowIndicatorHover = (rowIndex: number) => {
    potentialHeaderRow.value = rowIndex
  }

  /**
   * 行指示器离开处理
   */
  const onRowIndicatorLeave = () => {
    potentialHeaderRow.value = null
  }

  /**
   * 设置表头行
   * @param rowIndex - 要设置为表头行的索引
   * @param previewRows - 预览数据行
   * @param notifyDataChange - 通知数据变更的函数
   */
  const setHeaderRow = async (
    rowIndex: number,
    previewRows: string[][],
    notifyDataChange: () => void
  ) => {
    const oldHeaderRow = props.data.headerRow

    if (oldHeaderRow === rowIndex) {
      logger.debug(t('customNodes.sourcePreviewNode.alreadyHeaderRow', { row: rowIndex + 1 }))
      return
    }

    const notifyHeaderRowChanged = async (request: any) => {
      const response = await apiClient.post('/preview/header-row-changed', request)
      return response.data
    }

    try {
      const targetRow = previewRows[rowIndex] ?? []
      const request = {
        action: 'header_row_changed',
        node_id: props.id,
        header_row: rowIndex,
        old_header_row: oldHeaderRow,
        row_data: targetRow.reduce((acc: Record<string, unknown>, cell: unknown, index: number) => {
          acc[`column_${index + 1}`] = cell
          return acc
        }, {}),
      }

      const response = await notifyHeaderRowChanged(request)

      if (response.success) {
        emit('headerRowChanged', {
          nodeId: props.id,
          headerRow: rowIndex,
          oldHeaderRow: oldHeaderRow,
          rowData: previewRows[rowIndex] as string[],
        })

        notifyDataChange()

        eventBus.emit('headerRowChanged', {
          nodeId: props.id,
          headerRow: rowIndex,
          data: props.data as unknown as Record<string, unknown>,
          oldHeaderRow: oldHeaderRow ?? 0,
          rowData: previewRows[rowIndex] as string[],
        })
      } else {
        logger.error('通知后端失败:', response.message)
      }
    } catch (error) {
      logger.error('设置表头行时发生错误:', error)

      emit('headerRowChanged', {
        nodeId: props.id,
        headerRow: rowIndex,
        oldHeaderRow: oldHeaderRow,
        rowData: previewRows[rowIndex] as string[],
      })

      notifyDataChange()

      eventBus.emit('headerRowChanged', {
        nodeId: props.id,
        headerRow: rowIndex,
        data: props.data as unknown as Record<string, unknown>,
        oldHeaderRow: oldHeaderRow ?? 0,
        rowData: previewRows[rowIndex] as string[],
      })
    }
  }

  return {
    potentialHeaderRow,
    previewHeaders,
    isHeaderRow,
    onRowIndicatorHover,
    onRowIndicatorLeave,
    setHeaderRow,
  }
}
