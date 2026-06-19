<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ProjectCard from './ProjectCard.vue'
import { scanProjects, openProject, type ProjectInfo } from '@/api/projectApi'

const emit = defineEmits<{
  projectOpened: [path: string]
}>()

const { t } = useI18n()
const projects = ref<ProjectInfo[]>([])
const loading = ref(true)
const error = ref('')
const manualPath = ref('')
const manualError = ref('')
const manualLoading = ref(false)
const workDir = ref('')

onMounted(async () => {
  try {
    const result = await scanProjects()
    workDir.value = result.work_dir
    projects.value = result.projects
  } catch (e: unknown) {
    error.value = t('common.project.errorScan')
    console.error('Project scan failed:', e)
  } finally {
    loading.value = false
  }
})

async function handleSelect(path: string) {
  try {
    await openProject(path)
    emit('projectOpened', path)
  } catch (e: unknown) {
    manualError.value = t('common.project.invalidPath')
    console.error('Failed to open project:', e)
  }
}

async function handleManualOpen() {
  const path = manualPath.value.trim()
  if (!path) return
  manualLoading.value = true
  manualError.value = ''
  try {
    await openProject(path)
    emit('projectOpened', path)
  } catch (e: unknown) {
    manualError.value = t('common.project.invalidPath')
  } finally {
    manualLoading.value = false
  }
}
</script>

<template>
  <div class="project-selector">
    <div class="project-selector-header">
      <h1>Precis</h1>
      <p class="project-selector-subtitle">{{ t('common.project.selectTitle') }}</p>
      <p v-if="workDir" class="project-selector-workdir">
        {{ workDir }}
      </p>
    </div>

    <div v-if="loading" class="project-selector-loading">
      {{ t('common.project.loading') }}
    </div>

    <div v-else-if="error" class="project-selector-error">
      {{ error }}
    </div>

    <template v-else>
      <div v-if="projects.length === 0" class="project-selector-empty">
        {{ t('common.project.noProjects') }}
      </div>

      <div v-else class="project-selector-grid">
        <ProjectCard
          v-for="project in projects"
          :key="project.path"
          :name="project.name"
          :schema-count="project.schema_count"
          :constraint-count="project.constraint_count"
          :last-modified="project.last_modified"
          :path="project.path"
          @select="handleSelect"
        />
      </div>
    </template>

    <div class="project-selector-manual">
      <div class="project-selector-manual-label">
        {{ t('common.project.openOther') }}
      </div>
      <div class="project-selector-manual-input-row">
        <input
          v-model="manualPath"
          type="text"
          :placeholder="t('common.project.manualPathPlaceholder')"
          class="project-selector-input"
          @keydown.enter="handleManualOpen"
        />
        <button
          class="project-selector-open-btn"
          :disabled="manualLoading || !manualPath.trim()"
          @click="handleManualOpen"
        >
          {{ t('common.project.openButton') }}
        </button>
      </div>
      <div v-if="manualError" class="project-selector-manual-error">
        {{ manualError }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px 20px;
  background: var(--app-bg, #f5f5f5);
}
.project-selector-header {
  text-align: center;
  margin-bottom: 32px;
}
.project-selector-header h1 {
  font-size: 28px;
  margin: 0 0 8px;
}
.project-selector-subtitle {
  color: var(--text-secondary, #666);
  margin: 0 0 4px;
}
.project-selector-workdir {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  font-family: monospace;
  margin: 0;
}
.project-selector-loading,
.project-selector-error,
.project-selector-empty {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}
.project-selector-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  max-width: 800px;
  width: 100%;
  margin-bottom: 40px;
}
.project-selector-manual {
  max-width: 500px;
  width: 100%;
  border-top: 1px solid var(--border-color, #e0e0e0);
  padding-top: 24px;
}
.project-selector-manual-label {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}
.project-selector-manual-input-row {
  display: flex;
  gap: 8px;
}
.project-selector-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 14px;
  background: var(--input-bg, #fff);
  color: var(--text-color, #333);
}
.project-selector-input::placeholder {
  color: var(--text-tertiary, #aaa);
}
.project-selector-open-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  background: var(--accent-color, #4a90d9);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
}
.project-selector-open-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.project-selector-manual-error {
  color: #e74c3c;
  font-size: 12px;
  margin-top: 6px;
}
</style>
