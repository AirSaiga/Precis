/**
 * @file usePreviewDisplay.ts
 * @description 数据源预览显示控制
 * 负责预览显示、Sheet菜单、调整大小
 */

import { ref, computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SourcePreviewNodeData } from '../types';

/**
 * 数据源预览显示控制
 * @param props - 组件属性
 * @returns 显示控制相关的方法和状态
 */
export function usePreviewDisplay(props: { data: SourcePreviewNodeData }) {
  const { t } = useI18n();

  // 节点宽度
  const nodeWidth = ref(350);

  // 预览区域高度
  const previewHeight = ref(150);

  // 预览显示的行数
  const displayRows = ref(5);

  // 预览显示的列数
  const displayCols = ref(4);

  // 是否正在调整大小
  const isResizing = ref(false);

  // 头部悬停状态
  const headerHovered = ref(false);

  // Sheet菜单状态
  const sheetMenu = reactive({
    show: false,
    style: { top: '0px', left: '0px', minWidth: 'auto' }
  });

  // Sheet选择按钮的DOM引用
  const sheetSelectorBtn = ref<HTMLButtonElement | null>(null);

  // 调整大小的拖拽起始数据
  const dragStartData = reactive({
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0
  });

  /**
   * 格式化单元格值
   * @param value - 单元格值
   * @returns 格式化后的值
   */
  const formatCellValue = (value: any): any => {
    if (value === null || value === undefined) {
      return '(空)';
    }
    if (typeof value === 'number' && isNaN(value)) {
      return '(空)';
    }
    if (value === 'NaN' || value === 'nan' || value === '') {
      return '(空)';
    }
    return value;
  };

  /**
   * 计算预览数据行
   */
  const previewRows = computed(() => {
    if (props.data && props.data.data && props.data.data.length > 0) {
      return props.data.data.slice(0, displayRows.value).map(row => {
        const limit = displayCols.value;
        if (Array.isArray(row)) {
          return row.slice(0, limit).map(cell => formatCellValue(cell));
        } else if (typeof row === 'object') {
          return Object.values(row).slice(0, limit).map(cell => formatCellValue(cell));
        }
        return [String(row)];
      });
    }

    const sampleRows: string[][] = [];
    for (let i = 0; i < displayRows.value; i++) {
      const row: string[] = [];
      for (let j = 0; j < displayCols.value; j++) {
        row.push(t('customNodes.sourcePreviewNode.sampleData', { index: j + 1 }));
      }
      sampleRows.push(row);
    }
    return sampleRows;
  });

  /**
   * 切换工作表选择菜单
   * @param event - 鼠标点击事件
   */
  const toggleSheetMenu = (event: MouseEvent) => {
    event.stopPropagation();
    sheetMenu.show = !sheetMenu.show;

    if (sheetMenu.show) {
      const button = event.currentTarget as HTMLElement;
      const nodeContainer = button.closest('.source-preview-node') as HTMLElement;

      if (nodeContainer) {
        const nodeRect = nodeContainer.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();

        const offset = 8;
        const relativeTop = buttonRect.bottom - nodeRect.top + offset;
        const relativeLeft = buttonRect.left - nodeRect.left;

        sheetMenu.style = {
          top: `${relativeTop}px`,
          left: `${relativeLeft}px`,
          minWidth: `${Math.max(140, buttonRect.width)}px`
        };
      } else {
        const rect = button.getBoundingClientRect();
        sheetMenu.style = {
          top: (rect.bottom + 8) + 'px',
          left: rect.left + 'px',
          minWidth: '140px'
        };
      }
    }
  };

  /**
   * 开始调整预览区域大小
   * @param event - 鼠标按下事件
   */
  const startResize = (event: MouseEvent) => {
    isResizing.value = true;

    dragStartData.startX = event.clientX;
    dragStartData.startY = event.clientY;
    dragStartData.startWidth = nodeWidth.value;
    dragStartData.startHeight = previewHeight.value;

    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);

    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  /**
   * 处理调整大小过程中的鼠标移动
   * @param event - 鼠标移动事件
   */
  const handleResize = (event: MouseEvent) => {
    if (!isResizing.value) return;

    const deltaX = event.clientX - dragStartData.startX;
    const deltaY = event.clientY - dragStartData.startY;

    const newWidth = Math.max(300, Math.min(1000, dragStartData.startWidth + deltaX));
    const newHeight = Math.max(120, Math.min(500, dragStartData.startHeight + deltaY));

    nodeWidth.value = newWidth;
    previewHeight.value = newHeight;

    const estColWidth = 85;
    displayCols.value = Math.max(3, Math.floor(newWidth / estColWidth));

    displayRows.value = Math.ceil(newHeight / 30) + 2;
  };

  /**
   * 停止调整大小
   */
  const stopResize = () => {
    isResizing.value = false;
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  return {
    nodeWidth,
    previewHeight,
    displayRows,
    displayCols,
    isResizing,
    headerHovered,
    sheetMenu,
    sheetSelectorBtn,
    dragStartData,
    previewRows,
    formatCellValue,
    toggleSheetMenu,
    startResize,
    handleResize,
    stopResize
  };
}
