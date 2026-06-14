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

  const props = defineProps<{
    field: InspectorExpressionField
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

  const validationError = ref('')
  let validateTimer: ReturnType<typeof setTimeout> | null = null

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
    if (validateTimer) clearTimeout(validateTimer)
    validateTimer = setTimeout(() => {
      validationError.value = validateExpression(v)
    }, 300)
    validationError.value = ''
    emit('commit', v)
  }
</script>

<style scoped src="./TextRenderer.styles.css"></style>
