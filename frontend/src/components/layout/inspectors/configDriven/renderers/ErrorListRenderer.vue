<!--
  @file ErrorListRenderer.vue
  @description 校验错误列表渲染器

  将 string[] 或 string 渲染为带警告样式的项目列表，
  替代 JsonRenderer 对 validationErrors 的原始 JSON 展示。
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <ul v-if="messages.length > 0" class="error-list">
      <li v-for="(msg, idx) in messages" :key="idx" class="error-item">
        <span class="error-marker"><AppIcon name="alert" :size="12" /></span>
        <span class="error-text">{{ msg }}</span>
      </li>
    </ul>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorErrorListField } from '../types'

  const props = defineProps<{
    field: InspectorErrorListField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  /** 将 value 归一化为非空字符串数组 */
  const messages = computed<string[]>(() => {
    const v = props.value
    if (Array.isArray(v)) {
      return v.map((item) => String(item)).filter((s) => s.length > 0)
    }
    if (typeof v === 'string' && v.trim()) {
      return [v]
    }
    return []
  })
</script>

<style scoped>
  .field {
    margin-bottom: 8px;
  }

  .label {
    display: block;
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
    margin-bottom: 4px;
  }

  .error-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .error-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--ui-danger, #f44336) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--ui-danger, #f44336) 25%, transparent);
    border-radius: var(--ui-radius-sm, 4px);
    font-size: 12px;
    color: var(--ui-text-primary, #ccc);
    line-height: 1.4;
  }

  .error-marker {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--ui-danger, #f44336);
    padding-top: 1px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
    word-break: break-word;
    user-select: text;
    -webkit-user-select: text;
  }

  .help {
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
    margin-top: 4px;
  }
</style>
