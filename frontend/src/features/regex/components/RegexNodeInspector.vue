<!--
  @file RegexNodeInspector.vue
  @description 正则表达式节点属性检查器组件

  这个组件用于显示和编辑正则表达式节点（RegexNode）的属性信息。
  正则表达式节点用于定义数据校验规则，通过正则表达式模式匹配来验证数据。

  功能概述：
  - 正则配置（可编辑）：配置名称、描述
  - 正则表达式（可编辑）：正则模式、正则标志、匹配模式
  - 选项设置（可编辑）：启用状态、区分大小写
  - 校验状态（只读）：当前状态、最后校验时间
  - 校验结果（只读）：总行数、匹配数量、错误数量、匹配率
  - 数据源连接（只读）：数据源节点状态、目标列名
-->
<template>
  <!-- 整个属性检查器容器 -->
  <div class="regex-inspector">
    <!-- 1. 正则配置区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.regexNode.groups.config')"
      :badge="t('inspector.regexNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.regexNode.placeholders.configName')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.description') }}</label>
        <textarea
          :value="data.description"
          @input="updateData({ description: ($event.target as HTMLTextAreaElement).value })"
          class="editable-textarea"
          :placeholder="t('inspector.regexNode.placeholders.description')"
          rows="3"
        />
      </div>
    </BaseInspector>

    <!-- 2. 正则表达式区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.regexNode.groups.regex')"
      :badge="t('inspector.regexNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.pattern') }}</label>
        <div class="regex-pattern-wrapper">
          <textarea
            :value="data.pattern"
            @input="updateData({ pattern: ($event.target as HTMLTextAreaElement).value })"
            class="editable-textarea code-font"
            :placeholder="t('inspector.regexNode.placeholders.pattern')"
            rows="4"
          />
        </div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.flags') }}</label>
        <input
          type="text"
          :value="data.flags"
          @input="updateData({ flags: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.regexNode.placeholders.flags')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.matchMode') }}</label>
        <select
          :value="data.matchMode"
          @change="
            updateData({
              matchMode: ($event.target as HTMLSelectElement).value as
                | 'full'
                | 'partial'
                | 'extract',
            })
          "
          class="editable-select"
        >
          <option value="full">{{ t('customNodes.regexNode.matchModes.full') }}</option>
          <option value="partial">{{ t('customNodes.regexNode.matchModes.partial') }}</option>
          <option value="extract">{{ t('customNodes.regexNode.matchModes.extract') }}</option>
        </select>
      </div>
      <div class="form-group" v-if="connectedPatternNode">
        <label>{{ t('inspector.regexNode.labels.patternSource') }}</label>
        <div class="readonly-value">
          <span class="pattern-source-badge">
            <span class="badge-icon">📚</span>
            <span class="badge-text">{{ connectedPatternNode.name }}</span>
          </span>
        </div>
      </div>
      <div class="form-group" v-else>
        <label>{{ t('inspector.regexNode.labels.patternSource') }}</label>
        <div class="readonly-value">
          <span class="pattern-source-badge canvas">
            <span class="badge-icon">🎨</span>
            <span class="badge-text">{{ t('inspector.regexNode.values.canvas') }}</span>
          </span>
        </div>
      </div>
    </BaseInspector>

    <!-- 3. 选项设置区块（可编辑） -->
    <BaseInspector
      :title="t('inspector.regexNode.groups.options')"
      :badge="t('inspector.regexNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.enabled') }}</label>
        <div class="toggle-switch">
          <input
            type="checkbox"
            :checked="data.enabled"
            @change="updateData({ enabled: ($event.target as HTMLInputElement).checked })"
            id="enabled-toggle"
          />
          <label for="enabled-toggle" class="toggle-label">
            <span class="toggle-slider"></span>
            <span class="toggle-text">{{
              data.enabled
                ? t('inspector.regexNode.values.enabled')
                : t('inspector.regexNode.values.disabled')
            }}</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.caseSensitive') }}</label>
        <div class="toggle-switch">
          <input
            type="checkbox"
            :checked="data.caseSensitive"
            @change="updateData({ caseSensitive: ($event.target as HTMLInputElement).checked })"
            id="case-sensitive-toggle"
          />
          <label for="case-sensitive-toggle" class="toggle-label">
            <span class="toggle-slider"></span>
            <span class="toggle-text">{{
              data.caseSensitive
                ? t('inspector.regexNode.values.caseSensitive')
                : t('inspector.regexNode.values.caseInsensitive')
            }}</span>
          </label>
        </div>
      </div>
    </BaseInspector>

    <!-- 4. 校验状态区块（只读） -->
    <BaseInspector
      :title="t('inspector.regexNode.groups.status')"
      :badge="t('inspector.regexNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.regexNode.labels.currentStatus') }}</label>
        <div class="status-indicator" :class="data.validationStatus">
          <span class="status-icon">{{ getValidationIcon(data.validationStatus) }}</span>
          <span class="status-text">{{ getValidationText(data.validationStatus) }}</span>
        </div>
      </div>
      <InspectorField
        v-if="data.lastValidationTime"
        :label="t('inspector.regexNode.labels.lastValidation')"
        :model-value="formatDateTime(data.lastValidationTime)"
        :editable="false"
      />
    </BaseInspector>

    <!-- 5. 校验结果区块（只读，仅在非空闲状态时显示） -->
    <BaseInspector
      :title="t('inspector.regexNode.groups.result')"
      :badge="t('inspector.regexNode.badgeReadOnly')"
      badge-class="read-only"
      v-if="data.validationStatus !== 'idle'"
    >
      <InspectorField
        :label="t('inspector.regexNode.labels.totalRows')"
        :model-value="`${data.totalRows || 0} 行`"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.regexNode.labels.matchCount')"
        :model-value="`${data.matchCount || 0} 行`"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.regexNode.labels.errorCount')"
        :model-value="`${data.errorCount || 0} 个`"
        :editable="false"
      />
      <InspectorField
        v-if="data.totalRows && data.matchCount !== undefined"
        :label="t('inspector.regexNode.labels.matchRate')"
        :model-value="`${calculateMatchRate()}%`"
        :editable="false"
      />
    </BaseInspector>

    <!-- 6. 数据源连接区块（只读） -->
    <BaseInspector
      :title="t('inspector.regexNode.groups.connection')"
      :badge="t('inspector.regexNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.regexNode.labels.sourceNode')"
        :model-value="
          data.sourceNodeId
            ? t('inspector.regexNode.values.connected')
            : t('inspector.regexNode.values.notConnected')
        "
        :editable="false"
      />
      <InspectorField
        v-if="data.sourceColumnName"
        :label="t('inspector.regexNode.labels.targetColumn')"
        :model-value="data.sourceColumnName"
        :editable="false"
      />
      <!-- 提示信息 -->
      <div class="info-tip" v-if="!data.sourceNodeId">
        {{ t('inspector.regexNode.tips.connectFirst') }}
      </div>
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { storeToRefs } from 'pinia'
  import { useGraphStore } from '@/stores/graphStore'
  import BaseInspector from '@/components/layout/inspectors/BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { PatternNodeData } from '@/features/regex/types'
  import type { RegexNodeData } from '@/types/graph'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const { nodes, edges } = storeToRefs(graphStore)

  /**
   * 组件属性接口
   * 接收 RegexNodeData 类型的数据
   */
  interface Props {
    data: RegexNodeData
    nodeId?: string
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
    'update:data': [data: Partial<RegexNodeData>]
  }>()

  /**
   * 获取关联的 Pattern 节点信息
   * 从 graphStore 中查找通过边连接到该 regex 的 pattern 类型节点
   */
  const connectedPatternNode = computed(() => {
    if (!props.nodeId) return null
    const patternNodes = nodes.value.filter((n) => n.type === 'pattern')
    const connectedPattern = patternNodes.find((patternNode) => {
      const outputEdge = edges.value.find(
        (e) => e.source === patternNode.id && e.target === props.nodeId
      )
      return outputEdge !== undefined
    })
    if (!connectedPattern) return null
    return {
      name: (connectedPattern.data as unknown as PatternNodeData).name || connectedPattern.id,
      patternId: (connectedPattern.data as unknown as PatternNodeData).patternId || '',
    }
  })

  /**
   * 更新数据函数
   * 将更新后的数据通过事件发送给父组件
   *
   * @param newData - 包含部分更新字段的对象
   */
  function updateData(newData: Partial<RegexNodeData>) {
    emit('update:data', newData)
  }

  /**
   * 获取校验状态的图标
   *
   * @param status - 校验状态字符串
   * @returns 对应的图标字符
   */
  function getValidationIcon(status: string): string {
    switch (status) {
      case 'pass':
        return '✓'
      case 'error':
        return '✗'
      case 'idle':
        return '○'
      default:
        return '?'
    }
  }

  /**
   * 获取校验状态的中文文本
   *
   * @param status - 校验状态字符串
   * @returns 对应的中文状态文本
   */
  function getValidationText(status: string): string {
    switch (status) {
      case 'pass':
        return t('inspector.regexNode.status.pass')
      case 'error':
        return t('inspector.regexNode.status.error')
      case 'idle':
        return t('inspector.regexNode.status.idle')
      default:
        return t('inspector.regexNode.status.unknown')
    }
  }

  /**
   * 格式化日期时间字符串
   * 将日期字符串转换为本地化的日期时间格式
   *
   * @param dateString - 日期字符串
   * @returns 格式化后的日期时间字符串，如果为空则返回 '-'
   */
  function formatDateTime(dateString: string): string {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  /**
   * 计算匹配率
   * 计算匹配行数占总行数的百分比
   *
   * @returns 匹配率百分比字符串，保留一位小数
   */
  function calculateMatchRate(): string {
    if (!props.data.totalRows || props.data.matchCount === undefined) return '0.0'
    const rate = (props.data.matchCount / props.data.totalRows) * 100
    return rate.toFixed(1)
  }
</script>

<style scoped src="./RegexNodeInspector.styles.css" />
