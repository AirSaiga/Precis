<!--
  @file DateRenderer.vue
  @description 日期字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <input class="input" type="date" :value="display" :disabled="readonly" @input="onInput" />
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorDateField } from '../types'

  const props = defineProps<{
    field: InspectorDateField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: string]
  }>()

  const display = computed(() => (props.value == null ? '' : String(props.value)))

  function onInput(e: Event) {
    const target = e.target as HTMLInputElement
    emit('commit', target.value)
  }
</script>

<style scoped src="./DateRenderer.styles.css"></style>
