<!--
  @file SourcePreviewNode.vue
  @description 数据源预览节点组件

  用于在可视化画布中预览 Excel/CSV 等数据文件的内容，支持多 Sheet 切换和拖拽字段到 Schema 节点。
-->
/** * @file SourcePreviewNode.vue * @description 数据源预览节点组件 * * 核心功能： * - Excel/CSV
文件的数据预览 * - 多 Sheet 切换支持 * - 拖拽字段到 Schema 节点 * - 动态调整预览区域大小 * -
右键菜单操作（删除、重新加载数据） * - 设置首行是否为表头 * * 数据流： * 用户上传文件 → 本地文件 →
SourcePreviewNode → 预览展示 * * 节点结构： * - Header：文件图标、文件名、操作按钮（重新加载、删除）
* - Sheet 切换器：多 Sheet 文件的 Sheet 切换 * - Preview Table：数据预览表格 * - 输出 Handle：连接到
Schema 节点 */
<template>
  <div
    class="source-preview-node graph-node"
    :class="{ 'is-selected': selected }"
    :style="{ width: nodeWidth + 'px' }"
  >
    <!-- 头部：标题和图标 -->
    <div
      class="source-header"
      @mouseenter="headerHovered = true"
      @mouseleave="headerHovered = false"
    >
      <!-- 状态圆圈：向左挪动一格，作为常驻状态显示 -->
      <div class="header-status">
        <span v-if="localData.outputPortConnected" class="status-connected">●</span>
        <span v-else class="status-disconnected">○</span>
      </div>

      <div class="header-icon" :title="localData.localPath">
        <AppIcon
          v-if="localData.sourceType === 'excel'"
          class="file-icon excel-icon"
          name="file-chart"
          :size="16"
        />
        <AppIcon
          v-else-if="localData.sourceType === 'csv'"
          class="file-icon csv-icon"
          name="file"
          :size="16"
        />
        <AppIcon v-else class="file-icon" name="file-default" :size="16" />
      </div>
      <div class="header-content">
        <div class="source-name">{{ localData.sourceName }}</div>
      </div>

      <!-- 移除按钮：占据最右上角的"角落位"，平时隐藏，鼠标悬停 Header 时显现 -->
      <button
        v-show="headerHovered"
        class="reload-btn"
        @click="handleReloadData"
        :title="t('customNodes.sourcePreviewNode.reloadData')"
        :disabled="isReloading"
      >
        <svg
          v-if="isReloading"
          class="spin"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <svg
          v-else
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
      <button
        v-show="headerHovered"
        class="remove-btn"
        @click="handleRemove"
        :title="t('customNodes.sourcePreviewNode.removeNode')"
      >
        <AppIcon name="x" :size="14" />
      </button>
    </div>

    <!-- Sheet 工具栏 -->
    <div class="sheet-toolbar">
      <div class="sheet-selector-container">
        <button
          class="sheet-selector"
          :class="{ active: sheetMenu.show }"
          @click="toggleSheetMenu"
          v-if="localData.sheets && localData.sheets.length > 1"
          :title="t('customNodes.sourcePreviewNode.switchSheet')"
          ref="sheetSelectorBtn"
        >
          <AppIcon class="sheet-icon" name="file-code" :size="16" />
          <span class="sheet-name" :key="localData.currentSheet">{{
            localData.currentSheet || t('customNodes.sourcePreviewNode.defaultSheet')
          }}</span>
          <span class="sheet-chevron">▾</span>
        </button>
        <div v-else-if="localData.currentSheet" class="sheet-name-static">
          <AppIcon name="file-code" :size="16" /> {{ localData.currentSheet }}
        </div>
      </div>
    </div>

    <!-- Sheet选择下拉菜单 -->
    <div v-if="sheetMenu.show" class="sheet-menu" :style="sheetMenu.style">
      <div
        v-for="sheet in localData.sheets"
        :key="sheet"
        class="sheet-menu-item"
        :class="{ active: sheet === localData.currentSheet }"
        @click="selectSheet(sheet)"
      >
        <span class="sheet-check"
          ><AppIcon v-if="sheet === localData.currentSheet" name="check" :size="12"
        /></span>
        <span class="sheet-name">{{ sheet }}</span>
      </div>
    </div>

    <!-- 预览表格 -->
    <div class="preview-table-container" ref="previewContainer">
      <div class="preview-table">
        <div class="preview-body" :style="{ height: previewHeight + 'px' }">
          <div
            v-for="(row, rowIndex) in previewRows"
            :key="rowIndex"
            class="preview-row"
            :class="{
              'header-row': rowIndex === localData.headerRow,
              'potential-header-row': potentialHeaderRow === rowIndex,
            }"
            @contextmenu="onRowContextMenu($event, rowIndex)"
            @mouseover="onRowIndicatorHover(rowIndex)"
            @mouseleave="onRowIndicatorLeave"
          >
            <div
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
              class="preview-cell"
              :class="{
                'header-cell': rowIndex === localData.headerRow,
              }"
              :draggable="rowIndex === localData.headerRow"
              @dragstart="
                rowIndex === localData.headerRow
                  ? onFieldDragStart($event, cell, cellIndex as number)
                  : null
              "
              @dragend="rowIndex === localData.headerRow ? onFieldDragEnd($event) : null"
              :title="cell"
            >
              {{ cell }}
              <span v-if="rowIndex === localData.headerRow" class="field-drag-hint">⋮⋮</span>
            </div>
            <!-- 表头行标识 - 只在设置为表头行时显示 -->
            <div
              v-if="isHeaderRow(rowIndex)"
              class="header-indicator"
              :title="t('validation.source.currentHeaderRow')"
            >
              <AppIcon name="star" :size="12" />
            </div>
            <!-- 闪烁星号指示器 - 非表头行悬停时显示 -->
            <div
              v-else
              class="blinking-star"
              @click="onRowIndicatorClick(rowIndex)"
              :title="t('validation.source.clickToSetHeaderRow')"
            >
              <AppIcon name="star" :size="12" />
            </div>
          </div>
        </div>
      </div>
      <div v-if="localData.data && localData.data.length > 0" class="preview-footer">
        <div class="footer-info">
          <template v-if="localData.data.length > displayRows">
            {{
              t('customNodes.sourcePreviewNode.displayingTop', {
                displayed: displayRows,
                total: localData.data.length,
              })
            }}
          </template>
          <template v-else>
            {{ t('customNodes.sourcePreviewNode.displayingAll', { total: localData.data.length }) }}
          </template>
        </div>
        <!-- 调整大小句柄 -->
        <div
          class="resize-handle"
          @mousedown.stop.prevent="startResize"
          :title="t('customNodes.sourcePreviewNode.resizeHandle')"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="16" y1="20" x2="20" y2="16"></line>
            <line x1="10" y1="20" x2="20" y2="10"></line>
          </svg>
        </div>
      </div>
    </div>

    <!-- 输出端口Handle -->
    <NodeHandle
      :id="`${localData.id}-output`"
      type="source"
      :position="Position.Right"
      color="success"
      size="lg"
      class="output-handle"
    />

    <!-- 右键菜单 -->
    <div
      v-if="contextMenu.show"
      class="context-menu"
      :style="{
        left: contextMenu.x + 'px',
        top: contextMenu.y + 'px',
      }"
    >
      <div class="menu-item" @click="setAsHeaderRowViaMenu">
        <AppIcon class="menu-icon" name="clipboard" :size="16" />
        {{ t('customNodes.sourcePreviewNode.setAsHeaderRow') }}
      </div>
      <div class="menu-item" @click="copyRowToClipboard">
        <AppIcon class="menu-icon" name="clipboard" :size="16" />
        {{ t('customNodes.sourcePreviewNode.copyRowData') }}
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="closeContextMenu">
        <AppIcon class="menu-icon" name="x" :size="16" />
        {{ t('customNodes.sourcePreviewNode.cancel') }}
      </div>
    </div>

    <!-- 背景遮罩用于关闭右键菜单 -->
    <div v-if="contextMenu.show" class="context-menu-backdrop" @click="closeContextMenu"></div>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file SourcePreviewNode.vue
   * @description 数据源预览节点组件
   *
   * 该组件用于显示 Excel/CSV 文件的预览数据，提供以下功能：
   * - 多 Sheet 切换功能
   * - 拖拽字段到 Schema 节点进行绑定
   * - 调整预览区域大小
   * - 右键菜单操作
   * - 表头行设置
   * - 数据重新加载
   *
   * 组件结构：
   * 1. 头部区域：显示文件名、Sheet 选择器、状态指示器
   * 2. 预览表格：显示数据预览，支持拖拽和行标识
   * 3. 右键菜单：提供表头行设置和复制等功能
   * 4. 输出端口：用于连接到 Schema 节点
   */

  // 引入 Vue Flow 的核心组件和工具
  import { Position } from '@vue-flow/core'
  // 引入 Vue 响应式 API
  import { onMounted, onUnmounted } from 'vue'
  // 引入国际化支持
  import { useI18n } from 'vue-i18n'
  // 引入类型定义
  import type { SourcePreviewNodeData } from '@/types/graph'
  import NodeHandle from '@/components/ui/NodeHandle.vue'
  import AppIcon from '@/components/icons/AppIcon.vue'

  // 引入拖拽事件类型
  import type { DragEventPayload } from '@/stores/dragStore'
  // 引入节点删除管理器

  // 引入数据源预览逻辑整合 composable
  import { useSourcePreview } from '@/composables/nodes/sourcePreview'
  // 获取国际化实例
  const { t } = useI18n()

  /**
   * 定义组件属性
   * @property id - 节点唯一标识符
   * @property data - 节点数据（SourcePreviewNodeData 类型）
   * @property selected - 节点是否被选中（可选）
   */
  const props = defineProps<{
    id: string
    data: SourcePreviewNodeData
    selected?: boolean
  }>()

  /**
   * 定义组件事件
   * @event headerRowChanged - 表头行变更事件，携带节点 ID、行号和行数据
   * @event dragstart - 拖拽开始事件，携带拖拽数据
   * @event dragend - 拖拽结束事件
   * @event dataChanged - 数据变更事件，携带新的节点数据
   */
  const emit = defineEmits<{
    headerRowChanged: [
      payload: {
        nodeId: string
        headerRow: number
        oldHeaderRow: number | undefined
        rowData: string[]
      },
    ]
    dragstart: [payload: DragEventPayload]
    dragend: []
    dataChanged: [data: SourcePreviewNodeData]
  }>()

  /**
   * 使用 composable 整合所有节点逻辑
   * 该 composable 包含了：
   * - 数据状态管理（localData, previewRows 等）
   * - 交互逻辑（拖拽、调整大小、右键菜单等）
   * - 事件处理（Sheet 切换、表头设置等）
   */
  const {
    // 核心数据
    localData,
    contextMenu,
    sheetMenu,
    sheetSelectorBtn,

    // 布局状态
    nodeWidth,
    previewHeight,
    displayRows,
    displayCols,
    isResizing,
    isReloading,
    headerHovered,
    potentialHeaderRow,

    // 计算属性
    previewRows,

    // 方法
    toggleSheetMenu,
    selectSheet,
    onFieldDragStart,
    onFieldDragEnd,
    onRowContextMenu,
    closeContextMenu,
    copyRowToClipboard,
    setAsHeaderRowViaMenu,
    setHeaderRow,
    startResize,
    handleResize,
    stopResize,
    handleRemove,
    handleReloadData,
    onRowIndicatorHover,
    onRowIndicatorLeave,
    isHeaderRow,
    setupEventListeners,
  } = useSourcePreview(props, emit)

  /**
   * 组件挂载时执行
   * 设置全局点击事件监听器（用于关闭右键菜单和 Sheet 菜单）
   */
  let cleanupEventListeners: (() => void) | undefined
  onMounted(() => {
    cleanupEventListeners = setupEventListeners()
  })

  /**
   * 组件卸载时执行
   * 确保所有事件监听器和定时器被正确清理
   */
  onUnmounted(() => {
    cleanupEventListeners?.()
  })

  /**
   * 行号点击处理函数
   * 用于将某一行设置为表头行
   * @param rowIndex - 行索引（从 0 开始）
   */
  const onRowIndicatorClick = (rowIndex: number) => {
    // 如果右键菜单已打开，不处理点击事件
    if (contextMenu.show) return

    // 设置为新的表头行
    setHeaderRow(rowIndex)
  }

  /**
   * 暴露组件方法和属性给父组件
   * 通过 defineExpose 对外提供组件的内部方法和状态
   * 这样父组件可以直接访问和调用
   */
  defineExpose({
    // 拖拽相关方法
    onFieldDragStart,
    onFieldDragEnd,

    // 表头设置方法
    setHeaderRow,
    copyRowToClipboard,

    // 调整大小相关方法
    startResize,
    handleResize,
    stopResize,

    // 节点操作方法
    handleRemove,
    handleReloadData,

    // 状态属性（只读）
    nodeWidth,
    previewHeight,
    displayCols,
    displayRows,
    isResizing,

    // 菜单状态（用于样式绑定或外部访问）
    contextMenu,
    sheetMenu,

    // 预览数据
    previewRows,

    // Sheet 选择方法
    selectSheet,
  })
</script>

<style scoped src="./SourcePreviewNode.css"></style>
