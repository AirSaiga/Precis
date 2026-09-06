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
  @file NodeHandle.vue
  @description Vue Flow 连接手柄自定义组件

  功能概述：
  - 统一连接点的尺寸、颜色和样式
  - 管理连接状态（未连接、连接中、已连接）
  - 提供吸附动画和悬停缩放效果
  - 支持多种主题颜色和尺寸

  Props：
  - id: string — 手柄唯一标识
  - type: 'target' | 'source' — 手柄类型
  - position: Position — 手柄方位
  - connected: boolean — 是否已连接
  - snapping: boolean — 是否处于吸附状态
  - color: NodeTheme — 主题颜色
  - title: string — 提示文本
  - size: NodeHandleSize — 尺寸大小
  - topOffset: string — 顶部偏移
  - sideOffset: string — 侧边偏移
  - disabled: boolean — 是否禁用

  Emits：
  - 无
-->
<template>
  <Handle
    :id="id"
    :type="type"
    :position="position"
    :class="handleClasses"
    :style="handleStyle"
    :title="title"
  />
</template>

<script setup lang="ts">
  /**
   * @file NodeHandle.vue
   * @description 节点连接点组件 - 统一管理连接点样式
   *
   * 核心职责：
   * - 统一连接点的尺寸和样式
   * - 管理连接状态（未连接、连接中、已连接）
   * - 提供吸附动画效果
   *
   * 使用方式：
   * <NodeHandle
   *   id="handle-1"
   *   type="target"
   *   position="left"
   *   :connected="isConnected"
   *   :snapping="isSnapping"
   *   color="primary"
   * />
   */

  import { computed } from 'vue'
  import { Handle, Position } from '@vue-flow/core'
  import type { NodeHandleSize, NodeTheme } from './nodeVariants'

  type HandleType = 'target' | 'source'
  type HandlePosition =
    | typeof Position.Left
    | typeof Position.Right
    | typeof Position.Top
    | typeof Position.Bottom

  interface Props {
    id: string
    type?: HandleType
    position?: HandlePosition
    connected?: boolean
    snapping?: boolean
    color?: NodeTheme
    title?: string
    size?: NodeHandleSize
    topOffset?: string
    sideOffset?: string
    disabled?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    type: 'target',
    position: Position.Left,
    connected: false,
    snapping: false,
    color: 'primary',
    title: '',
    size: 'md',
    topOffset: '',
    sideOffset: '',
    disabled: false,
  })

  const handleClasses = computed(() => {
    return [
      'node-handle',
      `node-handle--${props.type}`,
      `node-handle--${props.color}`,
      `node-handle--${props.size}`,
      {
        'is-connected': props.connected,
        'is-snapping': props.snapping,
        'is-disabled': props.disabled,
      },
    ]
  })

  const handleStyle = computed(() => {
    const style: Record<string, string> = {}

    if (props.topOffset) {
      style.top = props.topOffset
    }

    if (props.sideOffset) {
      if (props.position === Position.Left) {
        style.left = props.sideOffset
      } else if (props.position === Position.Right) {
        style.right = props.sideOffset
      } else if (props.position === Position.Top) {
        style.top = props.sideOffset
      } else if (props.position === Position.Bottom) {
        style.bottom = props.sideOffset
      }
    }

    return style
  })
</script>

<style scoped src="./NodeHandle.styles.css"></style>
