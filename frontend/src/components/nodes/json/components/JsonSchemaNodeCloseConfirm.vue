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
  @file JsonSchemaNodeCloseConfirm.vue
  @description JSON Schema 关闭确认对话框

  功能概述：
  - 显示关闭 JSON Schema 节点的确认对话框
  - 提供保存并关闭、放弃更改、取消三种操作

  Props：
  - show: boolean — 是否显示对话框

  Emits：
  - save: 保存并关闭
  - discard: 放弃更改直接关闭
  - cancel: 取消关闭
-->
<template>
  <Teleport to="body">
    <div v-if="props.show" class="close-confirm-overlay" @click="emit('cancel')">
      <div class="close-confirm-popover" @click.stop>
        <div class="confirm-header">
          <span class="confirm-title">{{
            t('customNodes.jsonSchemaNode.closeConfirm.title')
          }}</span>
        </div>
        <div class="confirm-content">
          <p class="confirm-message">{{ t('customNodes.jsonSchemaNode.closeConfirm.message') }}</p>
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn save-close-btn" @click="emit('save')">
            {{ t('customNodes.jsonSchemaNode.closeConfirm.saveAndClose') }}
          </button>
          <button class="confirm-btn discard-btn" @click="emit('discard')">
            {{ t('customNodes.jsonSchemaNode.closeConfirm.discard') }}
          </button>
          <button class="confirm-btn cancel-btn" @click="emit('cancel')">
            {{ t('customNodes.jsonSchemaNode.closeConfirm.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file JsonSchemaNodeCloseConfirm.vue
   * @description JSON Schema节点关闭确认弹窗组件
   *
   * 核心功能：
   * - 显示关闭JSON Schema节点的确认对话框
   * - 提示用户确认是否关闭
   * - 模态框形式，带有遮罩层
   *
   * 该组件用于在关闭JSON Schema节点时显示确认对话框：
   * 1. 保存并关闭选项
   * 2. 放弃更改直接关闭选项
   * 3. 取消操作选项
   */

  import { useI18n } from 'vue-i18n'

  /**
   * 组件属性
   */
  interface Props {
    show: boolean
  }

  const props = defineProps<Props>()

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

<style scoped src="./JsonSchemaNodeCloseConfirm.styles.css"></style>
