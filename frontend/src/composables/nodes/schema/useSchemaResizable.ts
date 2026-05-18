/**
 * @file useSchemaResizable.ts
 * @description Schema 节点调整大小组合式函数
 *
 * 管理 Schema 节点的宽度和高度调整逻辑，支持：
 * - 拖拽右下角调整大小
 * - 最小尺寸限制（300x200）
 * - 尺寸持久化到节点 data
 * - 自动保存尺寸变更
 */

/**
 * @file useSchemaResizable.ts
 * @description Schema 节点调整大小逻辑 Composable
 */

import { ref, watch, onUnmounted } from 'vue';
import { useGraphStore } from '@/stores/graphStore';
import type { SchemaNodeData } from '@/types/graph';

/**
 * Schema 节点调整大小逻辑
 * @param props - 组件属性，包含 id 和 data
 * @returns 调整大小相关的方法和状态
 */
export function useSchemaResizable(props: { id: string; data: SchemaNodeData }) {
  const store = useGraphStore();

  // 默认尺寸
  const MIN_WIDTH = 300;
  const MIN_HEIGHT = 200;
  const DEFAULT_WIDTH = 360;

  // 响应式尺寸状态
  // 优先使用 props 中的数据，否则使用默认值
  const width = ref(props.data.width || DEFAULT_WIDTH);
  // 高度如果不设置，默认为 auto (或者由内容撑开)，但在 resize 模式下需要有具体值
  // 如果 props 中没有 height，初始可以设为 null 或 undefined，让 CSS 控制
  // 但一旦开始 resize，就需要具体数值。
  // 为了简化，我们可以在组件挂载时获取实际高度，或者给一个默认高度。
  // 这里我们先设为 undefined，由 CSS min-height 控制，resize 时再赋值。
  const height = ref<number | undefined>(props.data.height);

  // 是否正在调整大小
  const isResizing = ref(false);

  // 拖拽起始数据
  const dragStart = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  /**
   * 开始调整大小
   * @param event - 鼠标事件
   */
  const startResize = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    isResizing.value = true;
    dragStart.x = event.clientX;
    dragStart.y = event.clientY;
    dragStart.width = width.value;
    
    // 如果当前 height 未定义（由内容撑开），则获取当前 DOM 元素的高度作为起始高度
    if (height.value === undefined) {
      const nodeEl = document.querySelector(`[data-node-id="${props.id}"]`) as HTMLElement;
      if (nodeEl) {
        dragStart.height = nodeEl.offsetHeight;
        height.value = dragStart.height; // 初始化 height
      } else {
        dragStart.height = MIN_HEIGHT;
        height.value = MIN_HEIGHT;
      }
    } else {
      dragStart.height = height.value;
    }

    // 添加全局事件监听
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);
    
    // 设置光标样式
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  /**
   * 处理调整大小
   * @param event - 鼠标事件
   */
  const handleResize = (event: MouseEvent) => {
    if (!isResizing.value) return;

    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;

    // 计算新尺寸
    const newWidth = Math.max(MIN_WIDTH, dragStart.width + deltaX);
    const newHeight = Math.max(MIN_HEIGHT, dragStart.height + deltaY);

    width.value = newWidth;
    height.value = newHeight;
  };

  /**
   * 停止调整大小
   */
  const stopResize = () => {
    if (!isResizing.value) return;
    
    isResizing.value = false;
    
    // 移除事件监听
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
    
    // 恢复光标样式
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // 保存尺寸到节点数据
    store.updateNodeData(props.id, {
      ...props.data,
      width: width.value,
      height: height.value,
    });
  };

  // 监听 props 数据变化，同步更新尺寸（如果是外部变更）
  watch(() => props.data.width, (newWidth) => {
    if (newWidth && !isResizing.value) {
      width.value = newWidth;
    }
  });

  watch(() => props.data.height, (newHeight) => {
    if (newHeight && !isResizing.value) {
      height.value = newHeight;
    }
  });

  // 组件卸载时清理事件监听
  onUnmounted(() => {
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
  });

  return {
    width,
    height,
    isResizing,
    startResize,
  };
}
