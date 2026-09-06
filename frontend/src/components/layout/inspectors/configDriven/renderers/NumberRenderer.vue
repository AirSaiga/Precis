<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
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

  interface Props {
    field: InspectorNumberField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    readonly: boolean
  }

  const props = defineProps<Props>()

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
      emit('commit', props.field.emptyToNull ? (null as unknown as number | undefined) : undefined)
      return
    }
    const n = Number(trimmed)
    emit('commit', Number.isFinite(n) ? n : undefined)
  }
</script>

<style scoped src="./NumberRenderer.styles.css"></style>
