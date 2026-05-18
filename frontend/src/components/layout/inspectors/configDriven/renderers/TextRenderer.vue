<!--
  @file TextRenderer.vue
  @description 文本字段渲染器
-->
<template>
  <div class="field">
    <InspectorField
      :label="label"
      :modelValue="display"
      :editable="!readonly"
      type="text"
      :placeholder="placeholder"
      @update:modelValue="(v) => emitCommit(v)"
    />
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import InspectorField from '@/components/ui/inspector/InspectorField.vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorTextField } from '../types'

  const props = defineProps<{
    field: InspectorTextField
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

  const display = computed(() => {
    if (props.value == null) return ''
    // 如果是数组，转换为逗号分隔的字符串
    if (Array.isArray(props.value)) {
      return props.value.join(', ')
    }
    return String(props.value)
  })

  function emitCommit(v: string) {
    emit('commit', v)
  }
</script>

<style scoped src="./TextRenderer.styles.css"></style>
