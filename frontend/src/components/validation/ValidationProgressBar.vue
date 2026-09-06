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
  interface Props {
    progress: number
    currentTable?: string
    errorsFound: number
  }

  defineProps<Props>()
</script>

<template>
  <div class="fv-progress-wrapper">
    <div class="fv-progress-header">
      <span class="fv-progress-percent">{{ progress }}%</span>
      <span class="fv-progress-status">
        {{ progress < 100 ? '正在校验...' : '校验完成' }}
      </span>
    </div>
    <div class="fv-progress">
      <div class="fv-progress-fill" :style="{ width: `${progress}%` }" />
    </div>
    <div class="fv-progress-meta">
      <span v-if="currentTable" class="fv-progress-table">
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
          <path d="M3 3v18h18" />
          <path d="M7 17v-8h10v8" />
          <path d="M7 13h10" />
          <path d="M7 9h10" />
        </svg>
        {{ currentTable }}
      </span>
      <span class="fv-progress-errors" :class="{ 'has-errors': errorsFound > 0 }">
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
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        已发现错误: {{ errorsFound }}
      </span>
    </div>
  </div>
</template>
