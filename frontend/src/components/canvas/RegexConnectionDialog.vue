<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
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
        <span class="dialog-icon"><AppIcon name="constraint-charset" :size="24" /></span>
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
        <button class="btn-secondary" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
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
  import AppIcon from '@/components/icons/AppIcon.vue'

  interface PendingConnection {
    sourceColumnName?: string
  }

  const { t } = useI18n()

  interface Props {
    visible: boolean
    pendingConnection: PendingConnection | null
  }

  defineProps<Props>()

  const emit = defineEmits<{
    close: []
    validateDirectly: []
    editRegex: []
  }>()
</script>
