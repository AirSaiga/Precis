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
  @file JsonRenderer.vue
  @description JSON 只读字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <pre class="pre">{{ formatted }}</pre>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorJsonField } from '../types'

  interface Props {
    field: InspectorJsonField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }

  const props = defineProps<Props>()

  const formatted = computed(() => {
    if (props.value === undefined) return ''
    try {
      return JSON.stringify(props.value, null, 2)
    } catch {
      return String(props.value)
    }
  })
</script>

<style scoped src="./JsonRenderer.styles.css"></style>
