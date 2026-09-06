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

  interface Props {
    field: InspectorPathField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    readonly: boolean
  }

  const props = defineProps<Props>()

  const display = computed(() => (props.value == null ? '' : String(props.value)))
</script>

<style scoped src="./PathRenderer.styles.css"></style>
