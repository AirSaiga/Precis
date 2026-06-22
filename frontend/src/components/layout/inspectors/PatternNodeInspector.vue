<!--
  @file PatternNodeInspector.vue
  @description Pattern 节点属性检查器，用于显示 Pattern 节点的属性信息
-->
<template>
  <div class="pattern-inspector">
    <!-- 1. 模式配置区块（只读） -->
    <BaseInspector
      :title="t('inspector.patternNode.groups.config')"
      :badge="t('inspector.patternNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.patternNode.labels.patternName')"
        :model-value="data.name || '-'"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.patternNode.labels.patternType')"
        :model-value="getPatternTypeText()"
        :editable="false"
      />
      <InspectorField
        v-if="data.description"
        :label="t('inspector.patternNode.labels.description')"
        :model-value="data.description"
        :editable="false"
      />
    </BaseInspector>

    <!-- 2. 正则表达式区块（只读） -->
    <BaseInspector
      :title="t('inspector.patternNode.groups.regex')"
      :badge="t('inspector.patternNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.patternNode.labels.pattern') }}</label>
        <div class="regex-preview">
          <code class="regex-text">{{ data.pattern || '-' }}</code>
        </div>
      </div>
      <InspectorField
        v-if="data.flags"
        :label="t('inspector.patternNode.labels.flags')"
        :model-value="data.flags || '-'"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.patternNode.labels.caseSensitive')"
        :model-value="
          data.caseSensitive
            ? t('inspector.patternNode.values.caseSensitive')
            : t('inspector.patternNode.values.caseInsensitive')
        "
        :editable="false"
      />
    </BaseInspector>

    <!-- 3. 来源信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.patternNode.groups.source')"
      :badge="t('inspector.patternNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.patternNode.labels.registry')"
        :model-value="data.registry || 'patterns'"
        :editable="false"
      />
      <InspectorField
        v-if="data.sourceFile"
        :label="t('inspector.patternNode.labels.sourceFile')"
        :model-value="data.sourceFile"
        type="path"
        :editable="false"
      />
    </BaseInspector>

    <!-- 4. 校验状态区块（只读） -->
    <BaseInspector
      :title="t('inspector.patternNode.groups.status')"
      :badge="t('inspector.patternNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.patternNode.labels.validationStatus') }}</label>
        <div class="status-indicator" :class="data.validationStatus || 'idle'">
          <span class="status-icon">{{ getValidationIcon() }}</span>
          <span class="status-text">{{ getValidationText() }}</span>
        </div>
      </div>
      <InspectorField
        v-if="data.matchCount !== undefined"
        :label="t('inspector.patternNode.labels.matchCount')"
        :model-value="`${data.matchCount} ${t('inspector.patternNode.values.matches')}`"
        :editable="false"
      />
      <InspectorField
        v-if="data.matchRate !== undefined"
        :label="t('inspector.patternNode.labels.matchRate')"
        :model-value="`${data.matchRate}%`"
        :editable="false"
      />
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  const { t } = useI18n()

  /**
   * Pattern 节点检查器数据接口
   * 扩展自基础的 PatternNodeData，添加了可选的来源文件和校验状态字段
   */
  interface PatternNodeInspectorData {
    patternId: string
    name: string
    registry: 'patterns'
    pattern?: string
    flags?: string
    caseSensitive?: boolean
    description?: string
    sourceFile?: string
    validationStatus?: 'pass' | 'error' | 'idle'
    matchCount?: number
    matchRate?: number
  }

  /**
   * 组件属性接口
   */
  interface Props {
    data: PatternNodeInspectorData
  }

  /**
   * 使用 defineProps 声明组件属性
   */
  const props = defineProps<Props>()

  /**
   * 获取模式类型的 CSS 类名
   * 根据模式类型返回对应的样式类
   *
   * @returns 模式类型的 CSS 类名
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  function getPatternTypeClass(): string {
    const type = getPatternType()
    return `type-${type}`
  }

  /**
   * 获取模式类型
   * 根据 patternId 判断模式类型
   *
   * @returns 'atomic' | 'combination'
   */
  function getPatternType(): 'atomic' | 'combination' {
    if (props.data.patternId?.startsWith('atomic:') || props.data.patternId?.startsWith('basic:')) {
      return 'atomic'
    }
    return 'combination'
  }

  /**
   * 获取模式类型的图标
   *
   * @returns 模式类型对应的图标
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  function getPatternTypeIcon(): string {
    const type = getPatternType()
    switch (type) {
      case 'atomic':
        return '⚛'
      case 'combination':
        return '🔗'
      default:
        return '?'
    }
  }

  /**
   * 获取模式类型的中文文本
   *
   * @returns 模式类型对应的中文名称
   */
  function getPatternTypeText(): string {
    const type = getPatternType()
    switch (type) {
      case 'atomic':
        return t('inspector.patternNode.types.atomic')
      case 'combination':
        return t('inspector.patternNode.types.combination')
      default:
        return t('inspector.patternNode.types.unknown')
    }
  }

  /**
   * 获取校验状态的图标
   *
   * @returns 校验状态对应的图标字符
   */
  function getValidationIcon(): string {
    const status = props.data.validationStatus
    switch (status) {
      case 'pass':
        return '✓'
      case 'error':
        return '✗'
      default:
        return '○'
    }
  }

  /**
   * 获取校验状态的中文文本
   *
   * @returns 校验状态对应的中文文本
   */
  function getValidationText(): string {
    const status = props.data.validationStatus
    switch (status) {
      case 'pass':
        return t('inspector.patternNode.status.pass')
      case 'error':
        return t('inspector.patternNode.status.error')
      default:
        return t('inspector.patternNode.status.idle')
    }
  }
</script>

<style scoped src="./PatternNodeInspector.styles.css"></style>
