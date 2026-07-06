<!--
  @file DescriptionCardRenderer.vue
  @description Transform 类型说明卡渲染器

  展示当前 transformType 的：
  - 所属分类图标（iconRegistry 中的图标名）
  - 类型名（如"字符串切割"）
  - 一句话功能描述
  - 输入/输出语义标签（如"单列 → 多列"）

  纯展示，不接收 commit。数据来源 transformCategory.ts + i18n。
-->
<template>
  <div class="description-card">
    <div class="card-body">
      <div class="card-icon-wrap">
        <AppIcon class="card-icon" :name="category?.icon ?? 'gear'" :size="16" />
      </div>
      <div class="card-content">
        <div class="card-header">
          <span class="card-type-name">{{ typeName }}</span>
          <span v-if="category" class="card-category-badge">{{ t(category.labelKey) }}</span>
        </div>
        <p class="card-description">{{ description }}</p>
        <div class="card-semantic">
          <span class="semantic-tag" :class="`semantic-${semantic}`">
            <span class="semantic-dot"></span>
            {{ t(`inspector.transformNode.typeSemantics.${semantic}`) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { TransformTypeV2 } from '@/types/projectV2'
  import type { InspectorContext } from '../utils'
  import type { InspectorDescriptionCardField } from '../types'
  import { TRANSFORM_TYPE_I18N_KEYS } from '@/composables/nodes/transform/transformDisplay'
  import {
    getCategoryForType,
    getSemanticForType,
  } from '@/composables/nodes/transform/transformCategory'

  const { t, te } = useI18n()

  const props = defineProps<{
    field: InspectorDescriptionCardField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  /** 当前 transformType（从节点 data 读取） */
  const currentType = computed<TransformTypeV2 | undefined>(() => {
    return props.ctx.data.transformType as TransformTypeV2 | undefined
  })

  /** 所属分类 */
  const category = computed(() =>
    currentType.value ? getCategoryForType(currentType.value) : undefined
  )

  /** 输入/输出语义 */
  const semantic = computed(() =>
    currentType.value ? getSemanticForType(currentType.value) : 'singleColumn'
  )

  /** 类型显示名 */
  const typeName = computed(() => {
    const type = currentType.value
    if (!type) return '-'
    const key = TRANSFORM_TYPE_I18N_KEYS[type]
    return key ? t(key) : type
  })

  /**
   * 一句话功能描述。
   * i18n key 规则：inspector.transformNode.typeDescriptions.<camelCaseTypeName>
   * 未配置时回退到类型名，避免显示 raw key。
   */
  const description = computed(() => {
    const type = currentType.value
    if (!type) return ''
    const camelKey = type.charAt(0).toLowerCase() + type.slice(1)
    const key = `inspector.transformNode.typeDescriptions.${camelKey}`
    return te(key) ? t(key) : typeName.value
  })
</script>

<style scoped>
  /*
   * DescriptionCardRenderer 样式 —— 复用 StatCardRenderer 的卡片视觉
   */
  .description-card {
    margin-bottom: 12px;
  }

  .card-body {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: var(--ui-bg-subtle);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-md);
    transition:
      background var(--ui-transition-fast),
      border-color var(--ui-transition-fast);
  }

  .card-icon-wrap {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-accent);
    flex-shrink: 0;
  }

  .card-icon {
    font-size: 18px;
    line-height: 1;
  }

  .card-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .card-type-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-text-strong);
    line-height: 1.3;
  }

  .card-category-badge {
    font-size: 10px;
    font-weight: 500;
    color: var(--ui-text-muted);
    background: var(--ui-bg-canvas);
    border: 1px solid var(--ui-border-light);
    border-radius: 10px;
    padding: 1px 8px;
    white-space: nowrap;
  }

  .card-description {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ui-text-secondary);
  }

  .card-semantic {
    margin-top: 2px;
  }

  .semantic-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--ui-text-muted);
  }

  .semantic-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* 单列变换 —— 中性灰 */
  .semantic-singleColumn .semantic-dot {
    background: var(--ui-text-muted);
  }

  /* 单列 → 多列 —— 强调蓝 */
  .semantic-multiColumn .semantic-dot {
    background: var(--ui-accent);
  }

  /* 会改变行数 —— 警告琥珀 */
  .semantic-rowChanging .semantic-dot {
    background: var(--ui-warning-strong);
  }

  /* 行级原子拆分 —— 紫色 */
  .semantic-rowAtomic .semantic-dot {
    background: #a855f7;
  }
</style>
