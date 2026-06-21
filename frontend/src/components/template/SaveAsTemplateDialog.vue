<!--
  @file SaveAsTemplateDialog.vue
  @description 将画布选区打包为可复用模板的轻量对话框

  从画布选中的节点自动提取内部 DAG，用户只需填写元信息。
  模板为自包含 DAG，内部以 manualData 作为输入起点。
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
                <span v-if="extraction.summary.manualData" class="summary-chip">
                  {{ extraction.summary.manualData }} ManualData
                </span>
                <span v-if="extraction.excludedCount > 0" class="summary-excluded">
                  ({{ t('template.excludedNodes', { count: extraction.excludedCount }) }})
                </span>
              </div>
              <div v-for="err in extraction.errors" :key="err" class="summary-error">
                {{ t(`template.errors.${err}`) }}
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
              <div v-if="form.id && !isIdValid" class="field-error">
                {{ t('template.invalidIdFormat') }}
              </div>
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
  })

  const ID_PATTERN = /^[a-zA-Z0-9_-]+$/

  const isIdValid = computed(() => ID_PATTERN.test(form.id.trim()))

  const canSave = computed(() => {
    return (
      form.id.trim() !== '' &&
      isIdValid.value &&
      form.name.trim() !== '' &&
      extraction.value.eligibleCount > 0 &&
      extraction.value.errors.length === 0
    )
  })

  function handleClose() {
    emit('close')
  }

  async function handleSave() {
    if (!canSave.value) return
    isLoading.value = true
    try {
      const success = await saveTemplateFromSelection(
        { id: form.id, name: form.name, description: form.description },
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

  // 打开/关闭对话框时重置表单和加载状态
  watch(
    () => props.visible,
    (visible) => {
      if (visible) {
        form.id = ''
        form.name = ''
        form.description = ''
        isLoading.value = false

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
    color: var(--ui-text, #ccc);
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-muted, #858585);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .form-input,
  .form-textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--ui-border, #3c3c3c);
    border-radius: 6px;
    background: var(--ui-bg, #252526);
    color: var(--ui-text, #ccc);
    font-size: 13px;
    box-sizing: border-box;
  }

  .form-input:focus,
  .form-textarea:focus {
    outline: none;
    border-color: var(--ui-accent-primary, #0e639c);
  }

  .form-textarea {
    resize: vertical;
    min-height: 60px;
  }

  .field-error {
    font-size: 12px;
    color: var(--ui-danger, #f44336);
  }

  .selection-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .summary-chip {
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--ui-bg-subtle, #333);
    color: var(--ui-text, #ccc);
    font-size: 12px;
  }

  .summary-excluded {
    font-size: 12px;
    color: var(--ui-text-muted, #858585);
  }

  .summary-warning {
    font-size: 12px;
    color: var(--ui-warning-strong, #ffcc00);
  }

  .summary-error {
    font-size: 12px;
    color: var(--ui-danger, #f44336);
  }

  .anchor-info {
    font-size: 12px;
    color: var(--ui-text-muted, #858585);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid var(--ui-border-subtle, #333);
  }

  .btn-secondary,
  .btn-primary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid var(--ui-border, #3c3c3c);
    color: var(--ui-text, #ccc);
  }

  .btn-secondary:hover {
    background: var(--ui-bg-subtle, #333);
  }

  .btn-primary {
    background: var(--ui-accent-primary, #0e639c);
    border: 1px solid var(--ui-accent-primary, #0e639c);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--ui-accent-primary-hover, #1177bb);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .modal-fade-enter-active,
  .modal-fade-leave-active {
    transition: opacity 0.2s ease;
  }

  .modal-fade-enter-from,
  .modal-fade-leave-to {
    opacity: 0;
  }
</style>
