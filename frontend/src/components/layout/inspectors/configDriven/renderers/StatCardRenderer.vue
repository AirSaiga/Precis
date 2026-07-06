<!--
  @file StatCardRenderer.vue
  @description 统计卡片渲染器，显示多个统计项（从 store 读取）
-->
<template>
  <div class="field stat-card-field">
    <div class="stats-grid">
      <div v-for="item in field.items" :key="item.labelKey" class="stat-item">
        <div class="stat-icon-wrap" :class="iconClassFor(item)">
          <span class="stat-icon" v-html="iconSvgFor(item)"></span>
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
  interface StatItem {
    statKey: string
    labelKey: string
  }

  const { t } = useI18n()
  const resourceTreeStore = useResourceTreeStore()

  defineProps<{
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

  const ICONS: Record<string, { svg: string; class: string }> = {
    schemaCount: {
      class: 'stat-icon-blue',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect></svg>',
    },
    constraintCount: {
      class: 'stat-icon-amber',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>',
    },
    regexCount: {
      class: 'stat-icon-purple',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    },
  }

  function iconSvgFor(item: StatItem): string {
    return ICONS[item.statKey]?.svg ?? ''
  }

  function iconClassFor(item: StatItem): string {
    return ICONS[item.statKey]?.class ?? ''
  }
</script>

<style scoped>
  .stat-card-field {
    padding-top: 2px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 10px;
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    background: var(--ui-bg-subtle);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-md);
    min-width: 0;
    overflow: hidden;
    transition:
      background var(--ui-transition-fast),
      border-color var(--ui-transition-fast);
  }

  .stat-item:hover {
    background: var(--ui-bg-muted);
    border-color: var(--ui-border);
  }

  .stat-icon-wrap {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ui-radius-md);
    flex-shrink: 0;
  }

  .stat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .stat-icon :deep(svg) {
    display: block;
  }

  .stat-icon-blue {
    background: var(--ui-bg-accent);
    color: var(--ui-accent);
  }

  .stat-icon-amber {
    background: var(--ui-bg-warning);
    color: var(--ui-warning-strong);
  }

  .stat-icon-purple {
    background: var(--ui-bg-accent);
    color: var(--ui-accent);
  }

  .stat-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
  }

  .stat-value {
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-text-strong);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat-label {
    font-size: 11px;
    color: var(--ui-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
