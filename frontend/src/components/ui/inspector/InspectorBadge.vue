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
  @file InspectorBadge.vue
  @description Inspector 面板标签徽章

  功能概述：
  - 显示带状态色的徽章标签
  - 支持可选图标和多种状态样式

  Props：
  - text: string — 徽章文字
  - icon: string — 可选图标
  - status: 'connected' | 'disconnected' | 'error' | 'success' | 'warning' | 'default' — 状态样式

  Emits：
  - 无
-->
<template>
  <span class="inspector-badge" :class="`badge-status-${status}`">
    <span v-if="icon" class="badge-icon">{{ icon }}</span>
    <span class="badge-text">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
  interface Props {
    text?: string
    icon?: string
    status?: 'connected' | 'disconnected' | 'error' | 'success' | 'warning' | 'default'
  }

  withDefaults(defineProps<Props>(), {
    text: '',
    icon: '',
    status: 'default',
  })
</script>

<style scoped src="./InspectorBadge.styles.css"></style>
