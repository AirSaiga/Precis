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
  @file BooleanRenderer.vue
  @description 布尔值字段渲染器
-->
<template>
  <div class="field">
    <div class="row">
      <label class="label">{{ label }}</label>
      <input
        class="toggle"
        type="checkbox"
        :checked="checked"
        :disabled="readonly"
        @change="onChange"
      />
    </div>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorBooleanField } from '../types'

  interface Props {
    field: InspectorBooleanField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    readonly: boolean
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    commit: [value: boolean]
  }>()

  const checked = computed(() => Boolean(props.value))

  function onChange(e: Event) {
    const target = e.target as HTMLInputElement
    emit('commit', target.checked)
  }
</script>

<style scoped src="./BooleanRenderer.styles.css"></style>
