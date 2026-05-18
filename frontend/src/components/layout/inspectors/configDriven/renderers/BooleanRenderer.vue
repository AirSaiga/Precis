<!--
  @file BooleanRenderer.vue
  @description 布尔值字段渲染器
-->
<template>
  <div class="field">
    <div class="row">
      <label class="label">{{ label }}</label>
      <input
        class="toggle"
        type="checkbox"
        :checked="checked"
        :disabled="readonly"
        @change="onChange"
      />
    </div>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorBooleanField } from '../types'

  const props = defineProps<{
    field: InspectorBooleanField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: boolean]
  }>()

  const checked = computed(() => Boolean(props.value))

  function onChange(e: Event) {
    const target = e.target as HTMLInputElement
    emit('commit', target.checked)
  }
</script>

<style scoped src="./BooleanRenderer.styles.css"></style>
