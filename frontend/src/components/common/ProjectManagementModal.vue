<!--
  @file ProjectManagementModal.vue
  @description 项目管理模态框（新建 / 打开 / 最近项目）

  功能职责：
  - 提供新建项目的表单（项目名称、项目路径选择）
  - 支持浏览文件夹选择项目目录
  - 提供打开已有项目的入口
  - 展示最近打开的项目列表，支持快速切换与删除历史记录
  - 创建或打开成功后自动关闭模态框

  关键特性：
  - 分区域布局：新建项目、打开现有项目、最近项目列表
  - 表单校验（项目名称与路径必填）
  - 最近项目卡片展示项目名称与路径，点击即可打开
  - 删除按钮移除单条最近项目记录（带确认提示）
  - 与 Project Store 联动，实时反映当前项目激活状态

  Props:
    - modelValue: boolean  控制模态框显示/隐藏（支持 v-model）

  Emits:
    - update:modelValue: 模态框显隐状态变更时触发
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="project-management-overlay" @click.self="handleCloseModal">
        <div class="project-management-modal" role="dialog" aria-modal="true">
          <div class="ui-panel__header project-management-header">
            <h3 class="ui-panel__title">{{ t('projectManagement.title') }}</h3>
            <button
              class="project-management-close ui-icon-btn"
              type="button"
              @click="handleCloseModal"
            >
              ×
            </button>
          </div>

          <div class="project-management-content">
            <div class="project-management-section">
              <div class="section-title ui-section-title">
                {{ t('projectManagement.createNew') }}
              </div>
              <div class="create-form">
                <div class="form-group ui-form-group">
                  <label class="form-label ui-form-label">{{
                    t('projectManagement.projectName')
                  }}</label>
                  <input
                    v-model="newProjectForm.name"
                    class="form-input ui-input"
                    type="text"
                    :placeholder="t('projectManagement.projectNamePlaceholder')"
                  />
                </div>
                <div class="form-group ui-form-group">
                  <label class="form-label ui-form-label">{{
                    t('projectManagement.projectPath')
                  }}</label>
                  <div class="path-input-group">
                    <input
                      v-model="newProjectForm.path"
                      class="form-input ui-input"
                      type="text"
                      :placeholder="t('projectManagement.projectPathPlaceholder')"
                      readonly
                    />
                    <button
                      class="ui-btn ui-btn--secondary"
                      type="button"
                      @click="handleSelectDirectory"
                    >
                      {{ t('projectManagement.browse') }}
                    </button>
                  </div>
                </div>
                <button
                  class="ui-btn ui-btn--primary"
                  type="button"
                  :disabled="!canCreateProject"
                  @click="handleCreateProject"
                >
                  {{ t('projectManagement.create') }}
                </button>
              </div>
            </div>

            <div class="project-management-section">
              <div class="section-title ui-section-title">
                {{ t('projectManagement.openExisting') }}
              </div>
              <button
                class="ui-btn ui-btn--secondary ui-btn--full"
                type="button"
                @click="handleOpenProject"
              >
                {{ t('projectManagement.selectProjectFolder') }}
              </button>
            </div>

            <div class="project-management-section recent-projects-section">
              <div class="section-title ui-section-title">
                {{ t('projectManagement.recentProjects') }}
              </div>
              <div v-if="recentProjects.length === 0" class="empty-state">
                {{ t('projectManagement.noRecentProjects') }}
              </div>
              <div v-else class="recent-projects-list">
                <div
                  v-for="project in recentProjects"
                  :key="project.path"
                  class="recent-project-item"
                  @click="handleOpenRecentProject(project)"
                >
                  <div class="project-info">
                    <div class="project-name">{{ project.name }}</div>
                    <div class="project-path">{{ project.path }}</div>
                  </div>
                  <button
                    class="delete-btn ui-icon-btn ui-icon-btn--sm ui-icon-btn--danger"
                    type="button"
                    :title="t('projectManagement.removeFromHistory')"
                    @click.stop="handleRemoveRecentProject(project.path)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <div v-if="projectStore.isProjectActive" class="project-management-section">
              <div class="section-title ui-section-title">
                {{ t('projectManagement.currentProject') }}
              </div>
              <div class="current-project-info">
                <div class="project-name">
                  {{ graphStore.projectName || t('projectManagement.unnamed') }}
                </div>
                <div class="project-path">{{ projectStore.currentPaths?.configPath }}</div>
              </div>
              <button
                v-if="graphStore.hasUnsavedChanges()"
                class="ui-btn ui-btn--danger"
                type="button"
                @click="handleCloseProject"
              >
                {{ t('projectManagement.closeWithUnsavedChanges') }}
              </button>
              <button
                v-else
                class="ui-btn ui-btn--secondary"
                type="button"
                @click="handleCloseProject"
              >
                {{ t('projectManagement.closeProject') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useCanvasStore } from '@/stores/canvasStore'
  import { projectStorageService, type ProjectInfo } from '@/services/projectStorage'
  import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'

  interface Props {
    modelValue: boolean
  }

  interface Emits {
    (e: 'update:modelValue', value: boolean): void
  }

  const props = defineProps<Props>()
  const emit = defineEmits<Emits>()

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()
  const { showConfirm } = useGlobalConfirm()

  const recentProjects = ref<ProjectInfo[]>([])

  const newProjectForm = ref({
    name: '',
    path: '',
  })

  const canCreateProject = computed(() => {
    return newProjectForm.value.name.trim() !== '' && newProjectForm.value.path.trim() !== ''
  })

  function loadRecentProjects(): void {
    recentProjects.value = projectStorageService.getRecentProjects()
  }

  function handleCloseModal(): void {
    emit('update:modelValue', false)
  }

  async function handleCloseProject(): Promise<void> {
    if (projectStore.isProjectActive) {
      const confirmed = await showConfirm({
        title: t('projectManagement.confirmClose.title'),
        message: t('projectManagement.confirmClose.message'),
        confirmText: t('projectManagement.confirmClose.confirm'),
        cancelText: t('projectManagement.confirmClose.cancel'),
        type: 'warning',
      })
      if (confirmed) {
        graphStore.clearProject()
        emit('update:modelValue', false)
      }
    } else {
      emit('update:modelValue', false)
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!props.modelValue) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCloseModal()
    }
  }

  async function handleSelectDirectory(): Promise<void> {
    const dirPath = await selectDirectory(t('projectManagement.projectPath'))
    if (dirPath) {
      newProjectForm.value.path = dirPath
    }
  }

  function handleCreateProject(): void {
    if (!canCreateProject.value) {
      return
    }

    const name = newProjectForm.value.name.trim()
    const path = newProjectForm.value.path.trim()

    graphStore.createProject(name, path)

    projectStorageService.addRecentProject({
      name,
      path,
      lastOpened: Date.now(),
    })

    newProjectForm.value.name = ''
    newProjectForm.value.path = ''

    handleCloseModal()
  }

  async function handleOpenProject(): Promise<void> {
    const dirPath = await selectDirectory(t('projectManagement.selectProjectFolder'))
    if (dirPath) {
      await loadProject(dirPath)
    }
  }

  async function selectDirectory(dialogTitle: string): Promise<string> {
    if (isElectron()) {
      try {
        const api = getElectronAPI()
        if (api) {
          const result = await api.showOpenDialog({
            title: dialogTitle,
            buttonLabel: t('common.button.select'),
            properties: ['openDirectory'],
          })
          if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
            return result.filePaths[0]
          }
        }
      } catch (error) {
        logger.error('[ProjectManagementModal] 选择目录失败:', error)
      }
      return ''
    } else {
      return selectDirectoryInBrowser(dialogTitle)
    }
  }

  function selectDirectoryInBrowser(dialogTitle: string): Promise<string> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true
      input.multiple = false
      input.style.display = 'none'
      document.body.appendChild(input)

      input.onchange = (event) => {
        const target = event.target as HTMLInputElement
        const files = target.files
        document.body.removeChild(input)

        if (files && files.length > 0) {
          const path = files[0].webkitRelativePath || ''
          const dirPath = path.split('/')[0]
          resolve(dirPath)
        } else {
          resolve('')
        }
      }

      input.onerror = () => {
        document.body.removeChild(input)
        resolve('')
      }

      input.click()
    })
  }

  async function handleOpenRecentProject(project: ProjectInfo): Promise<void> {
    await loadProject(project.path)

    projectStorageService.addRecentProject({
      name: project.name,
      path: project.path,
      lastOpened: Date.now(),
    })
  }

  async function loadProject(projectPath: string): Promise<void> {
    const canvasStore = useCanvasStore()
    graphStore.createProject('', projectPath)

    const loadSuccess = await graphStore.loadProjectFromV2()

    if (loadSuccess) {
      // 加载项目对应的工作区配置
      await canvasStore.loadWorkspaces(projectPath)

      // 如果新项目没有保存的工作区，创建一个默认 Tab
      if (canvasStore.workspaces.length === 0) {
        canvasStore.createNewWorkspace(graphStore)
      }

      const parts = projectPath.replace(/\\/g, '/').split('/')
      const projectName = parts[parts.length - 1] || 'Project'
      projectStorageService.addRecentProject({
        name: projectName,
        path: projectPath,
        lastOpened: Date.now(),
      })

      loadRecentProjects()
      handleCloseModal()
    }
  }

  function handleRemoveRecentProject(path: string): void {
    projectStorageService.removeRecentProject(path)
    loadRecentProjects()
  }

  watch(
    () => props.modelValue,
    (visible) => {
      if (visible) {
        loadRecentProjects()

        const configPath = projectStore.currentPaths?.configPath
        if (configPath && !newProjectForm.value.path) {
          newProjectForm.value.path = configPath
        }

        if (!newProjectForm.value.name) {
          newProjectForm.value.name = 'DefaultProject'
        }
      }
    }
  )

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
    loadRecentProjects()
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
  })
</script>

<style scoped src="./ProjectManagementModal.styles.css"></style>
