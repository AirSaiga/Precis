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

  interface Props {
    field: InspectorTextField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }

  const props = defineProps<Props>()

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
    if (props.field.emptyToNull && v === '') {
      emit('commit', null as unknown as string)
      return
    }
    emit('commit', v)
  }
</script>

<style scoped src="./TextRenderer.styles.css"></style>
