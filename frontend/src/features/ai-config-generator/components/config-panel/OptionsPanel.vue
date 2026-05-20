<!--
  @file AIConfigOptionsPanel.vue
  @description AI 配置生成模态框中的生成选项面板子组件

  功能职责：
  - 展示 4 个生成选项卡片（Schema / Constraint / Regex / KeepExisting）
  - 提供高级选项折叠面板（采样行数、采样值数、最大文件数、最大单元格字符数）
  - 支持重置为默认值

  Props:
    - options: AiGenerateV2ConfigOptions  当前选项值
    - advancedVisible: boolean            高级选项是否展开

  Emits:
    - update:options: [options: AiGenerateV2ConfigOptions] 选项变更
    - update:advancedVisible: [visible: boolean]             高级面板显隐变更
    - reset-defaults:  重置为默认值
-->
<template>
  <div class="options-grid">
    <label class="option-card" :class="{ active: options.generate_schemas }">
      <div class="checkbox-wrapper">
        <input
          type="checkbox"
          :checked="options.generate_schemas"
          @change="toggleOption('generate_schemas')"
        />
      </div>
      <div class="option-content">
        <span class="option-label">{{ t('aiConfigGenerator.options.generateSchemas') }}</span>
        <span class="option-desc">{{ t('aiConfigGenerator.options.descGenerateSchemas') }}</span>
      </div>
    </label>

    <label class="option-card" :class="{ active: options.generate_constraints }">
      <div class="checkbox-wrapper">
        <input
          type="checkbox"
          :checked="options.generate_constraints"
          @change="toggleOption('generate_constraints')"
        />
      </div>
      <div class="option-content">
        <span class="option-label">{{ t('aiConfigGenerator.options.generateConstraints') }}</span>
        <span class="option-desc">{{
          t('aiConfigGenerator.options.descGenerateConstraints')
        }}</span>
      </div>
    </label>

    <label class="option-card" :class="{ active: options.generate_regex_nodes }">
      <div class="checkbox-wrapper">
        <input
          type="checkbox"
          :checked="options.generate_regex_nodes"
          @change="toggleOption('generate_regex_nodes')"
        />
      </div>
      <div class="option-content">
        <span class="option-label">{{ t('aiConfigGenerator.options.generateRegexNodes') }}</span>
        <span class="option-desc">{{ t('aiConfigGenerator.options.descGenerateRegexNodes') }}</span>
      </div>
    </label>

    <label class="option-card" :class="{ active: options.keep_existing }">
      <div class="checkbox-wrapper">
        <input
          type="checkbox"
          :checked="options.keep_existing"
          @change="toggleOption('keep_existing')"
        />
      </div>
      <div class="option-content">
        <span class="option-label">{{ t('aiConfigGenerator.options.keepExisting') }}</span>
        <span class="option-desc">{{ t('aiConfigGenerator.options.descKeepExisting') }}</span>
      </div>
    </label>
  </div>

  <!-- 高级选项 -->
  <div class="advanced-options">
    <button
      class="advanced-toggle"
      type="button"
      @click="emit('update:advancedVisible', !advancedVisible)"
    >
      <span class="toggle-icon" :class="{ expanded: advancedVisible }">▶</span>
      <span>{{ t('aiConfigGenerator.advancedOptions.title') }}</span>
    </button>
    <div v-show="advancedVisible" class="advanced-panel">
      <div class="param-row">
        <label class="param-label">
          <span>{{ t('aiConfigGenerator.advancedOptions.sampleRows') }}</span>
          <span class="param-range"
            >({{ SAMPLING_PARAM_RANGES.sample_rows.min }} ~
            {{ SAMPLING_PARAM_RANGES.sample_rows.max }})</span
          >
        </label>
        <input
          :value="options.sample_rows"
          type="number"
          :min="SAMPLING_PARAM_RANGES.sample_rows.min"
          :max="SAMPLING_PARAM_RANGES.sample_rows.max"
          class="param-input"
          @input="updateNumberOption('sample_rows', $event)"
          @blur="
            emit('update:options', {
              ...options,
              sample_rows: clampSamplingParam(
                options.sample_rows,
                SAMPLING_PARAM_RANGES.sample_rows
              ),
            })
          "
        />
      </div>
      <div class="param-row">
        <label class="param-label">
          <span>{{ t('aiConfigGenerator.advancedOptions.sampleValues') }}</span>
          <span class="param-range"
            >({{ SAMPLING_PARAM_RANGES.sample_values_per_column.min }} ~
            {{ SAMPLING_PARAM_RANGES.sample_values_per_column.max }})</span
          >
        </label>
        <input
          :value="options.sample_values_per_column"
          type="number"
          :min="SAMPLING_PARAM_RANGES.sample_values_per_column.min"
          :max="SAMPLING_PARAM_RANGES.sample_values_per_column.max"
          class="param-input"
          @input="updateNumberOption('sample_values_per_column', $event)"
          @blur="
            emit('update:options', {
              ...options,
              sample_values_per_column: clampSamplingParam(
                options.sample_values_per_column,
                SAMPLING_PARAM_RANGES.sample_values_per_column
              ),
            })
          "
        />
      </div>
      <div class="param-row">
        <label class="param-label">
          <span>{{ t('aiConfigGenerator.advancedOptions.maxFiles') }}</span>
          <span class="param-range"
            >({{ SAMPLING_PARAM_RANGES.max_files.min }} ~
            {{ SAMPLING_PARAM_RANGES.max_files.max }})</span
          >
        </label>
        <input
          :value="options.max_files"
          type="number"
          :min="SAMPLING_PARAM_RANGES.max_files.min"
          :max="SAMPLING_PARAM_RANGES.max_files.max"
          class="param-input"
          @input="updateNumberOption('max_files', $event)"
          @blur="
            emit('update:options', {
              ...options,
              max_files: clampSamplingParam(options.max_files, SAMPLING_PARAM_RANGES.max_files),
            })
          "
        />
      </div>
      <div class="param-row">
        <label class="param-label">
          <span>{{ t('aiConfigGenerator.advancedOptions.maxCellChars') }}</span>
          <span class="param-range"
            >({{ SAMPLING_PARAM_RANGES.max_cell_chars.min }} ~
            {{ SAMPLING_PARAM_RANGES.max_cell_chars.max }})</span
          >
        </label>
        <input
          :value="options.max_cell_chars"
          type="number"
          :min="SAMPLING_PARAM_RANGES.max_cell_chars.min"
          :max="SAMPLING_PARAM_RANGES.max_cell_chars.max"
          class="param-input"
          @input="updateNumberOption('max_cell_chars', $event)"
          @blur="
            emit('update:options', {
              ...options,
              max_cell_chars: clampSamplingParam(
                options.max_cell_chars,
                SAMPLING_PARAM_RANGES.max_cell_chars
              ),
            })
          "
        />
      </div>
      <button class="btn-text reset-btn" type="button" @click="emit('reset-defaults')">
        {{ t('aiConfigGenerator.advancedOptions.resetDefaults') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import type { AiGenerateV2ConfigOptions } from '@/types/ai'
  import { SAMPLING_PARAM_RANGES, clampSamplingParam } from '../../services/generationOptions'

  const props = defineProps<{
    options: AiGenerateV2ConfigOptions
    advancedVisible: boolean
  }>()

  const emit = defineEmits<{
    'update:options': [options: AiGenerateV2ConfigOptions]
    'update:advancedVisible': [visible: boolean]
    'reset-defaults': []
  }>()

  const { t } = useI18n()

  const toggleOption = (key: keyof AiGenerateV2ConfigOptions) => {
    const current = props.options[key]
    if (typeof current === 'boolean') {
      emit('update:options', { ...props.options, [key]: !current })
    }
  }

  const updateNumberOption = (key: keyof AiGenerateV2ConfigOptions, event: Event) => {
    const target = event.target as HTMLInputElement
    const value = Number(target.value)
    emit('update:options', { ...props.options, [key]: value })
  }
</script>

<style scoped src="./OptionsPanel.styles.css"></style>
