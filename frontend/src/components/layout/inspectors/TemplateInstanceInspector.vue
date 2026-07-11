<template>
  <div class="template-instance-inspector">
    <!-- 基础配置 -->
    <InspectorSection
      :title="t('inspector.templateInstance.groups.config')"
      :badge="t('inspector.templateInstance.badgeEditable')"
      badge-class="editable"
    >
      <InspectorField
        :label="t('inspector.templateInstance.labels.configName')"
        :model-value="localData.configName"
        :editable="true"
        :placeholder="t('inspector.templateInstance.placeholders.configName')"
        @update:model-value="(v) => onConfigNameChange(v)"
      />
    </InspectorSection>

    <!-- 模板引用 -->
    <InspectorSection
      :title="t('inspector.templateInstance.groups.template')"
      :badge="t('inspector.templateInstance.badgeEditable')"
      badge-class="editable"
    >
      <div class="field">
        <label class="field-label">{{ t('inspector.templateInstance.labels.templateId') }}</label>
        <select
          :value="localData.templateId"
          class="field-input template-select"
          :disabled="availableTemplates.length === 0"
          @change="onTemplateSelect"
        >
          <option value="" disabled>{{ t('inspector.templateInstance.selectTemplate') }}</option>
          <option v-for="tmpl in availableTemplates" :key="tmpl.id" :value="tmpl.id">
            {{ tmpl.name || tmpl.id }}
          </option>
        </select>
        <div v-if="availableTemplates.length === 0" class="field-hint">
          {{ t('inspector.templateInstance.noTemplates') }}
        </div>
      </div>

      <div class="field field-layout-row">
        <label class="field-label">{{ t('inspector.templateInstance.labels.enabled') }}</label>
        <input v-model="localData.enabled" type="checkbox" class="toggle" @change="emitUpdate" />
      </div>
    </InspectorSection>

    <!-- 操作 -->
    <InspectorSection
      :title="t('inspector.templateInstance.groups.actions')"
      :badge="t('inspector.templateInstance.badgeEditable')"
      badge-class="editable"
    >
      <button
        class="preview-btn"
        :disabled="expanding || !localData.templateId"
        @click="previewExpand"
      >
        {{
          expanding
            ? t('inspector.templateInstance.expanding')
            : t('inspector.templateInstance.previewExpand')
        }}
      </button>
    </InspectorSection>

    <!-- 保存状态 -->
    <InspectorSection
      :title="t('inspector.templateInstance.groups.status')"
      :badge="t('inspector.templateInstance.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="field">
        <label class="field-label">{{
          t('inspector.templateInstance.labels.currentStatus')
        }}</label>
        <div class="status-indicator" :class="localData.saveState || 'draft'">
          <AppIcon class="status-icon" :name="getStatusIcon(localData.saveState)" :size="16" />
          <span class="status-text">{{ getStatusText(localData.saveState) }}</span>
        </div>
      </div>
    </InspectorSection>
  </div>
</template>

