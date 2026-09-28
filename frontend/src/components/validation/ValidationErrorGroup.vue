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
<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { ValidationReportErrorRow } from '@/services/validationReportViewModel'
  import {
    localizedErrorText,
    validationErrorTypeLabel,
  } from '@/services/validationReportViewModel'

  interface Props {
    groupName: string
    errors: ValidationReportErrorRow[]
    /** 已定位成功的错误行 key 集合（可选；父组件持有，筛选/分组/形态切换不重置） */
    locatedKeys?: Set<string>
  }

  defineProps<Props>()

  const emit = defineEmits<{
    (e: 'navigate', error: ValidationReportErrorRow): void
  }>()

  const { t } = useI18n()
  const expanded = ref(true)
  // 组内当前展开详情的错误行 key（每组内单行展开，null 表示全部收起）
  const expandedRowKey = ref<string | null>(null)

  // 单击行：选中并就地展开详情；再次单击收起。双击行触发 navigate（见模板 @dblclick）
  const toggleRowExpand = (error: ValidationReportErrorRow) => {
    expandedRowKey.value = expandedRowKey.value === error.key ? null : error.key
  }
</script>

<template>
  <div class="fv-error-group">
    <div class="fv-error-group-header" @click="expanded = !expanded">
      <span class="fv-error-group-toggle">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :style="{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
      <span class="fv-error-group-name">{{ groupName }}</span>
      <span class="ui-badge is-danger">{{ errors.length }}</span>
    </div>
    <div v-show="expanded" class="fv-error-group-body">
      <div
        v-for="error in errors"
        :key="error.key"
        class="fv-error-item"
        :class="{
          'is-selected': expandedRowKey === error.key,
          'is-located': locatedKeys?.has(error.key),
        }"
        @click="toggleRowExpand(error)"
        @dblclick="emit('navigate', error)"
      >
        <div class="fv-error-main">
          <div class="fv-error-topline">
            <span
              class="fv-error-badge"
              :class="{
                'is-danger': error.stage === 'constraint',
                'is-warning': error.stage === 'format',
                'is-info': error.stage === 'loading',
              }"
            >
              {{ error.stage }}
            </span>
            <span class="fv-error-type">{{
              validationErrorTypeLabel(t, error.check_type || error.error_type)
            }}</span>
          </div>
          <p class="fv-error-msg">{{ localizedErrorText(t, error) }}</p>
          <p v-if="error.suggestion" class="fv-error-suggestion">
            {{ t('common.fullValidation.result.suggestion') }}: {{ error.suggestion }}
          </p>
          <div class="fv-error-meta">
            <span v-if="error.location" class="fv-error-location">{{ error.location }}</span>
          </div>
          <!-- 单击展开的详情区：完整位置 / 原始值 / 错误码（有才显示） -->
          <div v-if="expandedRowKey === error.key" class="fv-error-detail">
            <div v-if="error.location" class="fv-error-detail-location">
              {{ error.location }}
            </div>
            <code v-if="error.value" class="fv-error-detail-value">{{ error.value }}</code>
            <span v-if="error.error_code" class="fv-error-detail-code">{{ error.error_code }}</span>
          </div>
        </div>
        <!-- 已定位徽标：定位成功后显示，替代整行淡化，明确表示"这条已在画布确认" -->
        <span v-if="locatedKeys?.has(error.key)" class="fv-error-located-badge">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {{ t('common.fullValidation.result.located') }}
        </span>
        <button
          class="fv-error-navigate ui-btn ui-btn--ghost ui-btn--xs"
          type="button"
          :title="t('common.fullValidation.result.locateOnCanvas')"
          :aria-label="t('common.fullValidation.result.locateOnCanvas')"
          @click.stop="emit('navigate', error)"
        >
          <!-- 靶心定位图标：外圈 + 中心点 + 十字刻度线 -->
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="22" y1="12" x2="18" y2="12" />
            <line x1="6" y1="12" x2="2" y2="12" />
            <line x1="12" y1="6" x2="12" y2="2" />
            <line x1="12" y1="22" x2="12" y2="18" />
            <circle cx="12" cy="12" r="1" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
