/**
 * @file index.ts
 * @description 数据源预览节点入口
 * 整合所有数据源节点相关的逻辑
 */

import { onUnmounted } from 'vue'
import { usePreviewData } from './usePreviewData'
import { usePreviewDisplay } from './usePreviewDisplay'
import { useHeaderRow } from './useHeaderRow'
import { usePreviewInteraction } from './usePreviewInteraction'
import { usePreviewOperations } from './usePreviewOperations'
import { usePreviewCreation } from './usePreviewCreation'
import { useSourcePreviewEvents } from './useSourcePreviewEvents'
import type { SourcePreviewNodeData } from '../types'

/**
 * 数据源预览节点统一入口
 * @param props - 组件属性
 * @param emit - Vue的emit函数
 * @returns 包含所有状态和方法的响应式对象
 */
export function useSourcePreview(props: { id: string; data: SourcePreviewNodeData }, emit: any) {
  // 数据管理
  const data = usePreviewData(props, emit)

  // 显示控制
  const display = usePreviewDisplay(props)

  // 表头管理
  const header = useHeaderRow(props, emit)

  // 交互逻辑
  const interaction = usePreviewInteraction(props, emit)

  // 节点操作
  const operations = usePreviewOperations(props)

  // 节点创建
  const creation = usePreviewCreation()

  // SourcePreview事件处理
  const events = useSourcePreviewEvents(props, emit)

  // 设置全局点击事件监听器
  const setupEventListeners = () => {
    const contextMenuClickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.context-menu')) {
        interaction.closeContextMenu()
      }
    }

    const sheetMenuClickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.sheet-selector') && !target.closest('.sheet-menu')) {
        display.sheetMenu.show = false
      }
    }

    document.addEventListener('click', contextMenuClickHandler)
    document.addEventListener('click', sheetMenuClickHandler)

    return () => {
      document.removeEventListener('click', contextMenuClickHandler)
      document.removeEventListener('click', sheetMenuClickHandler)
      window.removeEventListener('mousemove', display.handleResize)
      window.removeEventListener('mouseup', display.stopResize)
    }
  }

  // 组件卸载时的清理操作（resize 监听器由调用方通过 setupEventListeners 返回的 cleanup 统一移除）
  onUnmounted(() => {
    window.removeEventListener('mousemove', display.handleResize)
    window.removeEventListener('mouseup', display.stopResize)
  })

  // 包装setHeaderRow，传入必要的参数
  const wrappedSetHeaderRow = (rowIndex: number) => {
    return header.setHeaderRow(rowIndex, display.previewRows.value, data.notifyDataChange)
  }

  // 包装copyRowToClipboard，传入必要的参数
  const wrappedCopyRowToClipboard = () => {
    return interaction.copyRowToClipboard(display.previewRows.value)
  }

  // 包装setAsHeaderRowViaMenu，传入必要的参数
  const wrappedSetAsHeaderRowViaMenu = () => {
    return interaction.setAsHeaderRowViaMenu(
      wrappedSetHeaderRow,
      display.previewRows.value,
      data.notifyDataChange
    )
  }

  return {
    // 数据管理
    ...data,

    // 显示控制
    ...display,

    // 表头管理
    ...header,

    // 交互逻辑
    ...interaction,

    // 节点操作
    ...operations,

    // 节点创建
    ...creation,

    // SourcePreview事件处理
    ...events,

    // 包装的方法
    setHeaderRow: wrappedSetHeaderRow,
    copyRowToClipboard: wrappedCopyRowToClipboard,
    setAsHeaderRowViaMenu: wrappedSetAsHeaderRowViaMenu,

    // 事件监听器设置函数
    setupEventListeners,
  }
}

// 导出所有子模块
export * from './usePreviewData'
export * from './usePreviewDisplay'
export * from './useHeaderRow'
export * from './usePreviewInteraction'
export * from './usePreviewOperations'
export * from './usePreviewCreation'
export * from './useSourcePreviewEvents'