<script setup lang="ts">
  import { reactive, ref, computed, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import InspectorSection from './InspectorSection.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { TemplateInstanceNodeData } from '@/types/nodes'
  import { expandV2Template } from '@/api/projectV2Api'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { useToast } from '@/composables/shared/useToast'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const toast = useToast()

  interface Props {
    data: TemplateInstanceNodeData
    nodeId: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:data': [data: Partial<TemplateInstanceNodeData>]
  }>()

  const resourceTreeStore = useResourceTreeStore()

  const availableTemplates = computed(() =>
    resourceTreeStore.templates.map((r) => ({
      id: r.id,
      name: (r.meta?.name as string | undefined) || r.id,
    }))
  )

  const localData = reactive({
    configName: props.data.configName || '',
    templateId: props.data.templateId || '',
    templateName: props.data.templateName || '',
    enabled: props.data.enabled !== false,
    saveState: props.data.saveState || ('draft' as const),
  })

  watch(
    () => props.data,
    (newData) => {
      localData.configName = newData.configName || ''
      localData.templateId = newData.templateId || ''
      localData.templateName = newData.templateName || ''
      localData.enabled = newData.enabled !== false
      localData.saveState = newData.saveState || 'draft'
    },
    { deep: true }
  )

  const expanding = ref(false)

  function onConfigNameChange(value: string) {
    localData.configName = value
    emitUpdate()
  }

  async function onTemplateSelect(e: Event) {
    const select = e.target as HTMLSelectElement
    const newId = select.value
    if (!newId) return

    const matched = availableTemplates.value.find((item) => item.id === newId)
    localData.templateId = newId
    localData.templateName = matched?.name || newId

    // 清除旧模板的展开节点（await 保证 removeNodes 回写后再复位容器，
    // 避免被全量替换写回导致删除的子节点残留）
    await graphStore.clearExpansion(props.nodeId)

    emitUpdate()
    emit('update:data', {
      templateId: newId,
      templateName: localData.templateName,
      configName: localData.templateName,
    })
  }

  function emitUpdate() {
    emit('update:data', {
      configName: localData.configName,
      enabled: localData.enabled,
    })
  }

  function getExpandErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message
    }
    return String(err)
  }

  async function previewExpand() {
    if (!localData.templateId) return

    // 如果子节点已存在（之前展开过），直接显示而无需重新调用 API
    if (graphStore.getExpandedIds(props.nodeId).length > 0) {
      graphStore.reExpand(props.nodeId)
      return
    }

    expanding.value = true
    try {
      const result = await expandV2Template(localData.templateId, props.nodeId)
      // 在画布上渲染展开后的 DAG 节点
      graphStore.expandOnCanvas(props.nodeId, result)
      emit('update:data', {
        nodeCount:
          result.transforms.length +
          result.constraints.length +
          result.regex_nodes.length +
          result.manual_data.length,
      })
    } catch (err) {
      const message = getExpandErrorMessage(err)
      console.error('[TemplateInstanceInspector] 展开预览失败:', err)
      toast.error(
        t('inspector.templateInstance.expandFailed'),
        t('inspector.templateInstance.expandErrorDetail', { message })
      )
    } finally {
      expanding.value = false
    }
  }

  function getStatusIcon(state: string | undefined): string {
    switch (state) {
      case 'saved':
        return 'check'
      case 'draft':
        return 'circle'
      case 'error':
        return 'x'
      default:
        return 'info'
    }
  }

  function getStatusText(state: string | undefined): string {
    switch (state) {
      case 'saved':
        return t('inspector.templateInstance.saved')
      case 'error':
        return t('inspector.templateInstance.error')
      case 'draft':
      default:
        return t('inspector.templateInstance.unsaved')
    }
  }
</script>

<style scoped>
  .template-instance-inspector {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-weight: 500;
    font-size: 11px;
    color: var(--ui-text-muted);
    user-select: text;
    -webkit-user-select: text;
  }

  .field-layout-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-bg-panel);
  }

  .field-layout-row .field-label {
    padding: 0;
    color: var(--ui-text);
  }

  .field-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-elevated);
    color: var(--ui-text);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
    transition:
      border-color var(--ui-transition-fast),
      box-shadow var(--ui-transition-fast),
      background var(--ui-transition-fast);
  }

  .field-input:hover {
    border-color: var(--ui-border-strong);
  }

  .field-input:focus {
    border-color: var(--ui-border-focus);
    background: var(--ui-bg-elevated);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-border-focus) 15%, transparent);
  }

  .field-input::placeholder {
    color: var(--ui-text-placeholder);
  }

  .template-select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: var(--ui-bg-subtle);
  }

  .field-hint {
    font-size: 12px;
    color: var(--ui-text-muted);
    font-style: italic;
  }

  .field-help {
    font-size: 11px;
    color: var(--ui-text-muted);
    line-height: 1.4;
  }

  .toggle {
    accent-color: var(--ui-accent);
    width: 18px;
    height: 18px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .param-boolean {
    justify-content: flex-end;
    min-height: 40px;
  }

  .required-mark {
    color: var(--ui-danger, #f44336);
    margin-left: 2px;
  }

  .preview-btn {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: var(--ui-radius-md);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--ui-transition-fast);
    background: color-mix(in srgb, var(--ui-accent-primary, #0e639c) 10%, transparent);
    color: var(--ui-accent-primary, #0e639c);
    border-color: color-mix(in srgb, var(--ui-accent-primary, #0e639c) 30%, transparent);
  }

  .preview-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ui-accent-primary, #0e639c) 18%, transparent);
  }

  .preview-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 6px;
    font-weight: 500;
  }

  .status-indicator.saved {
    background: var(--ui-success-weak);
    color: var(--ui-success);
    border: 1px solid var(--ui-success);
  }

  .status-indicator.draft {
    background: var(--ui-warning-weak);
    color: var(--ui-warning-strong);
    border: 1px solid var(--ui-warning);
  }

  .status-indicator.error {
    background: var(--ui-danger-weak);
    color: var(--ui-danger);
    border: 1px solid var(--ui-danger);
  }

  .status-icon {
    font-size: 14px;
  }

  .status-text {
    font-size: 14px;
  }
</style>
