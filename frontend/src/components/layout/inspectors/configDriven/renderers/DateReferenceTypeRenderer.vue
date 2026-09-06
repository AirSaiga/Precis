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
  @file DateReferenceTypeRenderer.vue
  @description 日期引用类型字段渲染器
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>
    <select class="select" :value="mode" :disabled="readonly" @change="onChange">
      <option value="date">{{ t(field.optionDateLabelKey) }}</option>
      <option value="column">{{ t(field.optionColumnLabelKey) }}</option>
    </select>
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import { buildShallowCompatiblePatch, getByPath } from '../utils'
  import type { InspectorCommitPayload, InspectorDateReferenceTypeField } from '../types'

  const { t } = useI18n()

  interface Props {
    field: InspectorDateReferenceTypeField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    commit: [payload: InspectorCommitPayload]
  }>()

  const mode = computed<'date' | 'column'>(() => {
    const referenceDate = getByPath(props.ctx.data, props.field.referenceDatePath)
    return referenceDate ? 'date' : 'column'
  })

  function toDateString(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function onChange(e: Event) {
    const target = e.target as HTMLSelectElement
    const next = target.value as 'date' | 'column'

    const patchA = buildShallowCompatiblePatch(
      props.ctx.data,
      { source: 'data', path: props.field.referenceDatePath },
      next === 'date' ? toDateString(new Date()) : undefined
    )
    const patchB = buildShallowCompatiblePatch(
      props.ctx.data,
      { source: 'data', path: props.field.referenceColumnPath },
      next === 'column' ? '' : undefined
    )
    emit('commit', { __patch: { ...patchA, ...patchB } })
  }
</script>

<style scoped src="./DateReferenceTypeRenderer.styles.css"></style>
