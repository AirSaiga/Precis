<!--
  @file ConflictSidebar.vue
  @description 冲突解决侧边栏组件

  功能概述:
  - 提供搜索框、状态过滤下拉、批量操作按钮
  - 按 Schema / Constraint / RegexNode 分类展示冲突项列表
  - 显示每个冲突项的当前解决策略标签

  Props:
    - schemas: ConfigItemDiff<unknown>[]       过滤后的 Schema 列表
    - constraints: ConfigItemDiff<unknown>[]   过滤后的 Constraint 列表
    - regexNodes: ConfigItemDiff<unknown>[]    过滤后的 RegexNode 列表
    - resolutions: Record<string, string>      解决策略映射
    - searchText: string                       搜索文本（v-model）
    - statusFilter: 'all' | 'added' | 'modified'  状态过滤值（v-model）
    - selectedId: string | null                当前选中项 ID
    - selectedType: 'schema' | 'constraint' | 'regex' | null  当前选中项类型
    - totalCount: number                       冲突项总数
    - addedCount: number                       新增项数
    - modifiedCount: number                    修改项数

  Emits:
    - select-item: [item, type]                用户点击冲突项
    - update:searchText: [string]              搜索文本变更
    - update:statusFilter: [string]            过滤状态变更
    - apply-batch: [BatchMode]                 批量操作策略
