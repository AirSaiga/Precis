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
  @file ConflictFooter.vue
  @description 冲突解决模态框底部栏组件

  功能概述:
  - 展示统计计数（使用生成配置数 / 保留原始配置数）
  - 提供确认和取消按钮

  Props:
    - generatedCount: number   使用生成配置的数量
    - originalCount: number    保留原始配置的数量
    - totalCount: number       冲突项总数

  Emits:
    - confirm: []              用户点击确认
    - cancel: []               用户点击取消
-->
<template>
  <div class="modal-footer">
    <div class="footer-stats">
      <div class="stat-item generated">
        <span class="stat-icon"><AppIcon name="sparkles" :size="14" /></span>
        <span class="stat-count">{{ generatedCount }}</span>
        <span class="stat-label">{{ t('aiConfigGenerator.conflict.stats.useGenerated') }}</span>
      </div>
      <div class="stat-item original">
        <span class="stat-icon"><AppIcon name="file" :size="14" /></span>
        <span class="stat-count">{{ originalCount }}</span>
        <span class="stat-label">{{ t('aiConfigGenerator.conflict.stats.keepOriginal') }}</span>
      </div>
    </div>
    <div class="footer-actions">
      <button class="btn-secondary" @click="$emit('cancel')">
        {{ t('aiConfigGenerator.conflict.footer.cancel') }}
      </button>
      <button class="btn-primary" @click="$emit('confirm')" :disabled="!totalCount">
        {{ t('aiConfigGenerator.conflict.footer.confirm') }} ({{ totalCount }})
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'

  interface Props {
    generatedCount: number
    originalCount: number
    totalCount: number
  }

  defineProps<Props>()

  defineEmits<{
    confirm: []
    cancel: []
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./ConflictFooter.styles.css"></style>
