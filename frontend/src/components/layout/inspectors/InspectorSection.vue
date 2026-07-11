<!--
  @file InspectorSection.vue
  @description 属性检查器区块容器组件（自定义组件检查器用）

  这是一个通用的属性面板区块组件，提供统一的布局和样式。
  自定义组件检查器（Schema / ManualData 等）用它组织带标题和徽章的区块。

  与 configDriven/BaseInspector.vue（config-driven 渲染引擎）职责不同：
  - 本组件：提供 title + badge + slot 的静态区块容器
  - configDriven/BaseInspector.vue：遍历 JSON config 的 sections/fields 并按 kind 渲染

  功能概述：
  - 提供带标题和徽章的区块布局
  - 支持"只读"和"可编辑"两种状态徽章
  - 使用插槽（slot）机制支持自定义内容
  - 统一的毛玻璃效果和阴影样式
-->
<template>
  <!-- 属性区块容器 -->
  <div class="inspector-section">
    <!-- 区块标题行 -->
    <h4 class="section-title">
      <!-- 动态标题 -->
      {{ title }}
      <!-- 徽章（可选） -->
      <span v-if="badge" class="section-badge" :class="badgeClass">{{ badge }}</span>
    </h4>
    <!-- 内容插槽，接收父组件传入的内容 -->
    <div class="section-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
  /**
   * 组件属性接口定义
   */
  interface Props {
    /** 区块标题 */
    title: string
    /** 徽章文本（可选） */
    badge?: string
    /** 徽章样式类（可选）：'read-only' 或 'editable' */
    badgeClass?: 'read-only' | 'editable'
  }

  /**
   * 使用 defineProps 声明组件属性
   * Props 接口中的所有属性都是必需的，除了标记为可选的
   */
  defineProps<Props>()
</script>

<style scoped src="./InspectorSection.styles.css"></style>
