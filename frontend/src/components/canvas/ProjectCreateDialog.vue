<!--
  @file ProjectCreateDialog.vue
  @description 创建项目对话框组件

  职责：
  - 提供项目名称和路径输入表单
  - 调用 useProjectManagement 处理项目创建逻辑
-->

<template>
  <div v-if="showCreateDialog" class="modal-overlay">
    <div class="modal-content">
      <h3>{{ t('canvas.nodeCanvas.createProject') }}</h3>
      <div class="form-group">
        <label>{{ t('canvas.nodeCanvas.projectName') }}:</label>
        <input
          v-model="newProjectForm.name"
          type="text"
          :placeholder="t('canvas.nodeCanvas.projectNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('canvas.nodeCanvas.folderPath') }}:</label>
        <input
          v-model="newProjectForm.path"
          type="text"
          :placeholder="t('canvas.nodeCanvas.folderPathPlaceholder')"
        />
      </div>
      <div class="modal-actions">
        <button @click="showCreateDialog = false">{{ t('canvas.nodeCanvas.cancel') }}</button>
        <button
          class="btn-primary"
          @click="handleCreateProject"
          :disabled="!newProjectForm.name || !newProjectForm.path"
        >
          {{ t('canvas.nodeCanvas.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useProjectManagement } from '@/composables/project/useProjectManagement'

  const { t } = useI18n()
  const { showCreateDialog, newProjectForm, showProjectCreateDialog, handleCreateProject } =
    useProjectManagement()

  // 暴露打开方法给父组件
  defineExpose({
    open: showProjectCreateDialog,
  })
</script>