-->
<template>
  <div class="sidebar">
    <div class="sidebar-tools">
      <div class="search-box">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" />
          <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <input
          :value="searchText"
          @input="$emit('update:searchText', ($event.target as HTMLInputElement).value)"
          class="search-input"
          type="text"
          :placeholder="t('aiConfigGenerator.conflict.filters.searchPlaceholder')"
        />
      </div>
      <div class="filter-row">
        <select
          :value="statusFilter"
          @change="$emit('update:statusFilter', ($event.target as HTMLSelectElement).value)"
          class="filter-select"
        >
          <option value="all">
            {{ t('aiConfigGenerator.conflict.filters.all') }} ({{ totalCount }})
          </option>
          <option value="added">
            {{ t('aiConfigGenerator.conflict.filters.added') }} ({{ addedCount }})
          </option>
          <option value="modified">
            {{ t('aiConfigGenerator.conflict.filters.modified') }} ({{ modifiedCount }})
          </option>
        </select>
      </div>
      <div class="batch-actions">
        <button
          type="button"
          class="btn-batch active"
          @click="$emit('apply-batch', 'safeDefault')"
          :title="t('aiConfigGenerator.conflict.batch.safeDefault')"
        >
          <span class="batch-icon">⚡</span>
          {{ t('aiConfigGenerator.conflict.batch.safeDefault') }}
        </button>
        <button
          type="button"
          class="btn-batch"
          @click="$emit('apply-batch', 'keepAll')"
          :title="t('aiConfigGenerator.conflict.batch.keepAll')"
        >
          <span class="batch-icon">📄</span>
          {{ t('aiConfigGenerator.conflict.batch.keepAll') }}
        </button>
        <button
          type="button"
          class="btn-batch"
          @click="$emit('apply-batch', 'useAll')"
          :title="t('aiConfigGenerator.conflict.batch.useAll')"
        >
          <span class="batch-icon">✨</span>
          {{ t('aiConfigGenerator.conflict.batch.useAll') }}
        </button>
        <button
          type="button"
          class="btn-batch"
          @click="$emit('apply-batch', 'useAddedOnly')"
          :title="t('aiConfigGenerator.conflict.batch.useAddedOnly')"
        >
          <span class="batch-icon">➕</span>
          {{ t('aiConfigGenerator.conflict.batch.useAddedOnly') }}
        </button>
      </div>
    </div>

    <div class="sidebar-sections">
      <div v-if="schemas.length" class="sidebar-section">
        <div class="section-header">
          <h4>{{ t('aiConfigGenerator.conflict.sections.schemas', { count: schemas.length }) }}</h4>
        </div>
        <div class="item-list">
          <div
            v-for="item in schemas"
            :key="item.id"
            class="list-item"
            :class="{
              active: selectedId === item.id && selectedType === 'schema',
              [item.type]: true,
            }"
            @click="$emit('select-item', item, 'schema')"
          >
            <span class="item-status" :class="item.type">{{ getStatusIcon(item.type) }}</span>
            <span class="item-name">{{ item.name || item.id }}</span>
            <span class="item-action" :class="resolutions[item.id]">
              {{ getResolutionLabel(resolutions[item.id]) }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="constraints.length" class="sidebar-section">
        <div class="section-header">
          <h4>
            {{
              t('aiConfigGenerator.conflict.sections.constraints', { count: constraints.length })
            }}
          </h4>
        </div>
        <div class="item-list">
          <div
            v-for="item in constraints"
            :key="item.id"
            class="list-item"
            :class="{
              active: selectedId === item.id && selectedType === 'constraint',
              [item.type]: true,
            }"
            @click="$emit('select-item', item, 'constraint')"
          >
            <span class="item-status" :class="item.type">{{ getStatusIcon(item.type) }}</span>
            <span class="item-name">{{ item.name || item.id }}</span>
            <span class="item-action" :class="resolutions[item.id]">
              {{ getResolutionLabel(resolutions[item.id]) }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="regexNodes.length" class="sidebar-section">
        <div class="section-header">
          <h4>
            {{ t('aiConfigGenerator.conflict.sections.regexNodes', { count: regexNodes.length }) }}
          </h4>
        </div>
        <div class="item-list">
          <div
            v-for="item in regexNodes"
            :key="item.id"
            class="list-item"
            :class="{
              active: selectedId === item.id && selectedType === 'regex',
              [item.type]: true,
            }"
            @click="$emit('select-item', item, 'regex')"
          >
            <span class="item-status" :class="item.type">{{ getStatusIcon(item.type) }}</span>
            <span class="item-name">{{ item.name || item.id }}</span>
            <span class="item-action" :class="resolutions[item.id]">
              {{ getResolutionLabel(resolutions[item.id]) }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="!totalCount" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke="currentColor"
            stroke-width="2"
            stroke-dasharray="4 4"
          />
          <path
            d="M16 24L22 30L32 18"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <p>{{ t('aiConfigGenerator.conflict.emptySelection') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import type { ConfigItemDiff } from '@/api/types/conflict'
  import type { BatchMode } from '@/composables/conflict/useConflictResolution'
  interface Props {
    schemas: ConfigItemDiff<unknown>[]
    constraints: ConfigItemDiff<unknown>[]
    regexNodes: ConfigItemDiff<unknown>[]
    resolutions: Record<string, string>
    searchText: string
    statusFilter: 'all' | 'added' | 'modified'
    selectedId: string | null
    selectedType: 'schema' | 'constraint' | 'regex' | null
    totalCount: number
    addedCount: number
    modifiedCount: number
  }

  defineProps<Props>()

  defineEmits<{
    'select-item': [item: ConfigItemDiff<unknown>, type: 'schema' | 'constraint' | 'regex']
    'update:searchText': [value: string]
    'update:statusFilter': [value: string]
    'apply-batch': [mode: BatchMode]
  }>()

  const { t } = useI18n()

  const getStatusIcon = (type: string) => {
    switch (type) {
      case 'added':
        return '+'
      case 'modified':
        return '~'
      default:
        return '•'
    }
  }

  const getResolutionLabel = (res: string | undefined) => {
    if (res === 'original') return t('aiConfigGenerator.conflict.labels.original')
    if (res === 'generated') return t('aiConfigGenerator.conflict.labels.generated')
    if (res === 'mixed') return '部分应用'
    return '-'
  }
</script>

<style scoped src="./ConflictSidebar.styles.css"></style>
