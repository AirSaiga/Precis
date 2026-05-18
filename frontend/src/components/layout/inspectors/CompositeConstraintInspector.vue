<template>
  <div class="composite-inspector">
    <div class="inspector-section">
      <label>{{ t('compositeConstraint.configName') }}</label>
      <input v-model="localData.configName" type="text" @change="emitUpdate" />
    </div>

    <div class="inspector-section">
      <label>{{ t('compositeConstraint.description') }}</label>
      <textarea v-model="localData.description" rows="2" @change="emitUpdate" />
    </div>

    <div class="inspector-section">
      <label>{{ t('compositeConstraint.logic') }}</label>
      <select v-model="localData.logic" @change="emitUpdate">
        <option value="all">{{ t('compositeConstraint.logic.all') }}</option>
        <option value="any">{{ t('compositeConstraint.logic.any') }}</option>
        <option value="none">{{ t('compositeConstraint.logic.none') }}</option>
      </select>
    </div>

    <div class="inspector-section">
      <label>{{ t('compositeConstraint.enabled') }}</label>
      <input v-model="localData.enabled" type="checkbox" @change="emitUpdate" />
    </div>

    <div class="inspector-section">
      <button class="open-subcanvas-btn" @click="openSubCanvas">
        {{ t('compositeConstraint.openSubCanvas', { count: subConstraintCount }) }}
      </button>
    </div>

    <div class="inspector-section">
      <label>{{ t('compositeConstraint.saveState') }}</label>
      <span class="save-state">{{ localData.saveState || 'draft' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { reactive, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { CompositeConstraintNodeData } from '@/types/constraints'

  const { t } = useI18n()

  interface Props {
    data: CompositeConstraintNodeData
    nodeId: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:data': [data: Partial<CompositeConstraintNodeData>]
    'open:subCanvas': [nodeId: string]
  }>()

  const localData = reactive({
    configName: props.data.configName || '',
    description: props.data.description || '',
    logic: props.data.logic || 'all',
    enabled: props.data.enabled !== false,
    saveState: props.data.saveState || 'draft',
  })

  const subConstraintCount = computed(() => {
    return props.data.subGraph?.nodes?.length || 0
  })

  function emitUpdate() {
    emit('update:data', {
      configName: localData.configName,
      description: localData.description,
      logic: localData.logic,
    })
  }

  function openSubCanvas() {
    emit('open:subCanvas', props.nodeId)
  }
</script>

<style scoped>
  .composite-inspector {
    padding: 12px;
  }

  .inspector-section {
    margin-bottom: 16px;
  }

  .inspector-section label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-secondary);
    margin-bottom: 6px;
  }

  .inspector-section input[type='text'],
  .inspector-section textarea,
  .inspector-section select {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 13px;
  }

  .inspector-section input[type='checkbox'] {
    width: auto;
    margin-top: 4px;
  }

  .open-subcanvas-btn {
    width: 100%;
    padding: 10px;
    background: var(--ui-accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .open-subcanvas-btn:hover {
    background: var(--ui-accent-primary);
  }

  .save-state {
    font-size: 12px;
    color: var(--ui-text-muted);
    text-transform: uppercase;
  }
</style>
