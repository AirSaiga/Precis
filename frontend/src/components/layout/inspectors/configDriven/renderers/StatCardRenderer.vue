<!--
  @file StatCardRenderer.vue
  @description 统计卡片渲染器，显示多个统计项（从 store 读取）
-->
<template>
  <div class="field stat-card-field">
    <div class="stats-grid">
      <div v-for="item in field.items" :key="item.labelKey" class="stat-item">
        <div class="stat-icon-wrap">
          <span class="stat-icon">{{ item.icon }}</span>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ getStatValue(item.statKey) }}</div>
          <div class="stat-label">{{ t(item.labelKey) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import type { InspectorContext } from '../utils'
  import type { InspectorStatCardField } from '../types'

  const { t } = useI18n()
  const resourceTreeStore = useResourceTreeStore()

  const props = defineProps<{
    field: InspectorStatCardField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const statValues = computed(() => ({
    schemaCount: resourceTreeStore.schemas.length,
    constraintCount:
      resourceTreeStore.independentConstraintsManifestCount +
      resourceTreeStore.embeddedConstraintsManifestCount +
      resourceTreeStore.independentConstraintsUnlistedCount +
      resourceTreeStore.embeddedConstraintsUnlistedCount,
    regexCount: resourceTreeStore.regexNodes.length,
  }))

  function getStatValue(statKey: string): string {
    const val = statValues.value[statKey as keyof typeof statValues.value]
    if (val === undefined || val === null) return '-'
    return String(val)
  }
</script>

<style scoped>
  .stat-card-field {
    padding-top: 2px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 8px;
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 8px;
    background: linear-gradient(135deg, var(--ui-bg) 0%, var(--ui-bg-subtle) 100%);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    min-width: 0;
    overflow: hidden;
  }

  .stat-icon-wrap {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ui-radius-sm);
    flex-shrink: 0;
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
  }

  .stat-icon {
    font-size: 13px;
  }

  .stat-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
  }

  .stat-value {
    font-size: 15px;
    font-weight: 600;
    color: var(--ui-text-strong);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat-label {
    font-size: 10px;
    color: var(--ui-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
