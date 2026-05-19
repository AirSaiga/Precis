<!--
  @file WeightedSumRenderer.vue
  @description 权重列表编辑器 + 预设弹窗（用于 WeightedSum）
-->
<template>
  <div class="field">
    <label class="label">{{ label }}</label>

    <div class="weights-editor">
      <div class="weights-list">
        <div v-for="(weight, index) in weightsList" :key="index" class="weight-item">
          <span class="weight-index">{{ index + 1 }}</span>
          <input
            type="number"
            class="weight-input"
            :value="weight"
            :disabled="readonly"
            placeholder="权重值"
            @input="onWeightInput(index, ($event.target as HTMLInputElement).value)"
          />
          <button class="weight-remove" type="button" @click="removeWeight(index)" title="删除此权重">×</button>
        </div>
      </div>
      <div class="weights-actions">
        <button class="btn-add-weight" type="button" @click="addWeight">+ 添加权重</button>
        <button class="btn-add-preset" type="button" @click="showPresetModal = true">使用预设</button>
      </div>
    </div>

    <div v-if="help" class="help">{{ help }}</div>

    <!-- 预设权重选择弹窗 -->
    <div v-if="showPresetModal" class="preset-modal-overlay" @click="showPresetModal = false">
      <div class="preset-modal" @click.stop>
        <div class="preset-header">
          <h3>{{ t('inspector.transformNode.params.weightedSum.presetTitle') }}</h3>
          <button class="close-btn" type="button" @click="showPresetModal = false">×</button>
        </div>
        <div class="preset-list">
          <div
            v-for="preset in weightPresets"
            :key="preset.name"
            class="preset-item"
            @click="applyPreset(preset)"
          >
            <div class="preset-name">{{ preset.name }}</div>
            <div class="preset-desc">{{ preset.description }}</div>
            <div class="preview">{{ preset.weights.join(', ') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectorContext } from '../utils'
  import type { InspectorWeightedSumField } from '../types'

  const { t } = useI18n()

  const props = defineProps<{
    field: InspectorWeightedSumField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: unknown]
  }>()

  const showPresetModal = ref(false)

  const weightPresets = [
    {
      name: t('inspector.transformNode.params.weightedSum.presetIdCard'),
      description: t('inspector.transformNode.params.weightedSum.presetIdCardDesc'),
      weights: [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2],
    },
    {
      name: t('inspector.transformNode.params.weightedSum.presetEqual'),
      description: t('inspector.transformNode.params.weightedSum.presetEqualDesc'),
      weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    {
      name: t('inspector.transformNode.params.weightedSum.presetDescending'),
      description: t('inspector.transformNode.params.weightedSum.presetDescendingDesc'),
      weights: [5, 4, 3, 2, 1],
    },
    {
      name: t('inspector.transformNode.params.weightedSum.presetAscending'),
      description: t('inspector.transformNode.params.weightedSum.presetAscendingDesc'),
      weights: [1, 2, 3, 4, 5, 6, 7, 8],
    },
  ]

  const weightsList = ref<number[]>([])

  // 同步外部数据
  watch(
    () => props.value,
    (v) => {
      weightsList.value = Array.isArray(v) ? [...v] : [0]
    },
    { immediate: true, deep: true }
  )

  function emitWeights(weights: number[]) {
    emit('commit', weights)
  }

  function onWeightInput(index: number, value: string) {
    const numValue = parseFloat(value)
    weightsList.value[index] = isNaN(numValue) ? 0 : numValue
    emitWeights([...weightsList.value])
  }

  function addWeight() {
    weightsList.value.push(0)
    emitWeights([...weightsList.value])
  }

  function removeWeight(index: number) {
    if (weightsList.value.length > 1) {
      weightsList.value.splice(index, 1)
      emitWeights([...weightsList.value])
    } else {
      window.$toast?.warning?.('', t('inspector.transformNode.params.weightedSum.minWeightHint'))
    }
  }

  function applyPreset(preset: { name: string; weights: number[] }) {
    weightsList.value = [...preset.weights]
    emitWeights([...preset.weights])
    showPresetModal.value = false
    window.$toast?.success?.('', `${t('inspector.transformNode.params.weightedSum.presetApplied')}：${preset.name}`)
  }
</script>

<style scoped>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label {
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .weights-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .weights-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 300px;
    overflow-y: auto;
    padding: 4px;
  }

  .weight-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 6px;
    padding: 6px 8px;
    transition: all 0.15s ease;
  }

  .weight-item:hover {
    border-color: var(--ui-accent);
  }

  .weight-index {
    font-size: 11px;
    color: var(--ui-text-muted);
    min-width: 24px;
    text-align: center;
    font-weight: 500;
  }

  .weight-input {
    flex: 1;
    background: var(--ui-bg-nav-primary);
    border: 1px solid var(--ui-border-light);
    border-radius: 4px;
    padding: 4px 8px;
    color: var(--ui-text-primary);
    font-size: 13px;
    outline: none;
    transition: all 0.15s ease;
  }

  .weight-input:focus {
    border-color: var(--ui-accent);
  }

  .weight-remove {
    background: transparent;
    border: none;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 18px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s ease;
    padding: 0;
  }

  .weight-remove:hover {
    background: var(--ui-danger-bg, rgba(244, 67, 54, 0.1));
    color: var(--ui-danger, #f44336);
  }

  .weights-actions {
    display: flex;
    gap: 8px;
  }

  .btn-add-weight,
  .btn-add-preset {
    flex: 1;
    background: var(--ui-bg-elevated);
    border: 1px dashed var(--ui-border-light);
    color: var(--ui-text-secondary);
    cursor: pointer;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .btn-add-weight:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
    background: var(--ui-accent-bg, rgba(0, 122, 204, 0.1));
  }

  .btn-add-preset:hover {
    border-color: var(--ui-success, #4caf50);
    color: var(--ui-success, #4caf50);
    background: var(--ui-success-bg, rgba(76, 175, 80, 0.1));
  }

  .help {
    font-size: 11px;
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  /* 预设弹窗 */
  .preset-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .preset-modal {
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-light);
    border-radius: 12px;
    width: 500px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .preset-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--ui-border-subtle);
  }

  .preset-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--ui-text-primary);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 24px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.15s ease;
    padding: 0;
  }

  .close-btn:hover {
    background: var(--ui-bg-hover);
    color: var(--ui-text-primary);
  }

  .preset-list {
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .preset-item {
    background: var(--ui-bg-nav-primary);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 8px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .preset-item:hover {
    border-color: var(--ui-accent);
    background: var(--ui-bg-hover);
  }

  .preset-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-text-primary);
    margin-bottom: 4px;
  }

  .preset-desc {
    font-size: 12px;
    color: var(--ui-text-secondary);
    margin-bottom: 8px;
  }

  .preview {
    font-size: 11px;
    color: var(--ui-text-muted);
    font-family: 'Consolas', 'Monaco', monospace;
    word-break: break-all;
  }
</style>
