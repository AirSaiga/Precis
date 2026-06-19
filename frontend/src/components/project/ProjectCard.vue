<script setup lang="ts">
import { useI18n } from 'vue-i18n'

export interface ProjectCardProps {
  name: string
  schemaCount: number
  constraintCount: number
  lastModified: string
  path: string
  disabled?: boolean
}

const props = defineProps<ProjectCardProps>()
const emit = defineEmits<{
  select: [path: string]
}>()

const { t } = useI18n()

function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return t('common.project.today')
    if (diffDays === 1) return t('common.project.yesterday')
    if (diffDays < 7) return t('common.project.daysAgo', { days: diffDays })
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}
</script>

<template>
  <div
    class="project-card"
    :class="{ 'project-card--disabled': disabled }"
    @click="!disabled && emit('select', path)"
    @keydown.enter="!disabled && emit('select', path)"
    :tabindex="disabled ? -1 : 0"
    role="button"
    :aria-label="name"
    :aria-disabled="disabled"
  >
    <div class="project-card-icon">📁</div>
    <div class="project-card-title">{{ name }}</div>
    <div class="project-card-meta">
      <span>{{ props.schemaCount }} {{ t('common.project.schemas') }}</span>
      <span>·</span>
      <span>{{ props.constraintCount }} {{ t('common.project.constraints') }}</span>
    </div>
    <div class="project-card-date">{{ formatDate(lastModified) }}</div>
  </div>
</template>

<style scoped>
.project-card {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
  background: var(--bg-color, #fff);
  outline: none;
}
.project-card:hover,
.project-card:focus-visible {
  border-color: var(--accent-color, #4a90d9);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.project-card--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.project-card--disabled:hover,
.project-card--disabled:focus-visible {
  border-color: var(--border-color, #e0e0e0);
  box-shadow: none;
}
.project-card-icon {
  font-size: 32px;
  margin-bottom: 8px;
}
.project-card-title {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 4px;
  color: var(--text-color, #333);
}
.project-card-meta {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin-bottom: 4px;
}
.project-card-meta span + span {
  margin-left: 4px;
}
.project-card-date {
  font-size: 11px;
  color: var(--text-tertiary, #aaa);
}
</style>
