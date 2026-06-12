<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface ScopeItem {
    type: 'full_project' | 'single_table' | 'single_file'
    label: string
    description: string
    status: 'active' | 'available' | 'planned'
  }

  defineProps<{
    items: ScopeItem[]
    currentTableId?: string
    tableOptions: Array<{ value: string; label: string; sourceType?: string }>
  }>()

  const emit = defineEmits<{
    (e: 'selectType', type: 'full_project' | 'single_table' | 'single_file'): void
    (e: 'selectTable', tableId: string): void
  }>()

  const { t } = useI18n()

  const formatTableOptionLabel = (item: { label: string; sourceType?: string }) => {
    const typeLabel =
      item.sourceType && item.sourceType !== 'unknown'
        ? t(`common.fullValidation.task.scope.sourceTypes.${item.sourceType}`)
        : ''
    return typeLabel ? `[${typeLabel}] ${item.label}` : item.label
  }
</script>

<template>
  <div class="scope-selector">
    <div class="scope-label">{{ t('common.fullValidation.task.scope.title') }}</div>
    <div class="scope-options">
      <button
        v-for="item in items"
        :key="item.type"
        class="scope-option"
        :class="{
          'is-active': item.status === 'active',
          'is-planned': item.status === 'planned',
        }"
        type="button"
        :disabled="item.status === 'planned'"
        @click="emit('selectType', item.type)"
      >
        <div class="scope-option-icon">
          <svg
            v-if="item.type === 'full_project'"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <svg
            v-else-if="item.type === 'single_table'"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <svg
            v-else
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div class="scope-option-content">
          <div class="scope-option-header">
            <span class="scope-option-name">{{ item.label }}</span>
            <span v-if="item.status === 'planned'" class="scope-option-badge">
              {{ t('common.fullValidation.task.scope.planned') }}
            </span>
          </div>
          <p class="scope-option-desc">{{ item.description }}</p>
        </div>
        <div v-if="item.status === 'active'" class="scope-option-check">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </button>
    </div>

    <div v-if="currentTableId" class="table-dropdown">
      <select
        class="ui-select"
        :value="currentTableId"
        @change="emit('selectTable', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in tableOptions" :key="opt.value" :value="opt.value">
          {{ formatTableOptionLabel(opt) }}
        </option>
      </select>
    </div>
  </div>
</template>

<style scoped>
  .scope-selector {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-sm);
  }

  .scope-label {
    font-size: var(--ui-font-size-xs);
    font-weight: var(--ui-font-weight-semibold);
    color: var(--ui-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .scope-options {
    display: flex;
    gap: var(--ui-space-md);
  }

  .scope-option {
    display: flex;
    align-items: flex-start;
    gap: var(--ui-space-sm);
    padding: var(--ui-space-md);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-md);
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .scope-option::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: transparent;
    transition: background 0.15s ease;
  }

  .scope-option:hover:not(.is-planned) {
    background: var(--ui-bg-subtle);
    border-color: var(--ui-border);
  }

  .scope-option.is-active {
    background: var(--ui-bg-subtle);
    border-color: var(--ui-accent);
  }

  .scope-option.is-active::before {
    background: var(--ui-accent-strong);
  }

  .scope-option.is-planned {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .scope-option-icon {
    flex-shrink: 0;
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  .scope-option.is-active .scope-option-icon {
    color: var(--ui-accent-strong);
  }

  .scope-option-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .scope-option-header {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
  }

  .scope-option-name {
    font-size: var(--ui-font-size-sm);
    font-weight: var(--ui-font-weight-semibold);
    color: var(--ui-text-strong);
  }

  .scope-option-badge {
    padding: 1px 6px;
    border-radius: var(--ui-radius-full);
    font-size: var(--ui-font-size-xs);
    color: var(--ui-text-muted);
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-light);
  }

  .scope-option-desc {
    font-size: var(--ui-font-size-xs);
    color: var(--ui-text-muted);
    line-height: 1.4;
    margin: 0;
  }

  .scope-option-check {
    flex-shrink: 0;
    color: var(--ui-accent-strong);
    margin-top: 2px;
  }

  .table-dropdown {
    margin-top: var(--ui-space-sm);
  }

  @media (max-width: 720px) {
    .scope-options {
      flex-direction: column;
    }
  }
</style>
