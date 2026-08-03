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
        <!-- 相对路径即时提示：setProjectPaths 会静默拒绝相对路径，不提示会造成"项目已加载但路径未写入"的不一致 -->
        <span v-if="newProjectForm.path && !isAbsolute(newProjectForm.path)" class="path-warn">
          {{ t('common.project.absolutePathRequired') }}
        </span>
      </div>
      <div class="modal-actions">
        <button @click="showCreateDialog = false">{{ t('canvas.nodeCanvas.cancel') }}</button>
        <button class="btn-primary" @click="handleCreateProject" :disabled="!canCreate">
          {{ t('canvas.nodeCanvas.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useProjectManagement } from '@/composables/project/useProjectManagement'
  import { isAbsolutePath } from '@/core/utils/pathNormalization'

  const { t } = useI18n()
  const {
    showCreateDialog,
    creating,
    newProjectForm,
    showProjectCreateDialog,
    handleCreateProject,
  } = useProjectManagement()

  // 绝对路径校验函数（模板内联用）
  const isAbsolute = isAbsolutePath

  // 可创建条件：名称+路径非空、路径为绝对路径、且未在创建中
  const canCreate = computed(
    () =>
      !!newProjectForm.name &&
      !!newProjectForm.path &&
      isAbsolutePath(newProjectForm.path) &&
      !creating.value
  )

  // 暴露打开方法给父组件
  defineExpose({
    open: showProjectCreateDialog,
  })
</script>

<style scoped>
  /* 相对路径即时提示：用语义色 token，自动适配明暗主题 */
  .path-warn {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: var(--ui-danger, #e5484d);
  }
</style>
