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
  import { computed } from 'vue'
  import { getIcon } from './iconRegistry'
  import { logger } from '@/core/utils/logger'

  interface Props {
    /** 业务图标名（见 iconRegistry.ts） */
    name: string
    /** 图标尺寸，默认 16 */
    size?: number | string
    /** stroke-width，默认 2（与现有内联 SVG 一致） */
    strokeWidth?: number
  }

  const props = withDefaults(defineProps<Props>(), {
    size: 16,
    strokeWidth: 2,
  })

  const comp = computed(() => getIcon(props.name))

  if (import.meta.env.DEV && !comp.value) {
    logger.warn(`[AppIcon] 未找到图标名: ${props.name}`)
  }
</script>

<template>
  <component :is="comp" v-if="comp" :size="size" :stroke-width="strokeWidth" class="app-icon" />
  <!-- 找不到图标时不渲染（开发期通过 console.warn 提示） -->
</template>

<style scoped>
  .app-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }
</style>
