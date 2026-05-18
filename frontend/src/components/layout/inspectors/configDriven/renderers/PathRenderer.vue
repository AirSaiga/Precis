<!--
  @file PathRenderer.vue
  @description 路径字段渲染器
-->
<template>
  <div class="field">
    <InspectorField
      :label="label"
      :modelValue="display"
      :editable="!readonly"
      type="path"
      @update:modelValue="(v) => emit('commit', v)"
    />
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import InspectorField from '@/components/ui/inspector/InspectorField.vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorPathField } from '../types'

  const emit = defineEmits<{
    commit: [value: string]
  }>()

  const props = defineProps<{
    field: InspectorPathField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    readonly: boolean
  }>()

  const display = computed(() => (props.value == null ? '' : String(props.value)))
</script>

<style scoped src="./PathRenderer.styles.css"></style>
