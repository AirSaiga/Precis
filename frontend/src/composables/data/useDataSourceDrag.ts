/**
 * @file useDataSourceDrag.ts
 * @description 数据源拖拽逻辑组合式函数
 *
 * 功能概述:
 * - 处理数据源拖拽开始事件
 * - 创建 ghost 拖拽图像元素
 * - 构建拖拽 payload 并设置拖拽数据
 * - 通知父组件拖拽状态变化
 *
 * 架构设计:
 * - 与 Vue Flow 画布拖拽系统对接
 * - payload 包含 sourceMode 和 localPath 信息供 SourcePreviewNode 识别
 * - ghost 元素使用固定定位并立即移除，避免 DOM 残留
 *
 * 输入示例:
 *   event: DragEvent
 *   dataSource: { id: 'ds_xxx', name: 'data.xlsx', fileId: '...', type: 'excel', localPath: '...' }
 *
 * 输出示例:
 *   emit('dragstart', { type: 'external_data_source', source: 'dataLibrary', ... })
 *   emit('dragend')
 */

import { logger } from '@/core/utils/logger'
import type { ExternalDataSource } from '@/types/graph'

/**
 * 使用数据源拖拽逻辑
 *
 * @param emit - 组件 emit 函数，用于通知父组件拖拽事件
 * @returns 拖拽事件处理器
 */
export function useDataSourceDrag(
  emit: ((event: 'dragstart', payload: any) => void) | ((event: 'dragend') => void)
) {
  /**
   * 处理数据源拖拽开始
   *
   * 创建自定义拖拽图像（ghost 元素），设置拖拽数据，
   * 并触发 dragstart 事件通知父组件。
   *
   * @param event - 拖拽事件对象
   * @param dataSource - 被拖拽的数据源对象
   */
  const handleDataSourceDragStart = (event: DragEvent, dataSource: ExternalDataSource) => {
    if (event.dataTransfer) {
      const ghost = document.createElement('div')
      ghost.style.position = 'fixed'
      ghost.style.top = '-1000px'
      ghost.style.left = '-1000px'
      ghost.style.padding = '8px 10px'
      ghost.style.borderRadius = '999px'
      ghost.style.border = '1px solid rgba(59, 130, 246, 0.35)'
      ghost.style.background = 'rgba(59, 130, 246, 0.12)'
      ghost.style.color = '#0F172A'
      ghost.style.fontSize = '12px'
      ghost.style.fontWeight = '700'
      ghost.style.boxShadow = '0 8px 20px rgba(2, 6, 23, 0.12)'
      ghost.style.backdropFilter = 'blur(6px)'
      ghost.textContent = dataSource.name
      document.body.appendChild(ghost)
      event.dataTransfer.setDragImage(ghost, 12, 12)
      setTimeout(() => ghost.remove(), 0)
    }

    const payload = {
      type: 'external_data_source',
      source: 'dataLibrary',
      fileId: dataSource.fileId,
      fileName: dataSource.name,
      name: dataSource.name,
      fileType: dataSource.type,
      sourceId: dataSource.id,
      label: dataSource.name,
      sourceMode: 'localfile',
      localPath: dataSource.localPath,
    }

    if (event.dataTransfer) {
      event.dataTransfer.setData('application/json', JSON.stringify(payload))
      event.dataTransfer.effectAllowed = 'copy'
      ;(emit as (event: 'dragstart', payload: any) => void)('dragstart', payload)

      logger.debug('🔄 数据源拖拽开始，使用emit触发事件:', payload)
    }
  }

  /**
   * 处理拖拽结束
   *
   * 清理拖拽状态并通知父组件
   */
  const handleDragEnd = () => {
    logger.debug('拖拽结束')
    ;(emit as unknown as (event: 'dragend') => void)('dragend')
  }

  return {
    handleDataSourceDragStart,
    handleDragEnd,
  }
}
