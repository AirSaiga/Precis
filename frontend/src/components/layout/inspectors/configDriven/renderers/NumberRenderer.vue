<!--
  @file NumberRenderer.vue
  @description 数值字段渲染器
-->
<template>
  <div class="field">
    <InspectorField
      :label="label"
      :modelValue="display"
      :editable="!readonly"
      type="number"
      :min="field.min"
      :max="field.max"
      :step="field.step"
      @update:modelValue="(v) => emitCommit(v)"
    />
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import InspectorField from '@/components/ui/inspector/InspectorField.vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorNumberField } from '../types'

  const props = defineProps<{
    field: InspectorNumberField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: number | undefined]
  }>()

  const display = computed(() => {
    if (props.value == null) return ''
    if (typeof props.value === 'number') return props.value
    const n = Number(String(props.value))
    return Number.isFinite(n) ? n : ''
  })

  function emitCommit(v: string) {
    const trimmed = v.trim()
    if (!trimmed) {
      emit('commit', props.field.emptyToNull ? null as unknown as number | undefined : undefined)
      return
    }
    const n = Number(trimmed)
    emit('commit', Number.isFinite(n) ? n : undefined)
  }
</script>

<style scoped src="./NumberRenderer.styles.css"></style>
