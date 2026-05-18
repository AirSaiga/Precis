/**
 * @file useJsonSchemaUI.ts
 * @description JSON Schema UI状态管理
 *
 * 功能概述:
 * - 下拉菜单状态管理（类型、约束、数据源）
 * - 悬停状态管理
 * - 节点样式类计算
 * - 错误信息格式化
 * - 滚动位置处理
 * - 树形结构展开/折叠
 *
 * 架构设计:
 * - 使用 useNodeUI 作为基础 UI 逻辑
 * - 针对 JSON Schema 节点特点进行扩展
 * - 支持树形嵌套列结构
 *
 * 输入示例:
 * - props.data.columns: JsonSchemaColumn[] - 列定义数组
 * - props.selected: boolean - 选中状态
 *
 * 输出示例:
 * - nodeClasses: 节点样式类对象
 * - 下拉菜单位置计算结果
 * - 格式化后的错误信息
 */

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useVueFlow } from '@vue-flow/core';
import { useGraphStore } from '@/stores/graphStore';
import type { JsonSchemaNodeData, JsonSchemaColumn, JsonDataType } from '@/types/nodes';
import { useNodeUI } from '@/composables/nodes/shared/useNodeUI';

/**
 * JSON Schema UI状态管理
 *
 * @param props - 组件属性
 * @returns JSON Schema UI相关的方法和状态
 */
