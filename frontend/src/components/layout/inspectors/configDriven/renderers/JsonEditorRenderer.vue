<!--
  @file JsonEditorRenderer.vue
  @description JSON 编辑器字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <textarea
      class="textarea"
      :rows="rows"
      :value="text"
      :disabled="readonly"
      :placeholder="placeholder"
      @input="onInput"
      @blur="onBlur"
    />
    <div v-if="errorText" class="error">{{ errorText }}</div>
    <div v-else-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorJsonEditorField } from '../types'

  const props = defineProps<{
    field: InspectorJsonEditorField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: unknown]
  }>()

  const rows = computed(() => props.field.rows ?? 4)

  function formatValue(value: unknown): string {
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  const text = ref<string>(formatValue(props.value))
  watch(
    () => props.value,
    (next) => {
      text.value = formatValue(next)
    }
  )

  const errorText = ref<string>('')

  function parseInput(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
    const mode = props.field.parse ?? 'auto'
    const trimmed = raw.trim()
    if (mode === 'never') return { ok: true, value: raw }
    if (mode === 'auto') {
      if (!trimmed) return { ok: true, value: '' }
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { ok: true, value: raw }
    }
    try {
      return { ok: true, value: JSON.parse(trimmed) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' }
    }
  }

  function onInput(e: Event) {
    const target = e.target as HTMLTextAreaElement
    text.value = target.value
    errorText.value = ''
  }

  function onBlur() {
    const parsed = parseInput(text.value)
    if (parsed.ok === false) {
      errorText.value = parsed.error
      return
    }
    // validateType 校验
    const validateType = props.field.validateType
    if (validateType && parsed.value !== '' && parsed.value !== undefined) {
      if (
        validateType === 'object' &&
        (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value))
      ) {
        errorText.value = '值必须是 JSON 对象'
        return
      }
      if (validateType === 'array' && !Array.isArray(parsed.value)) {
        errorText.value = '值必须是 JSON 数组'
        return
      }
    }
    errorText.value = ''
    emit('commit', parsed.value)
  }
</script>

<style scoped src="./JsonEditorRenderer.styles.css"></style>
