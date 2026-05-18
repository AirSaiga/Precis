<!--
  @file JsonRenderer.vue
  @description JSON 只读字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <pre class="pre">{{ formatted }}</pre>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorJsonField } from '../types'

  const props = defineProps<{
    field: InspectorJsonField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const formatted = computed(() => {
    if (props.value === undefined) return ''
    try {
      return JSON.stringify(props.value, null, 2)
    } catch {
      return String(props.value)
    }
  })
</script>

<style scoped src="./JsonRenderer.styles.css"></style>
