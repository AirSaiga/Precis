<!--
  @file SelectRenderer.vue
  @description 下拉选择字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <select class="select" :value="encodedValue" :disabled="readonly" @change="onChange">
      <option v-if="placeholder" value="__placeholder__" disabled>{{ placeholder }}</option>
      <option v-for="opt in resolvedOptions" :key="opt.key" :value="opt.key">
        {{ opt.label }}
      </option>
    </select>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import { getByPath } from '../utils'
  import type { InspectorSelectField } from '../types'

  type ResolvedOption = { key: string; value: unknown; label: string }

  const { t } = useI18n()

  const props = defineProps<{
    field: InspectorSelectField
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

  function encodeKey(value: unknown): string {
    if (typeof value === 'string') return `s:${value}`
    try {
      return `j:${JSON.stringify(value)}`
    } catch {
      return `s:${String(value)}`
    }
  }

  function decodeKey(key: string): unknown {
    if (key.startsWith('s:')) return key.slice(2)
    if (!key.startsWith('j:')) return key
    try {
      return JSON.parse(key.slice(2))
    } catch {
      return key
    }
  }

  const resolvedOptions = computed<ResolvedOption[]>(() => {
    const opt = props.field.options
    if (opt.type === 'static') {
      return opt.options.map((o) => ({
        key: encodeKey(o.value),
        value: o.value,
        label: t(o.labelKey),
      }))
    }
    const raw = getByPath(props.ctx.data, opt.path)
    if (!Array.isArray(raw)) return []
    return raw.map((item, idx) => {
      const labelVal = opt.labelPath ? getByPath(item, opt.labelPath) : item
      const valueVal = opt.valuePath ? getByPath(item, opt.valuePath) : item
      const labelStr = labelVal == null ? String(valueVal ?? '-') : String(labelVal)
      return { key: encodeKey(valueVal), value: valueVal, label: labelStr || String(idx) }
    })
  })

  const encodedValue = computed(() => {
    if (props.value === undefined || props.value === null) {
      return props.placeholder ? '__placeholder__' : ''
    }
    return encodeKey(props.value)
  })

  function onChange(e: Event) {
    const target = e.target as HTMLSelectElement
    const key = target.value
    if (key === '__placeholder__') return
    emit('commit', decodeKey(key))
  }
</script>

<style scoped src="./SelectRenderer.styles.css"></style>