export function useJsonSchemaUI(props: { id: string; data: JsonSchemaNodeData; selected?: boolean }) {
  const { t } = useI18n();
  const { updateNodeInternals } = useVueFlow();

  const store = useGraphStore();

  /**
   * 防止无限递归的标志
   */
  const isInitializing = false;

  /**
   * 展开的列ID集合（用于树形结构）
   */
  const expandedColumns = ref<Set<string>>(new Set());

  /**
   * 常量：JSON数据类型选项
   */
  const typeOptions = [
    { value: 'string' as JsonDataType, label: 'String' },
    { value: 'number' as JsonDataType, label: 'Number' },
    { value: 'boolean' as JsonDataType, label: 'Boolean' },
    { value: 'object' as JsonDataType, label: 'Object' },
    { value: 'array' as JsonDataType, label: 'Array' },
    { value: 'null' as JsonDataType, label: 'Null' }
  ];

  /**
   * 常量：JSON数组元素类型选项
   */
  const arrayItemTypeOptions = [
    { value: 'string' as JsonDataType, label: 'String' },
    { value: 'number' as JsonDataType, label: 'Number' },
    { value: 'boolean' as JsonDataType, label: 'Boolean' },
    { value: 'object' as JsonDataType, label: 'Object' },
    { value: 'array' as JsonDataType, label: 'Array' }
  ];

  /**
   * 常量：错误信息最大显示数量
   */
  const MAX_ERROR_DISPLAY = 10;

  /**
   * 工具方法：获取数据类型显示文本
   */
  const getTypeDisplayText = (type: JsonDataType): string => {
    const map: Record<string, string> = {
      'string': 'String',
      'number': 'Number',
      'boolean': 'Boolean',
      'object': 'Object',
      'array': 'Array',
      'null': 'Null'
    };
    return map[type] || type;
  };

  /**
   * 根据ID查找列（包括嵌套列）
   */
  const findColumnById = (id: string, columns: JsonSchemaColumn[]): JsonSchemaColumn | null => {
    for (const col of columns) {
      if (col.id === id) {
        return col;
      }
      if (col.children && col.children.length > 0) {
        const found = findColumnById(id, col.children);
        if (found) return found;
      }
    }
    return null;
  };

  /**
   * 检查列是否展开
   */
  const isColumnExpanded = (columnId: string): boolean => {
    return expandedColumns.value.has(columnId);
  };

  /**
   * 获取当前可见列列表（考虑展开状态）
   */
  const getVisibleColumns = (columns: JsonSchemaColumn[]): JsonSchemaColumn[] => {
    const result: JsonSchemaColumn[] = [];
    const walk = (cols: JsonSchemaColumn[]) => {
      for (const col of cols) {
        result.push(col);
        if (col.children && col.children.length > 0 && isColumnExpanded(col.id)) {
          walk(col.children);
        }
      }
    };
    walk(columns);
    return result;
  };

  /**
   * 格式化验证错误信息用于显示
   *
   * @param errors - 错误信息数组
   * @returns 格式化的错误摘要和完整消息
   */
  const formatErrorMessage = (errors: string[]): { summary: string; fullMessage: string } => {
    if (!errors || errors.length === 0) {
      return { summary: '', fullMessage: '' };
    }

    const total = errors.length;
    const displayErrors = errors.slice(0, MAX_ERROR_DISPLAY);

    const nullErrors = errors.filter(e => e.includes('为空') || e.includes('null'));
    const typeErrors = errors.filter(e => e.includes('类型') || e.includes('type'));
    const pathErrors = errors.filter(e => e.includes('path') || e.includes('路径'));

    const parts: string[] = [];
    if (nullErrors.length > 0) parts.push(`${nullErrors.length} 个空值错误`);
    if (typeErrors.length > 0) parts.push(`${typeErrors.length} 个类型错误`);
    if (pathErrors.length > 0) parts.push(`${pathErrors.length} 个路径错误`);

    let summary: string;
    let fullMessage: string;

    if (parts.length > 0) {
      summary = parts.join(' + ');
    } else {
      summary = `${total} 个错误`;
    }

    if (total <= MAX_ERROR_DISPLAY) {
      fullMessage = errors.join('\n');
    } else {
      fullMessage = `${displayErrors.join('\n')}\n... 共 ${total} 个错误`;
    }

    return { summary, fullMessage };
  };

  /**
   * 格式化列验证错误
   */
  const formatColumnErrors = (columnId: string): { summary: string; fullMessage: string } => {
    const column = findColumnById(columnId, props.data.columns);
    if (!column || !column.validationErrors) {
      return { summary: '', fullMessage: '' };
    }
    return formatErrorMessage(column.validationErrors);
  };

  /**
   * 工具方法：验证JSONPath是否合法
   */
  const validateJsonPath = (path: string): boolean => {
    if (!path.trim()) return false;
    if (path.startsWith('$') && !path.startsWith('$.')) return false;
    return true;
  };

  /**
   * 切换列的展开/折叠状态
   */
  const toggleColumnExpanded = (columnId: string) => {
    if (expandedColumns.value.has(columnId)) {
      expandedColumns.value.delete(columnId);
    } else {
      expandedColumns.value.add(columnId);
    }
    expandedColumns.value = new Set(expandedColumns.value);
    nextTick(() => {
      updateNodeInternals([props.id]);
    });
  };

  /**
   * 初始化展开状态
   */
  const initializeExpandedState = () => {
    const newExpanded = new Set<string>();
    for (const col of props.data.columns) {
      if (col.isExpanded) {
        newExpanded.add(col.id);
      }
      if (col.children) {
        for (const child of col.children) {
          if (child.isExpanded) {
            newExpanded.add(child.id);
          }
        }
      }
    }
    expandedColumns.value = newExpanded;
  };

  /**
   * 计算属性：是否有验证错误
   */
  const hasValidationErrors = computed(() => {
    return props.data.columns.some(col =>
      col.validationErrors && col.validationErrors.length > 0
    );
  });

  /**
   * 获取所有验证错误（包括嵌套列）
   */
  const getAllValidationErrors = (): Map<string, string[]> => {
    const errorMap = new Map<string, string[]>();

    const collectErrors = (columns: JsonSchemaColumn[]) => {
      for (const col of columns) {
        if (col.validationErrors && col.validationErrors.length > 0) {
          errorMap.set(col.id, col.validationErrors);
        }
        if (col.children && col.children.length > 0) {
          collectErrors(col.children);
        }
      }
    };

    collectErrors(props.data.columns);
    return errorMap;
  };

  const ui = useNodeUI<JsonSchemaColumn, JsonDataType>({
    nodeId: props.id,
    nodeData: props.data,
    selected: props.selected,
    typeOptions,
    getTypeDisplayText,
    findColumnById,
    getVisibleColumns,
    onColumnsChange: initializeExpandedState
  });

  onMounted(() => {
    nextTick(() => {
      initializeExpandedState();
      ui.checkScrollStatus();
    });
  });

  onBeforeUnmount(() => {
    ui.cancelScrollFrame();
  });

  nextTick(() => {
    initializeExpandedState();
  });

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
    expandedColumns,

    typeOptions,
    arrayItemTypeOptions,
    MAX_ERROR_DISPLAY,
    availableDataSources: ui.availableDataSources,

    nodeClasses: ui.nodeClasses,
    hasValidationErrors,
    hasScrolledOutColumns: ui.hasScrolledOutColumns,
    scrollVersion: ui.scrollVersion,

    formatErrorMessage,
    formatColumnErrors,
    getErrorPopoverPosition: ui.getErrorPopoverPosition,
    getTypeDisplayText,
    validateColumnName: ui.validateColumnName,
    validateJsonPath,
    getScrolledOutColumns: ui.getScrolledOutColumns,
    getScrolledOutColumnsBySide: ui.getScrolledOutColumnsBySide,
    getAllValidationErrors,
    findColumnById,

    toggleTypeDropdown: ui.toggleTypeDropdown,
    toggleConstraintMenu: ui.toggleConstraintMenu,
    closeConstraintMenu: ui.closeConstraintMenu,
    handleSourceInfoClick: ui.handleSourceInfoClick,
    closeSourceDropdown: ui.closeSourceDropdown,
    handleColumnsScroll: ui.handleColumnsScroll,
    toggleColumnExpanded,
    isColumnExpanded
  };
}
