<!--
  @file ReadonlyRenderer.vue
  @description 只读字段渲染器
-->
<template>
  <div class="field">
    <InspectorField :label="label" :modelValue="display" :editable="false" type="text" />
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import InspectorField from '@/components/ui/inspector/InspectorField.vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorReadonlyField } from '../types'

  const props = defineProps<{
    field: InspectorReadonlyField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const display = computed(() => (props.value == null ? '' : String(props.value)))
</script>

<style scoped src="./ReadonlyRenderer.styles.css"></style>
