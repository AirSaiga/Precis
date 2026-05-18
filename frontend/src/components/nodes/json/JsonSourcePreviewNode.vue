<!--
  @file JsonSourcePreviewNode.vue
  @description JSON 数据源预览节点

  展示 JSON 文件内容预览，支持配置 JSONPath、record_path 等解析参数。
  可以连接到 JsonSchemaNode 进行结构定义。

  功能概述：
  - 显示 JSON 文件名和连接状态
  - 提供 JSONPath 和 record_path 输入配置
  - 预览解析后的表格数据
  - 输出端口连接到 JsonSchemaNode
-->

<template>
  <div
    class="json-source-preview-node"
    :class="{ 'is-selected': selected }"
    :style="{ width: nodeWidth + 'px' }"
  >
    <div
      class="source-header"
      @mouseenter="headerHovered = true"
      @mouseleave="headerHovered = false"
    >
      <div class="header-status">
        <span v-if="localData.outputPortConnected" class="status-connected">●</span>
        <span v-else class="status-disconnected">○</span>
      </div>

      <div class="header-icon" :title="localData.localPath">
        <span class="file-icon json-icon">{ }</span>
      </div>
      <div class="header-content">
        <div class="source-name">{{ localData.sourceName }}</div>
      </div>

      <button
        v-show="headerHovered"
        class="remove-btn"
        @click="handleRemove"
        :title="t('customNodes.jsonSourcePreviewNode.removeNode')"
      >
        ×
      </button>
    </div>

    <div class="config-toolbar">
      <div class="config-section">
        <label class="config-label">{{ t('customNodes.jsonSourcePreviewNode.format') }}</label>
        <select class="config-select" v-model="localData.format" @change="handleConfigChange">
          <option value="json">JSON</option>
          <option value="jsonl">JSONL</option>
          <option value="ndjson">NDJSON</option>
        </select>
      </div>
    </div>

    <div class="path-config-section">
      <div class="path-config-item">
        <label class="config-label">JSONPath</label>
        <input
          type="text"
          class="config-input"
          v-model="localData.jsonPath"
          :placeholder="t('customNodes.jsonSourcePreviewNode.jsonPathPlaceholder')"
          @change="handleConfigChange"
        />
      </div>
      <div class="path-config-item">
        <label class="config-label">Record Path</label>
        <input
          type="text"
          class="config-input"
          v-model="localData.recordPath"
          :placeholder="t('customNodes.jsonSourcePreviewNode.recordPathPlaceholder')"
          @change="handleConfigChange"
        />
      </div>
    </div>

    <div class="preview-table-container" ref="previewContainer">
      <!-- Loading 状态 -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span class="loading-text">{{ t('common.loading') }}</span>
      </div>

      <!-- Error 状态 -->
      <div v-else-if="loadError" class="error-overlay">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ loadError }}</span>
        <button class="retry-btn" @click="fetchJsonPreviewData">
          {{ t('common.button.refresh') }}
        </button>
      </div>

      <!-- JSON 树状数据展示 -->
      <div
        class="preview-tree-container"
        v-else-if="localData.rawData && localData.rawData.length > 0"
      >
        <JsonDataTree :data="localData.rawData" />
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-preview">
        <span class="empty-icon">📋</span>
        <span class="empty-text">{{ t('customNodes.jsonSourcePreviewNode.noData') }}</span>
      </div>

      <div v-if="localData.rawData && localData.rawData.length > 0" class="preview-footer">
        <div class="footer-info">
          {{
            t('customNodes.jsonSourcePreviewNode.displayingInfo', {
              rows: localData.rawData.length,
              total: localData.totalRows || 0,
            })
          }}
        </div>
        <div
          class="resize-handle"
          @mousedown.stop.prevent="startResize"
          :title="t('customNodes.jsonSourcePreviewNode.resizeHandle')"
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

    <Handle
      type="source"
      :position="Position.Right"
      :id="`${localData.id}-output`"
      class="output-handle"
    />
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import apiClient from '@/core/services/httpClient'
  import { Handle, Position } from '@vue-flow/core'
  import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { JsonSourcePreviewNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import JsonDataTree from './JsonDataTree.vue'

  const { t } = useI18n()

  const props = defineProps<{
    id: string
    data: JsonSourcePreviewNodeData
    selected?: boolean
  }>()

  const emit = defineEmits<{
    dataChanged: [data: JsonSourcePreviewNodeData]
  }>()

  const store = useGraphStore()

  const localData = ref<JsonSourcePreviewNodeData>({ ...props.data })
  const headerHovered = ref(false)
  const previewContainer = ref<HTMLElement | null>(null)
  const nodeWidth = ref(400)
  const previewHeight = ref(200)
  const isResizing = ref(false)
  const resizeStartX = ref(0)
  const resizeStartY = ref(0)
  const startWidth = ref(0)
  const startHeight = ref(0)

  // 数据加载状态
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  // debounce 定时器
  let configChangeTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 从后端获取 JSON 预览数据
   */
  const fetchJsonPreviewData = async () => {
    const filePath = localData.value.localPath
    if (!filePath) return

    isLoading.value = true
    loadError.value = null

    try {
      const requestBody: Record<string, unknown> = {
        file_path: filePath,
        max_rows: 100,
        max_cols: 50,
      }

      // 附加 JSON 特有参数
      if (localData.value.jsonPath) {
        requestBody.json_path = localData.value.jsonPath
      }
      if (localData.value.format) {
        requestBody.json_format = localData.value.format
      }
      if (localData.value.recordPath) {
        requestBody.record_path = localData.value.recordPath
      }

      let result: any
      try {
        const response = await apiClient.post('/preview/file/path', requestBody)
        result = response.data
      } catch (error: any) {
        const status = error?.response?.status
        const data = error?.response?.data
        const errorText =
          typeof data === 'string'
            ? data
            : (data?.error as string | undefined) ||
              (data?.message as string | undefined) ||
              (error?.message as string | undefined) ||
              '未知错误'
        throw new Error(`HTTP错误 ${status ?? ''}: ${errorText}`.trim())
      }
      if (!result.success) {
        throw new Error(result.error || '读取JSON文件失败')
      }

      // 更新节点数据 - JSON 使用 raw_data
      localData.value.rawData = result.raw_data || []
      localData.value.data = result.data || [] // 保留兼容性
      localData.value.totalRows = result.total_rows || 0
      localData.value.totalCols = result.total_cols || 0
      localData.value.actualRowCount = result.total_rows || 0
      localData.value.actualColCount = result.total_cols || 0

      // 同步到 store
      store.updateNodeData(props.id, localData.value)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '加载失败'
      loadError.value = errorMessage
      logger.error('[JsonSourcePreview] 数据加载失败:', error)
    } finally {
      isLoading.value = false
    }
  }

  watch(
    () => props.data,
    (newData) => {
      localData.value = { ...newData }
    },
    { deep: true }
  )

  const handleConfigChange = () => {
    emit('dataChanged', localData.value)
    notifyDataChange()

    // debounced 数据刷新
    if (configChangeTimer) clearTimeout(configChangeTimer)
    configChangeTimer = setTimeout(() => {
      fetchJsonPreviewData()
    }, 500)
  }

  const handleRemove = () => {
    store.deleteNode(props.id)
  }

  const startResize = (e: MouseEvent) => {
    isResizing.value = true
    resizeStartX.value = e.clientX
    resizeStartY.value = e.clientY
    startWidth.value = nodeWidth.value
    startHeight.value = previewHeight.value

    document.addEventListener('mousemove', handleResize)
    document.addEventListener('mouseup', stopResize)
  }

  const handleResize = (e: MouseEvent) => {
    if (!isResizing.value) return

    const deltaX = e.clientX - resizeStartX.value
    const deltaY = e.clientY - resizeStartY.value

    nodeWidth.value = Math.max(300, startWidth.value + deltaX)
    previewHeight.value = Math.max(100, startHeight.value + deltaY)
  }

  const stopResize = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', handleResize)
    document.removeEventListener('mouseup', stopResize)
  }

  const notifyDataChange = () => {
    store.updateNodeData(props.id, localData.value)
  }

  onMounted(() => {
    // 根据数据量调整节点宽度
    if (localData.value.rawData && localData.value.rawData.length > 0) {
      // JSON 树状显示使用固定宽度
      nodeWidth.value = Math.max(400, nodeWidth.value)
    }

    // 自动加载数据
    if (!localData.value.rawData || localData.value.rawData.length === 0) {
      fetchJsonPreviewData()
    }
  })

  onUnmounted(() => {
    document.removeEventListener('mousemove', handleResize)
    document.removeEventListener('mouseup', stopResize)

    // 清理 debounce 定时器
    if (configChangeTimer) {
      clearTimeout(configChangeTimer)
      configChangeTimer = null
    }
  })

  defineExpose({
    handleRemove,
    startResize,
    handleResize,
    stopResize,
    nodeWidth,
    previewHeight,
    isResizing,
    fetchJsonPreviewData,
  })
</script>

<style scoped src="./JsonSourcePreviewNode.styles.css" />
