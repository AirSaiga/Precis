<!--
  @file TextareaRenderer.vue
  @description 多行文本字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <textarea
      class="textarea"
      :rows="rows"
      :value="display"
      :disabled="readonly"
      @input="onInput"
    />
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorTextareaField } from '../types'

  const props = defineProps<{
    field: InspectorTextareaField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: string]
  }>()

  const rows = computed(() => props.field.rows ?? 4)
  const display = computed(() => (props.value == null ? '' : String(props.value)))

  function onInput(e: Event) {
    const target = e.target as HTMLTextAreaElement
    emit('commit', target.value)
  }
</script>

<style scoped src="./TextareaRenderer.styles.css"></style>
