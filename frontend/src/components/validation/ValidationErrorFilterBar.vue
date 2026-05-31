<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  defineProps<{
    stageFilter: 'all' | 'loading' | 'format' | 'constraint'
    groupBy: 'table' | 'stage' | 'type' | 'none'
    searchQuery: string
  }>()

  const emit = defineEmits<{
    (e: 'update:stageFilter', value: 'all' | 'loading' | 'format' | 'constraint'): void
    (e: 'update:groupBy', value: 'table' | 'stage' | 'type' | 'none'): void
    (e: 'update:searchQuery', value: string): void
  }>()

  const { t } = useI18n()

  const stageOptions = [
    { key: 'all' as const, label: t('common.all') },
    { key: 'loading' as const, label: t('common.fullValidation.result.loading') },
    { key: 'format' as const, label: t('common.fullValidation.result.format') },
    { key: 'constraint' as const, label: t('common.fullValidation.result.constraint') },
  ]

  const groupOptions = [
    { key: 'table' as const, label: '按表' },
    { key: 'stage' as const, label: '按阶段' },
    { key: 'type' as const, label: '按类型' },
    { key: 'none' as const, label: '不分组' },
  ]
</script>

<template>
  <div class="fv-filter-bar">
    <div class="fv-filter-group">
      <span class="fv-filter-label">分组:</span>
      <select
        :value="groupBy"
        class="ui-select ui-select--compact"
        @change="emit('update:groupBy', ($event.target as HTMLSelectElement).value as 'table' | 'stage' | 'type' | 'none')"
      >
        <option v-for="opt in groupOptions" :key="opt.key" :value="opt.key">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div class="fv-stage-filter">
      <span class="fv-filter-label">阶段:</span>
      <button
        v-for="opt in stageOptions"
        :key="opt.key"
        class="fv-stage-chip"
        :class="{ 'is-active': stageFilter === opt.key }"
        type="button"
        @click="emit('update:stageFilter', opt.key)"
      >
        {{ opt.label }}
      </button>
    </div>

    <div class="fv-filter-search">
      <input
        :value="searchQuery"
        class="ui-input ui-input--compact"
        type="text"
        placeholder="搜索错误..."
        @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>
</template>
