/** * @file SchemaNodeCloseConfirm.vue * @description Schema节点关闭确认弹窗组件 * * 核心功能： * -
显示关闭Schema节点的确认对话框 * - 提示用户确认是否关闭 * - 模态框形式，带有遮罩层 */
<template>
  <Teleport to="body">
    <div v-if="props.show" class="close-confirm-overlay" @click="emit('cancel')">
      <div class="close-confirm-popover" @click.stop>
        <div class="confirm-header">
          <span class="confirm-title">{{ t('customNodes.schemaNode.closeConfirm.title') }}</span>
        </div>
        <div class="confirm-content">
          <p class="confirm-message">{{ t('customNodes.schemaNode.closeConfirm.message') }}</p>
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn save-close-btn" @click="emit('save')">
            {{ t('customNodes.schemaNode.closeConfirm.saveAndClose') }}
          </button>
          <button class="confirm-btn discard-btn" @click="emit('discard')">
            {{ t('customNodes.schemaNode.closeConfirm.discard') }}
          </button>
          <button class="confirm-btn cancel-btn" @click="emit('cancel')">
            {{ t('customNodes.schemaNode.closeConfirm.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file SchemaNodeCloseConfirm.vue
   * @description Schema节点关闭确认弹窗组件
   *
   * 该组件用于在关闭Schema节点时显示确认对话框：
   * 1. 保存并关闭选项
   * 2. 放弃更改直接关闭选项
   * 3. 取消操作选项
   */

  import { useI18n } from 'vue-i18n'

  /**
   * 组件属性
   */
  const props = defineProps<{
    show: boolean
  }>()

  /**
   * 组件事件
   */
  const emit = defineEmits<{
    (e: 'save'): void
    (e: 'discard'): void
    (e: 'cancel'): void
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./SchemaNodeCloseConfirm.styles.css"></style>
