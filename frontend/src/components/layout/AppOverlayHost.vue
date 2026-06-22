<!--
  @file AppOverlayHost.vue
  @description 应用全局 Overlay 挂载组件

  职责：
  - 集中挂载所有全局弹窗、抽屉、模态框
  - 管理 overlay 的显隐状态
  - 监听并响应相关的全局窗口事件
  - 避免 App.vue 成为 God Component
-->

<template>
  <!-- Toast 通知组件 -->
  <Toast />

  <!-- 全局确认弹窗 -->
  <GlobalConfirmModal />

  <!-- 配置自检抽屉（由 InspectionStatusBadge 触发，组件始终挂载以共享状态） -->
  <InspectionDrawer />

  <!-- 设置面板 -->
  <SettingsModal>
    <template #shortcuts>
      <ShortcutSettingsPanel />
    </template>
  </SettingsModal>

  <FullValidationModal v-model="validationTaskStore.visible" />

  <AIConfigGenerateModal
    :visible="aiConfigGeneratorStore.visible"
    @close="aiConfigGeneratorStore.close()"
  />

  <ScriptEditorModal v-model="scriptEditorStore.visible" />

  <ProjectManagementModal v-model="projectManagementVisible" />

  <!-- 正则表达式设计弹窗 -->
  <RegexDesignModal
    :visible="graphStore.designModalVisible"
    :rule-data="graphStore.activeRegexNode?.data as RegexNodeData"
    @close="graphStore.closeRegexDesignModal"
    @save="handleRegexDesignSave"
  />

  <!-- 保存选区为模板对话框 -->
  <SaveAsTemplateDialog
    :visible="saveAsTemplateVisible"
    :selected-nodes="graphStore.selectedNodes"
    :edges="graphStore.edges"
    @close="saveAsTemplateVisible = false"
    @save="saveAsTemplateVisible = false"
  />
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from 'vue'
  import { defineAsyncComponent } from 'vue'
  import { eventBus } from '@/core/eventBus'
  import Toast from '@/components/shared/Toast.vue'
  import GlobalConfirmModal from '@/components/common/GlobalConfirmModal.vue'
  import InspectionDrawer from '@/components/inspection/InspectionDrawer.vue'
  import ShortcutSettingsPanel from '@/components/settings/ShortcutSettingsPanel.vue'
  import type { RegexNodeData, RegexDesignUpdateData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useScriptEditorStore } from '@/stores/scriptEditorStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useAiConfigGeneratorStore } from '@/features/ai-config-generator/stores/aiConfigGeneratorStore'
  import { useI18n } from 'vue-i18n'
  const SettingsModal = defineAsyncComponent(() => import('@/components/common/SettingsModal.vue'))
  const FullValidationModal = defineAsyncComponent(
    () => import('@/components/common/FullValidationModal.vue')
  )
  const AIConfigGenerateModal = defineAsyncComponent(
    () => import('@/features/ai-config-generator/components/AIConfigGeneratorModal.vue')
  )
  const ScriptEditorModal = defineAsyncComponent(
    () => import('@/components/common/ScriptEditorModal.vue')
  )
  const ProjectManagementModal = defineAsyncComponent(
    () => import('@/components/common/ProjectManagementModal.vue')
  )
  const RegexDesignModal = defineAsyncComponent(
    () => import('@/features/regex/components/RegexDesignModal.vue')
  )
  const SaveAsTemplateDialog = defineAsyncComponent(
    () => import('@/components/template/SaveAsTemplateDialog.vue')
  )

  const graphStore = useGraphStore()
  const scriptEditorStore = useScriptEditorStore()
  const validationTaskStore = useValidationTaskStore()
  const settingsStore = useSettingsStore()
  const aiConfigGeneratorStore = useAiConfigGeneratorStore()
  const projectManagementVisible = ref(false)
  const saveAsTemplateVisible = ref(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const { t } = useI18n()

  const handleRegexDesignSave = (updatedData: RegexNodeData) => {
    if (graphStore.activeRegexNodeId) {
      graphStore.saveRegexDesign(graphStore.activeRegexNodeId, updatedData as RegexDesignUpdateData)
    }
  }

  const handleOpenSaveAsTemplate = () => {
    saveAsTemplateVisible.value = true
  }

  const handleOpenSettings = () => {
    settingsStore.open()
  }

  const handleOpenProjectManagement = () => {
    settingsStore.open('project-info')
    projectManagementVisible.value = true
  }

  onMounted(() => {
    eventBus.on('open-settings', handleOpenSettings)
    eventBus.on('open-project-management', handleOpenProjectManagement)
    eventBus.on('open-save-as-template-dialog', handleOpenSaveAsTemplate)
  })

  onUnmounted(() => {
    eventBus.off('open-settings', handleOpenSettings)
    eventBus.off('open-project-management', handleOpenProjectManagement)
    eventBus.off('open-save-as-template-dialog', handleOpenSaveAsTemplate)
  })

  // 暴露方法给父组件，用于外部触发打开某些 overlay
  defineExpose({
    openAiConfigGenerator: () => {
      aiConfigGeneratorStore.open()
    },
    openProjectManagement: () => {
      projectManagementVisible.value = true
    },
  })
</script>
