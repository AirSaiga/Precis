<!--
  @file InspectorField.vue
  @description Inspector 通用字段渲染容器

  功能概述：
  - 支持只读和可编辑两种模式
  - 只读模式显示标签和值，可编辑模式渲染输入框
  - 支持文本、数字和路径类型

  Props：
  - label: string — 字段标签
  - modelValue: string | number — 字段值
  - editable: boolean — 是否可编辑
  - type: 'text' | 'number' | 'path' — 字段类型
  - placeholder: string — 占位提示

  Emits：
  - update:modelValue: [value: string] — 值变更事件
-->
<template>
  <div class="inspector-field" :class="{ 'field-layout-row': !editable, 'field-has-error': !!error }">
    <label v-if="label" class="field-label">{{ label }}</label>

    <!-- 只读模式 -->
    <div
      v-if="!editable"
      class="field-value"
      :class="[`field-type-${type}`, { 'field-placeholder': isPlaceholder }]"
      :title="type === 'path' ? String(modelValue) : undefined"
    >
      <slot name="prefix"></slot>
      <span class="field-text">{{ displayValue }}</span>
      <slot name="suffix"></slot>
    </div>

    <!-- 可编辑模式 -->
    <input
      v-else
      :type="inputType"
      :value="modelValue"
      @input="handleInput"
      :placeholder="placeholder"
      :min="min"
      :max="max"
      :step="step"
      class="field-input"
    />

    <div v-if="error" class="field-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'

  interface Props {
    label?: string
    modelValue?: string | number
    editable?: boolean
    type?: 'text' | 'number' | 'path'
    placeholder?: string
    error?: string
    min?: number
    max?: number
    step?: number
  }

  const props = withDefaults(defineProps<Props>(), {
    label: '',
    modelValue: '',
    editable: false,
    type: 'text',
    placeholder: '',
    error: '',
  })

  const emit = defineEmits<{
    'update:modelValue': [value: string]
  }>()

  const isPlaceholder = computed(() => {
    return !props.modelValue && props.modelValue !== 0
  })

  const displayValue = computed(() => {
    if (props.modelValue === undefined || props.modelValue === null || props.modelValue === '') {
      return '-'
    }
    return String(props.modelValue)
  })

  const inputType = computed(() => {
    return props.type === 'number' ? 'number' : 'text'
  })

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement
    emit('update:modelValue', target.value)
  }
</script>

<style scoped src="./InspectorField.styles.css"></style>
