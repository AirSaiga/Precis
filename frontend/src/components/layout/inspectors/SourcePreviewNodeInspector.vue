<!--
  @file SourcePreviewNodeInspector.vue
  @description 数据源预览节点属性检查器组件

  这个组件用于显示和编辑数据源预览节点（SourcePreviewNode）的属性信息。
  数据源预览节点代表一个已加载的数据文件，提供数据的预览和统计信息。

  功能概述：
  - 数据源信息（只读）：名称、路径、类型、大小
  - 数据统计（只读）：行列数统计
  - Sheet 信息（只读）：当前 Sheet、可用 Sheets 列表
  - 表头设置（可编辑）：表头行索引
  - 连接状态（只读）：输出端口连接状态
  - 时间信息（只读）：创建时间、最后修改时间
-->
<template>
  <!-- 整个属性检查器容器 -->
  <div class="source-preview-inspector">
    <!-- 1. 数据源信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.sourcePreview.groups.basicInfo')"
      :badge="t('inspector.sourcePreview.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.sourcePreview.labels.sourceId')"
        :model-value="data.id || '-'"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.sourceName')"
        :model-value="data.sourceName"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.filePath')"
        :model-value="data.localPath"
        type="path"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.fileType')"
        :model-value="
          data.sourceType === 'excel'
            ? 'Excel'
            : data.sourceType === 'csv'
              ? 'CSV'
              : data.fileType || '-'
        "
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.fileSize')"
        :model-value="formatFileSize(data.fileSize)"
        :editable="false"
      />
      <div class="form-group" v-if="connectedSchemaNodes.length > 0">
        <label>{{ t('inspector.sourcePreview.labels.connectedSchemas') }}</label>
        <div class="connected-nodes">
          <span v-for="(schemaName, index) in connectedSchemaNodes" :key="index" class="node-tag">
            <span class="tag-icon">📋</span>
            <span class="tag-text">{{ schemaName }}</span>
          </span>
        </div>
      </div>
    </BaseInspector>

    <!-- 2. 数据统计区块（只读） -->
    <BaseInspector
      :title="t('inspector.sourcePreview.groups.statistics')"
      :badge="t('inspector.sourcePreview.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.sourcePreview.labels.totalRows')"
        :model-value="`${data.totalRows || 0} ${t('inspector.sourcePreview.units.rows')}`"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.totalCols')"
        :model-value="`${data.totalCols || 0} ${t('inspector.sourcePreview.units.cols')}`"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.previewRowCount')"
        :model-value="`${data.previewRowCount || 0} ${t('inspector.sourcePreview.units.rows')}`"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.previewColCount')"
        :model-value="`${data.previewColCount || 0} ${t('inspector.sourcePreview.units.cols')}`"
        :editable="false"
      />
    </BaseInspector>

    <!-- 3. Sheet 信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.sourcePreview.groups.sheets')"
      :badge="t('inspector.sourcePreview.badgeEditable')"
      badge-class="editable"
      v-if="data.sheets && data.sheets.length > 0"
    >
      <InspectorField
        :label="t('inspector.sourcePreview.labels.currentSheet')"
        :model-value="data.currentSheet || t('inspector.sourcePreview.values.notSelected')"
        :editable="false"
      />
      <div class="form-group">
        <label>{{ t('inspector.sourcePreview.labels.availableSheets') }}</label>
        <div class="sheets-list">
          <span v-for="sheet in data.sheets" :key="sheet" class="sheet-tag">
            {{ sheet }}
          </span>
        </div>
      </div>
    </BaseInspector>

    <!-- 4. 表头设置区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.sourcePreview.groups.header')"
      :badge="t('inspector.sourcePreview.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.sourcePreview.labels.headerRow') }}</label>
        <input
          type="number"
          :value="data.headerRow ?? 0"
          @input="
            updateData({ headerRow: parseInt(($event.target as HTMLInputElement).value) || 0 })
          "
          min="0"
          class="editable-input"
        />
      </div>
      <div class="info-tip">
        {{ t('inspector.sourcePreview.tips.headerRow') }}
      </div>
    </BaseInspector>

    <!-- 5. 连接状态区块（只读） -->
    <BaseInspector
      :title="t('inspector.sourcePreview.groups.connection')"
      :badge="t('inspector.sourcePreview.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.sourcePreview.labels.outputPortStatus') }}</label>
        <div class="status-indicator" :class="{ connected: data.outputPortConnected }">
          <span v-if="data.outputPortConnected" class="status-icon connected">●</span>
          <span v-else class="status-icon disconnected">○</span>
          <span class="status-text">{{
            data.outputPortConnected
              ? t('inspector.sourcePreview.values.connected')
              : t('inspector.sourcePreview.values.notConnected')
          }}</span>
        </div>
      </div>
    </BaseInspector>

    <!-- 6. 提取列信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.sourcePreview.groups.extractedColumns')"
      :badge="t('inspector.sourcePreview.badgeReadOnly')"
      badge-class="read-only"
      v-if="extractedColumns.length > 0"
    >
      <div v-for="(item, index) in extractedColumns" :key="index" class="extracted-group">
        <div class="extracted-source">
          {{ t('inspector.sourcePreview.labels.regexSource') }}: {{ item.source.slice(0, 8) }}...
        </div>
        <div class="extracted-list">
          <span
            v-for="(col, colIndex) in item.columns"
            :key="colIndex"
            class="extracted-column-tag"
          >
            {{ col }}
          </span>
        </div>
      </div>
    </BaseInspector>

    <!-- 7. 时间信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.sourcePreview.groups.timestamp')"
      :badge="t('inspector.sourcePreview.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.sourcePreview.labels.createdAt')"
        :model-value="formatTimestamp(data.createdAt)"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.sourcePreview.labels.lastModified')"
        :model-value="formatTimestamp(data.lastModified)"
        :editable="false"
      />
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { storeToRefs } from 'pinia'
  import { useGraphStore } from '@/stores/graphStore'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { SourcePreviewNodeData } from '@/types/datasource'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const { nodes, edges } = storeToRefs(graphStore)

  /**
   * 组件属性接口
   * 接收 SourcePreviewNodeData 类型的数据
   */
  interface Props {
    data: SourcePreviewNodeData
  }

  /**
   * 使用 defineProps 声明组件属性
   */
  const props = defineProps<Props>()

  /**
   * 定义组件可以触发的事件
   * update:data 事件用于通知父组件数据已更新
   */
  const emit = defineEmits<{
    'update:data': [data: Partial<SourcePreviewNodeData>]
  }>()

  /**
   * 获取关联的 Schema 节点名称列表
   * 从 graphStore 中查找通过边连接到该 sourcePreview 的 schema 类型节点
   */
  const connectedSchemaNodes = computed(() => {
    const schemaNodes = nodes.value.filter((n) => n.type === 'schema')
    const connectedSchemaNodes = schemaNodes.filter((schemaNode) => {
      const inputEdge = edges.value.find(
        (e) => e.target === schemaNode.id && e.source === props.data.id
      )
      return inputEdge !== undefined
    })
    return connectedSchemaNodes.map(
      (n) =>
        ((n.data as unknown as Record<string, unknown>).configName as string) ||
        ((n.data as unknown as Record<string, unknown>).tableName as string) ||
        n.id
    )
  })

  /**
   * 获取提取列信息
   * 从 derivedColumnsByRegex 中解析所有通过正则提取的列
   */
  const extractedColumns = computed(() => {
    const derivedColumns = props.data.derivedColumnsByRegex
    if (!derivedColumns) return []

    const allColumns: Array<{ source: string; columns: string[] }> = []
    Object.entries(derivedColumns).forEach(([regexNodeId, value]) => {
      allColumns.push({
        source: regexNodeId,
        columns: value.columnNames,
      })
    })
    return allColumns
  })

  /**
   * 更新数据函数
   * 将更新后的数据通过事件发送给父组件
   *
   * @param newData - 包含部分更新字段的对象
   */
  function updateData(newData: Partial<SourcePreviewNodeData>) {
    emit('update:data', newData)
  }

  /**
   * 格式化文件大小
   * 将字节数转换为人类可读的单位（KB、MB、GB）
   *
   * @param bytes - 文件大小（字节）
   * @returns 格式化后的文件大小字符串
   */
  function formatFileSize(bytes: number): string {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  /**
   * 格式化时间戳
   * 将时间戳转换为本地化的日期时间字符串
   *
   * @param timestamp - 时间戳（毫秒）
   * @returns 格式化后的日期时间字符串，如果 timestamp 为 0 或不存在则返回 '-'
   */
  function formatTimestamp(timestamp: number): string {
    if (!timestamp) return '-'
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }
</script>

<style scoped src="./SourcePreviewNodeInspector.styles.css"></style>
