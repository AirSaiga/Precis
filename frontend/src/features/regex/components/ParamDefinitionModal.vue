<!--
  @file ParamDefinitionModal.vue
  @description 正则参数定义模态框

  功能概述：
  - 提供参数名称和类型的表单输入
  - 支持 int、float、word、non_space、anything 类型选择
  - ESC 键关闭和自动聚焦输入框

  Props：
  - 无

  Emits：
  - confirm: [ParamDefinition] — 确认并提交参数定义
  - cancel: [] — 取消并关闭模态框
-->
<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal-container" role="dialog" aria-labelledby="modal-title">
      <div class="modal-header">
        <h3 id="modal-title">{{ t('expressions.paramDefinitionModal.defineParameter') }}</h3>
        <button
          class="modal-close"
          @click="$emit('cancel')"
          :aria-label="t('expressions.paramDefinitionModal.closeModal')"
        >
          <AppIcon name="x" :size="16" />
        </button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label for="param-name">{{ t('expressions.paramDefinitionModal.parameterName') }}</label>
          <input
            id="param-name"
            v-model="paramDefinition.name"
            :placeholder="t('expressions.paramDefinitionModal.parameterNamePlaceholder')"
            class="form-input"
            @keydown.enter.prevent="onConfirm"
          />
        </div>

        <div class="form-group">
          <label for="param-type">{{ t('expressions.paramDefinitionModal.parameterType') }}</label>
          <select id="param-type" v-model="paramDefinition.type" class="form-select">
            <option value="int">{{ t('expressions.paramDefinitionModal.typeInt') }}</option>
            <option value="float">{{ t('expressions.paramDefinitionModal.typeFloat') }}</option>
            <option value="word">{{ t('expressions.paramDefinitionModal.typeWord') }}</option>
            <option value="non_space">
              {{ t('expressions.paramDefinitionModal.typeNonSpace') }}
            </option>
            <option value="anything">
              {{ t('expressions.paramDefinitionModal.typeAnything') }}
            </option>
          </select>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="$emit('cancel')">
          {{ t('expressions.paramDefinitionModal.cancel') }}
        </button>
        <button class="btn btn-primary" @click="onConfirm">
          {{ t('expressions.paramDefinitionModal.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { reactive, onMounted, onUnmounted, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { useToast } from '@/composables/shared/useToast'

  interface ParamDefinition {
    name: string
    type: string
  }

  const emit = defineEmits(['confirm', 'cancel'])

  const { t } = useI18n()
  const { warning } = useToast()

  const paramDefinition = reactive<ParamDefinition>({ name: '', type: 'int' })

  function onConfirm() {
    if (paramDefinition.name.trim()) {
      emit('confirm', { ...paramDefinition })
    } else {
      warning(t('expressions.paramDefinitionModal.paramNameCannotBeEmpty'))
    }
  }

  // ESC键关闭弹窗
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      emit('cancel')
    }
  }

  onMounted(() => {
    // 延迟聚焦到输入框
    nextTick(() => {
      const inputElement = document.getElementById('param-name')
      if (inputElement) {
        inputElement.focus()
      }
    })

    document.addEventListener('keydown', handleKeydown)
    // 防止背景滚动
    document.body.style.overflow = 'hidden'
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
    // 恢复背景滚动
    document.body.style.overflow = ''
  })
</script>

<style scoped src="./ParamDefinitionModal.styles.css"></style>
