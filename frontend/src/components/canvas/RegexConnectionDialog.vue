<!--
  @file RegexConnectionDialog.vue
  @description 正则连接确认对话框

  职责：
  - 当用户将正则节点连接到 Schema 列时弹出确认
  - 提供直接验证或编辑正则两种选择
-->

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content regex-connection-dialog">
      <div class="dialog-header">
        <span class="dialog-icon">🔤</span>
        <h3>{{ t('canvas.nodeCanvas.regexConnectionTitle') }}</h3>
      </div>
      <div class="dialog-body">
        <p class="dialog-message">
          {{
            t('canvas.nodeCanvas.regexConnectionMessage', {
              column: pendingConnection?.sourceColumnName,
            })
          }}
        </p>
        <p class="dialog-hint">
          {{ t('canvas.nodeCanvas.regexConnectionHint') }}
        </p>
      </div>
      <div class="dialog-actions">
        <button class="btn-secondary" @click="emit('validateDirectly')">
          {{ t('canvas.nodeCanvas.validateDirectly') }}
        </button>
        <button class="btn-primary" @click="emit('editRegex')">
          {{ t('canvas.nodeCanvas.editRegex') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface PendingConnection {
    sourceColumnName?: string
  }

  const { t } = useI18n()

  defineProps<{
    visible: boolean
    pendingConnection: PendingConnection | null
  }>()

  const emit = defineEmits<{
    close: []
    validateDirectly: []
    editRegex: []
  }>()
</script>
