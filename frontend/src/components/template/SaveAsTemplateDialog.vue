<!--
  @file SaveAsTemplateDialog.vue
  @description 将画布选区打包为可复用模板的轻量对话框

  从画布选中的节点自动提取内部 DAG，用户只需填写元信息和参数声明。
  替代旧版 TemplateDesignerModal 的"手动填写内部节点"方式。
-->

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="save-template-overlay" @click.self="handleClose">
        <div class="save-template-modal" role="dialog" aria-modal="true">
          <!-- 头部 -->
          <div class="modal-header">
            <h3 class="modal-title">{{ t('template.saveAsTemplateTitle') }}</h3>
            <button class="modal-close" type="button" @click="handleClose">&times;</button>
          </div>

          <!-- 内容 -->
          <div class="modal-body">
            <!-- 选区摘要 -->
            <div class="form-section">
              <div class="form-section-title">{{ t('template.selectionSummary') }}</div>
              <div class="selection-summary">
                <span v-if="extraction.summary.transforms" class="summary-chip">
                  {{ extraction.summary.transforms }} Transform
                </span>
                <span v-if="extraction.summary.constraints" class="summary-chip">
                  {{ extraction.summary.constraints }} Constraint
                </span>
                <span v-if="extraction.summary.regexNodes" class="summary-chip">
                  {{ extraction.summary.regexNodes }} Regex
                </span>
                <span v-if="extraction.excludedCount > 0" class="summary-excluded">
                  ({{ t('template.excludedNodes', { count: extraction.excludedCount }) }})
                </span>
              </div>
              <div v-if="extraction.warnings.includes('multipleAnchors')" class="summary-warning">
                {{ t('template.multipleAnchorsWarning') }}
              </div>
              <div v-if="extraction.inputAnchorId" class="anchor-info">
                {{ t('template.inputAnchor') }}: {{ extraction.inputAnchorId }}
              </div>
            </div>

            <!-- 基本信息 -->
            <div class="form-section">
              <div class="form-section-title">{{ t('template.templateId') }}</div>
              <input
                v-model="form.id"
                type="text"
                class="form-input"
                :placeholder="t('template.templateId')"
              />
            </div>

            <div class="form-section">
              <div class="form-section-title">{{ t('template.templateName') }}</div>
              <input
                v-model="form.name"
                type="text"
                class="form-input"
                :placeholder="t('template.templateName')"
              />
            </div>

            <div class="form-section">
              <div class="form-section-title">{{ t('template.description') }}</div>
              <textarea
                v-model="form.description"
                class="form-textarea"
                rows="2"
                :placeholder="t('template.description')"
              ></textarea>
            </div>

            <!-- 参数定义 -->
            <div class="form-section">
              <div class="form-section-header">
                <div class="form-section-title">{{ t('template.parameters') }}</div>
                <button type="button" class="btn-icon" @click="addParameter">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              </div>

              <div v-if="form.parameters.length === 0" class="empty-hint">
                {{ t('template.noParameters') }}
              </div>

              <div v-for="(param, index) in form.parameters" :key="index" class="list-item">
                <div class="list-item-fields">
                  <input
                    v-model="param.id"
                    type="text"
                    class="form-input-small"
                    :placeholder="t('template.parameterId')"
                  />
                  <select v-model="param.type" class="form-select">
                    <option value="string">{{ t('template.string') }}</option>
                    <option value="integer">{{ t('template.integer') }}</option>
                    <option value="decimal">{{ t('template.decimal') }}</option>
                    <option value="boolean">{{ t('template.boolean') }}</option>
                  </select>
                  <input
                    v-model="param.label"
                    type="text"
                    class="form-input-small"
                    :placeholder="t('template.parameterLabel')"
                  />
                  <label class="form-checkbox-label">
                    <input v-model="param.required" type="checkbox" />
                    {{ t('template.parameterRequired') }}
                  </label>
                  <input
                    v-model="param.default"
                    type="text"
                    class="form-input-small"
                    :placeholder="t('template.parameterDefault')"
                  />
                </div>
                <button type="button" class="btn-icon danger" @click="removeParameter(index)">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="modal-footer">
            <button class="btn-secondary" type="button" @click="handleClose">
              {{ t('common.cancel') }}
            </button>
            <button
              class="btn-primary"
              type="button"
              :disabled="!canSave || isLoading"
              @click="handleSave"
            >
              {{ isLoading ? t('common.saving') : t('template.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  import { ref, reactive, computed, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { Edge, Node } from '@vue-flow/core'
  import type { CustomNodeData } from '@/types/nodes'
  import {
    extractTemplateFromSelection,
    saveTemplateFromSelection,
  } from '@/composables/template/useTemplateFromSelection'

  type CustomNode = Node<CustomNodeData>

  interface Props {
    visible: boolean
    selectedNodes: CustomNode[]
    edges: Edge[]
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    close: []
    save: []
  }>()

  const { t } = useI18n()

  const isLoading = ref(false)

  const extraction = computed(() => extractTemplateFromSelection(props.selectedNodes, props.edges))

  const form = reactive({
    id: '',
    name: '',
    description: '',
    parameters: [] as Array<{
      id: string
      type: 'string' | 'integer' | 'decimal' | 'boolean'
      label: string
      required: boolean
      default: string
    }>,
  })

  const canSave = computed(() => {
    return form.id.trim() !== '' && form.name.trim() !== '' && extraction.value.eligibleCount > 0
  })

  function addParameter() {
    form.parameters.push({
      id: '',
      type: 'string',
      label: '',
      required: true,
      default: '',
    })
  }

  function removeParameter(index: number) {
    form.parameters.splice(index, 1)
  }

  function handleClose() {
    emit('close')
  }

  async function handleSave() {
    if (!canSave.value) return
    isLoading.value = true
    try {
      const success = await saveTemplateFromSelection(
        { id: form.id, name: form.name, description: form.description },
        form.parameters,
        extraction.value.templateNodes
      )
      if (success) {
        emit('save')
        handleClose()
      }
    } finally {
      isLoading.value = false
    }
  }

  // 打开对话框时重置表单
  watch(
    () => props.visible,
    (visible) => {
      if (visible) {
        form.id = ''
        form.name = ''
        form.description = ''
        form.parameters = []

        const handleKeydown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            handleClose()
          }
        }
        document.addEventListener('keydown', handleKeydown)
        // 在 visible 变为 false 时移除监听
        const unwatch = watch(
          () => props.visible,
          (v) => {
            if (!v) {
              document.removeEventListener('keydown', handleKeydown)
              unwatch()
            }
          }
        )
      }
    }
  )
</script>

<style scoped>
  .save-template-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .save-template-modal {
    background: var(--ui-bg-elevated, #2d2d30);
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 8px;
    width: 560px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--ui-border-subtle, #333);
  }

  .modal-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--ui-text-primary, #ccc);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--ui-text-muted, #858585);
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .modal-close:hover {
    color: var(--ui-text-primary, #ccc);
  }

  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  .form-section {
    margin-bottom: 16px;
  }

  .form-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .form-section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-secondary, #9cdcfe);
    margin-bottom: 6px;
  }

  .form-section-header .form-section-title {
    margin-bottom: 0;
  }

  .form-input,
  .form-textarea {
    width: 100%;
    padding: 6px 10px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 13px;
    box-sizing: border-box;
  }

  .form-textarea {
    resize: vertical;
    font-family: inherit;
  }

  .form-input:focus,
  .form-textarea:focus {
    outline: none;
    border-color: var(--ui-accent, #007acc);
  }

  .selection-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .summary-chip {
    display: inline-block;
    padding: 2px 8px;
    background: var(--ui-accent, #007acc);
    color: white;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .summary-excluded {
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
  }

  .summary-warning {
    margin-top: 6px;
    font-size: 11px;
    color: #d19a66;
  }

  .anchor-info {
    margin-top: 6px;
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
  }

  .empty-hint {
    font-size: 12px;
    color: var(--ui-text-muted, #858585);
    font-style: italic;
    padding: 8px 0;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .list-item-fields {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .form-input-small {
    padding: 4px 8px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 12px;
    width: 80px;
  }

  .form-input-small:focus {
    outline: none;
    border-color: var(--ui-accent, #007acc);
  }

  .form-select {
    padding: 4px 8px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 12px;
  }

  .form-checkbox-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--ui-text-secondary, #9cdcfe);
    white-space: nowrap;
    cursor: pointer;
  }

  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--ui-text-muted, #858585);
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .btn-icon:hover {
    background: var(--ui-border-subtle, #333);
    color: var(--ui-text-primary, #ccc);
  }

  .btn-icon.danger:hover {
    color: #f44747;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--ui-border-subtle, #333);
  }

  .btn-secondary {
    padding: 6px 16px;
    background: transparent;
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 13px;
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: var(--ui-border-subtle, #333);
  }

  .btn-primary {
    padding: 6px 16px;
    background: var(--ui-accent, #007acc);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--ui-accent-primary, #0e639c);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
