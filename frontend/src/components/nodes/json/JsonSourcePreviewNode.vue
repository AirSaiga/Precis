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
        class="reload-btn"
        @click="handleReloadData"
        :title="t('customNodes.jsonSourcePreviewNode.reloadData')"
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
        :title="t('customNodes.jsonSourcePreviewNode.removeNode')"
      >
        ×
      </button>
    </div>

    <div class="config-toolbar">
      <div class="config-section">
        <label class="config-label">{{ t('customNodes.jsonSourcePreviewNode.format') }}</label>
        <select class="config-select" v-model="localData.format" @change="handleConfigChange">
          <option value="auto">{{ t('customNodes.jsonSourcePreviewNode.formatAuto') }}</option>
          <option value="array">{{ t('customNodes.jsonSourcePreviewNode.formatArray') }}</option>
          <option value="lines">{{ t('customNodes.jsonSourcePreviewNode.formatLines') }}</option>
          <option value="object">{{ t('customNodes.jsonSourcePreviewNode.formatObject') }}</option>
        </select>
      </div>
      <div v-if="typeStats" class="type-stats">
        <span class="stat-item">{{ typeStats.fieldCount }} {{ t('customNodes.jsonSourcePreviewNode.fields') }}</span>
        <span class="stat-item">{{ typeStats.nestDepth }} {{ t('customNodes.jsonSourcePreviewNode.nestDepth') }}</span>
      </div>
    </div>

    <div class="path-config-section">
      <div class="path-config-item" :class="{ required: localData.format === 'object' }">
        <label class="config-label">
          JSONPath
          <span v-if="localData.format === 'object'" class="required-badge">*</span>
        </label>
        <input
          type="text"
          class="config-input"
          :class="{ invalid: jsonPathInvalid }"
          v-model="localData.jsonPath"
          :placeholder="t('customNodes.jsonSourcePreviewNode.jsonPathPlaceholder')"
          @change="handleConfigChange"
        />
        <span v-if="jsonPathInvalid" class="input-error">{{ t('customNodes.jsonSourcePreviewNode.jsonPathError') }}</span>
      </div>
      <div v-if="localData.format !== 'lines'" class="path-config-item">
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
        <JsonDataTree :data="localData.rawData" :type-inference="localData.typeInference" />
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-preview">
        <span class="empty-icon">📋</span>
        <span class="empty-text">{{ t('customNodes.jsonSourcePreviewNode.noData') }}</span>
      </div>

      <!-- 类型不匹配警告 -->
      <div v-if="localData.validationMismatches && localData.validationMismatches.length > 0" class="validation-warning">
        <span class="warning-icon">⚠️</span>
        <span class="warning-text">
          {{ localData.validationMismatches.length }} 个字段类型与 Schema 定义不匹配
        </span>
        <button class="warning-detail-btn" @click="showValidationDetails = true">查看</button>
      </div>

      <div v-if="localData.rawData && localData.rawData.length > 0" class="preview-footer">
        <div class="footer-info">
          {{
            t('customNodes.jsonSourcePreviewNode.displayingInfo', {
              rows: localData.rawData.length,
              total: localData.totalRows || 0,
            })
          }}
          <span v-if="typeStats" class="footer-stats">
            · {{ typeStats.fieldCount }} {{ t('customNodes.jsonSourcePreviewNode.fields') }}
            · {{ typeStats.nestDepth }} {{ t('customNodes.jsonSourcePreviewNode.nestDepth') }}
          </span>
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
  const isReloading = ref(false)
  const showValidationDetails = ref(false)

  // debounce 定时器
  let configChangeTimer: ReturnType<typeof setTimeout> | null = null

  // 类型统计（优先使用后端返回，其次本地推断）
  const typeStats = computed(() => {
    // 优先使用后端返回的统计
    if (localData.value.fieldCount !== undefined || localData.value.nestDepth !== undefined) {
      return {
        fieldCount: localData.value.fieldCount ?? 0,
        nestDepth: localData.value.nestDepth ?? 0,
      }
    }

    // 本地推断（兼容旧数据）
    const rawData = localData.value.rawData
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return null

    const firstRecord = rawData[0]
    if (!firstRecord || typeof firstRecord !== 'object' || Array.isArray(firstRecord)) return null

    const fieldCount = Object.keys(firstRecord).length

    const calcDepth = (obj: unknown, depth = 0): number => {
      if (!obj || typeof obj !== 'object') return depth
      if (Array.isArray(obj)) {
        if (obj.length === 0) return depth
        return Math.max(...obj.map((item) => calcDepth(item, depth + 1)))
      }
      const values = Object.values(obj as Record<string, unknown>)
      if (values.length === 0) return depth
      return Math.max(...values.map((v) => calcDepth(v, depth + 1)))
    }

    const nestDepth = calcDepth(firstRecord, 0)

    return { fieldCount, nestDepth }
  })

  // JSONPath 格式校验
  const jsonPathInvalid = computed(() => {
    const jsonPath = localData.value.jsonPath
    if (!jsonPath) return false
    return !jsonPath.trim().startsWith('$')
  })

  /**
   * 与已连接的 JsonSchemaNode 进行类型对比校验
   */
  const validateAgainstConnectedSchema = async () => {
    const typeInference = localData.value.typeInference
    if (!typeInference) return

    // 查找连接的 JsonSchemaNode
    const connectedEdge = store.edges.find(
      (edge) => edge.source === props.id && edge.targetHandle === 'target-left'
    )
    if (!connectedEdge) return

    const schemaNode = store.nodes.find((n) => n.id === connectedEdge.target)
    if (!schemaNode || schemaNode.type !== 'jsonSchema') return

    const schemaData = schemaNode.data as Record<string, unknown>
    const columns = (schemaData.columns || []) as Array<Record<string, unknown>>
    if (columns.length === 0) return

    // 对比 typeInference 与列定义的 dataType
    const mismatches: Array<{ field: string; expected: string; actual: string }> = []

    for (const col of columns) {
      const colName = col.columnName as string
      const colType = col.dataType as string
      if (!colName || !colType) continue

      const inferredType = typeInference[colName]
      if (!inferredType) continue

      // 类型映射：将后端推断类型映射为自定义类型
      const typeMap: Record<string, string> = {
        string: 'string',
        number: 'number',
        boolean: 'boolean',
        null: 'null',
        object: 'object',
        array: 'array',
      }

      const mappedType = typeMap[inferredType]
      if (mappedType && mappedType !== colType) {
        mismatches.push({
          field: colName,
          expected: colType,
          actual: mappedType,
        })
      }
    }

    // 保存校验结果到节点数据
    localData.value.validationMismatches = mismatches.length > 0 ? mismatches : undefined
    store.updateNodeData(props.id, localData.value)

    if (mismatches.length > 0) {
      logger.warn('[JsonSourcePreview] 类型不匹配:', mismatches)
    }
  }

  /**
   * 从后端获取 JSON 预览数据
   */
  const fetchJsonPreviewData = async () => {
    const filePath = localData.value.localPath
    if (!filePath) return

    // object 格式必须提供 JSONPath
    if (localData.value.format === 'object' && !localData.value.jsonPath) {
      loadError.value = '嵌套对象格式需要配置 JSONPath 以提取数据数组'
      return
    }

    isLoading.value = true
    loadError.value = null

    try {
      const requestBody: Record<string, unknown> = {
        file_path: filePath,
        max_rows: 100,
        max_cols: 50,
      }

      // 附加 JSON 特有参数
      if (localData.value.jsonPath?.trim()) {
        requestBody.json_path = localData.value.jsonPath.trim()
      }
      // 始终传递 format（默认 auto）
      requestBody.json_format = localData.value.format || 'auto'
      if (localData.value.recordPath?.trim()) {
        requestBody.record_path = localData.value.recordPath.trim()
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

      // 保存后端返回的类型推断和结构统计
      localData.value.typeInference = result.type_inference || undefined
      localData.value.fieldCount = result.field_count || undefined
      localData.value.nestDepth = result.nest_depth || undefined

      // 同步到 store
      store.updateNodeData(props.id, localData.value)

      // 如果已连接 JsonSchemaNode，自动触发类型对比校验
      await validateAgainstConnectedSchema()
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
    // object 格式时自动校验 JSONPath
    if (localData.value.format === 'object' && localData.value.jsonPath && !localData.value.jsonPath.trim().startsWith('$')) {
      // 显示错误但不阻止保存配置
      logger.warn('[JsonSourcePreview] JSONPath 格式不正确，应以 "$" 开头')
    }

    emit('dataChanged', localData.value)
    notifyDataChange()

    // debounced 数据刷新
    if (configChangeTimer) clearTimeout(configChangeTimer)
    configChangeTimer = setTimeout(() => {
      fetchJsonPreviewData()
    }, 500)
  }

  const handleReloadData = async () => {
    isReloading.value = true
    await fetchJsonPreviewData()
    isReloading.value = false
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
    handleReloadData,
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
