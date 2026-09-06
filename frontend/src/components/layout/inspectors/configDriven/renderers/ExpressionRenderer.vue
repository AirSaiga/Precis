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
  @file ExpressionRenderer.vue
  @description 数学表达式字段渲染器 — 带实时语法校验
-->
<template>
  <div class="field">
    <InspectorField
      :label="label"
      :modelValue="display"
      :editable="!readonly"
      type="text"
      :placeholder="placeholder"
      :error="validationError"
      @update:modelValue="(v) => onInput(v)"
    />
    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import InspectorField from '@/components/ui/inspector/InspectorField.vue'
  import type { InspectorContext } from '../utils'
  import type { InspectorExpressionField } from '../types'

  const { t } = useI18n()

  interface Props {
    field: InspectorExpressionField
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

  const validationError = ref('')

  const display = computed(() => {
    if (props.value == null) return ''
    return String(props.value)
  })

  function validateExpression(expr: string): string {
    if (!expr.trim()) return ''
    const validPattern = /^[@\w\s+\-*/().%\[\]]+$/
    if (!validPattern.test(expr)) {
      return t('inspector.transformNode.params.mathExpr.invalidChars')
    }
    let depth = 0
    for (const ch of expr) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (depth < 0) return t('inspector.transformNode.params.mathExpr.unmatchedClose')
    }
    if (depth !== 0) return t('inspector.transformNode.params.mathExpr.unmatchedOpen')
    return ''
  }

  function onInput(v: string) {
    // 同步校验：无效表达式不提交，避免错误数据存入节点（R3 修复）
    const error = validateExpression(v)
    validationError.value = error
    if (!error) {
      emit('commit', v)
    }
  }
</script>

<style scoped src="./TextRenderer.styles.css"></style>
