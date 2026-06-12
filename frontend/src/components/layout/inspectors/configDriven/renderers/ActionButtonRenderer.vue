<!--
  @file ActionButtonRenderer.vue
  @description 操作按钮渲染器，支持多种操作类型
-->
<template>
  <div class="field action-button-field">
    <button
      class="action-btn"
      :class="[`action-${field.action}`, { 'action-danger': field.danger }]"
      @click="handleAction"
    >
      {{ buttonLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import { useAiConfigGeneratorStore } from '@/features/ai-config-generator/stores/aiConfigGeneratorStore'
  import { useScriptEditorStore } from '@/stores/scriptEditorStore'
  import { useToast } from '@/composables/shared/useToast'
  import { eventBus } from '@/core/eventBus'
  import { validateConstraintNodeById } from '@/services/constraints/validationRegistryCore'
  import type { InspectorContext } from '../utils'
  import { getByPath } from '../utils'
  import type { InspectorActionButtonField } from '../types'

  const { t } = useI18n()
  const store = useGraphStore()
  const settingsStore = useSettingsStore()
  const validationTaskStore = useValidationTaskStore()
  const aiConfigGeneratorStore = useAiConfigGeneratorStore()
  const scriptEditorStore = useScriptEditorStore()
  const toast = useToast()
  const isValidating = ref(false)

  const props = defineProps<{
    field: InspectorActionButtonField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const buttonLabel = computed(() => t(props.field.buttonLabelKey))

  function handleAction() {
    switch (props.field.action) {
      case 'validate':
        handleValidate()
        break
      case 'fullValidation':
        handleFullValidation()
        break
      case 'aiGenerate':
        handleAiGenerate()
        break
      case 'reload':
        handleReload()
        break
      case 'projectManagement':
        handleProjectManagement()
        break
      case 'closeProject':
        handleCloseProject()
        break
      case 'openScriptEditor':
        handleOpenScriptEditor()
        break
    }
  }

  async function handleValidate() {
    const constraintNodeId = props.ctx.nodeId
    if (!constraintNodeId || isValidating.value) return

    isValidating.value = true
    try {
      await validateConstraintNodeById(
        constraintNodeId,
        store.nodes,
        store.edges,
        store.updateNodeData
      )
      await nextTick()

      const node = store.nodes.find((n) => n.id === constraintNodeId)
      const data = (node?.data || {}) as Record<string, unknown>
      const status = data.validationStatus as string | undefined
      const lastVal = data.lastValidation as { totalRows?: number; errorCount?: number } | undefined

      if (status === 'error') {
        toast.error(
          t('inspector.constraint.validateErrorDetail', { count: lastVal?.errorCount || 0 }),
          t('inspector.constraint.validateFailed')
        )
      } else if (status === 'pass') {
        toast.success(
          t('inspector.constraint.validatePassDetail', { count: lastVal?.totalRows || 0 }),
          t('inspector.constraint.validatePassed')
        )
      } else {
        toast.warning(
          t('inspector.constraint.validateSkippedDetail'),
          t('inspector.constraint.validateSkipped')
        )
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : String(e),
        t('inspector.constraint.validateError')
      )
    } finally {
      isValidating.value = false
    }
  }

  function handleFullValidation() {
    validationTaskStore.openFullProject()
  }

  function handleAiGenerate() {
    aiConfigGeneratorStore.open()
  }

  async function handleReload() {
    await store.loadProjectFromV2()
    eventBus.emit('project-applied')
  }

  function handleProjectManagement() {
    settingsStore.open('project-info')
  }

  function handleCloseProject() {
    if (confirm(t('inspector.projectRoot.confirm.closeProject'))) {
      store.clearProject()
      eventBus.emit('project-closed')
    }
  }

  function handleOpenScriptEditor() {
    const nodeId = props.ctx.nodeId
    if (nodeId) {
      scriptEditorStore.open(nodeId)
    }
  }
</script>

<style scoped>
  .action-button-field {
    padding-top: 2px;
  }

  .action-btn {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: var(--ui-radius-md);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--ui-transition-fast);
  }

  .action-validate,
  .action-fullValidation {
    background: color-mix(in srgb, var(--ui-accent-primary, #0e639c) 10%, transparent);
    color: var(--ui-accent-primary, #0e639c);
    border-color: color-mix(in srgb, var(--ui-accent-primary, #0e639c) 30%, transparent);
  }

  .action-validate:hover,
  .action-fullValidation:hover {
    background: color-mix(in srgb, var(--ui-accent-primary, #0e639c) 18%, transparent);
  }

  .action-aiGenerate,
  .action-reload,
  .action-projectManagement {
    background: var(--ui-bg-elevated);
    color: var(--ui-text-strong);
  }

  .action-aiGenerate:hover,
  .action-reload:hover,
  .action-projectManagement:hover {
    background: var(--ui-bg-hover);
    border-color: var(--ui-border-strong);
    box-shadow: var(--ui-shadow-sm);
  }

  .action-danger {
    color: var(--ui-danger);
    border-color: color-mix(in srgb, var(--ui-danger) 30%, transparent);
    background: color-mix(in srgb, var(--ui-danger) 6%, transparent);
  }

  .action-danger:hover {
    background: var(--ui-danger);
    color: white;
    border-color: var(--ui-danger);
  }
</style>
