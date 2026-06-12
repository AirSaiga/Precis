/**
 * @file useSchemaUI.ts
 * @description Schema UI状态管理
 * 负责UI状态（下拉菜单、悬停状态、确认弹窗、位置计算、滚动处理）
 */

import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import type { SchemaNodeData, DataType, SchemaColumn } from '@/types/graph'
import { useNodeUI } from '@/composables/nodes/shared/useNodeUI'

/**
 * Schema UI状态管理
 * @param props - 组件属性
 * @returns Schema UI相关的方法和状态
 */
export function useSchemaUI(props: { id: string; data: SchemaNodeData; selected?: boolean }) {
  const { t } = useI18n()
  const { updateNodeInternals } = useVueFlow()

  const store = useGraphStore()

  /**
   * 常量：数据类型选项
   */
  const typeOptions = [
    { value: 'String' as DataType, label: 'String' },
    { value: 'Integer' as DataType, label: 'Int' },
    { value: 'Float' as DataType, label: 'Float' },
    { value: 'Date' as DataType, label: 'Date' },
    { value: 'Expression' as DataType, label: 'Expr' },
  ]

  /**
   * 工具方法：获取数据类型显示文本
   */
  const getTypeDisplayText = (type: DataType) => {
    const map: Record<string, string> = {
      String: 'String',
      string: 'String',
      Integer: 'Int',
      integer: 'Int',
      Float: 'Float',
      float: 'Float',
      Date: 'Date',
      date: 'Date',
      Boolean: 'Boolean',
      boolean: 'Boolean',
      Expression: 'Expr',
      expression: 'Expr',
    }
    return map[type] || type
  }

  const ui = useNodeUI<SchemaColumn, DataType>({
    nodeId: props.id,
    nodeData: props.data,
    selected: props.selected,
    typeOptions,
    getTypeDisplayText,
  })

  return {
    // UI 状态
    hoveredColumn: ui.hoveredColumn,
    hoveredErrorColumn: ui.hoveredErrorColumn,
    activeDropdown: ui.activeDropdown,
    dropdownPosition: ui.dropdownPosition,
    constraintMenuColumnId: ui.constraintMenuColumnId,
    constraintDropdownPosition: ui.constraintDropdownPosition,
    errorPopoverPosition: ui.errorPopoverPosition,
    showSourceDropdown: ui.showSourceDropdown,
    sourceDropdownPosition: ui.sourceDropdownPosition,
    dataSourceTree: ui.dataSourceTree,
    columnsSectionRef: ui.columnsSectionRef,

    // 常量
    typeOptions,
    MAX_ERROR_DISPLAY: ui.MAX_ERROR_DISPLAY,
    availableDataSources: ui.availableDataSources,

    // 计算属性
    nodeClasses: ui.nodeClasses,
    hasScrolledOutColumns: ui.hasScrolledOutColumns,

    // 工具方法
    formatValidationErrors: ui.formatValidationErrors,
    getErrorPopoverPosition: ui.getErrorPopoverPosition,
    getTypeDisplayText,
    validateColumnName: ui.validateColumnName,
    getScrolledOutColumns: ui.getScrolledOutColumns,
    getScrolledOutColumnsBySide: ui.getScrolledOutColumnsBySide,
    scrollVersion: ui.scrollVersion,

    // 菜单方法
    toggleTypeDropdown: ui.toggleTypeDropdown,
    toggleConstraintMenu: ui.toggleConstraintMenu,
    closeConstraintMenu: ui.closeConstraintMenu,
    handleSourceInfoClick: ui.handleSourceInfoClick,
    closeSourceDropdown: ui.closeSourceDropdown,
    handleColumnsScroll: ui.handleColumnsScroll,
  }
}
