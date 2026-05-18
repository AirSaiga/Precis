/** * @file ConstraintNodeLayout.vue * @description 约束节点统一布局组件 * * 核心功能： * -
提供约束节点统一的内部布局结构 * - 统一间距、字体、颜色等视觉规范 * -
支持灵活的插槽配置，适配各种约束类型 * * 布局结构（从上到下）： * 1. 信息区 (info-section):
源表/列等基础信息，标签左对齐，值右对齐 * 2. 配置预览区 (config-preview):
约束配置的可视化展示（区间、允许值等） * 3. 状态区 (status-section): 校验状态指示器 * 4. 引导提示区
(guide-section): 选中时的编辑提示 * 5. 详情区 (details-section): 校验结果详情（选中或出错时显示） */
<template>
  <div class="constraint-node-layout" :class="{ 'is-compact': compact }">
    <!-- 信息区：展示源表/列等基础信息 -->
    <div v-if="$slots.info" class="section info-section">
      <slot name="info" />
    </div>

    <!-- 配置预览区：约束配置的视觉展示 -->
    <div v-if="$slots.preview" class="section preview-section">
      <slot name="preview" />
    </div>

    <!-- 状态区：校验状态指示 -->
    <div class="section status-section">
      <div class="status-row">
        <span class="status-dot" :class="'status-' + status" />
        <span class="status-text">{{ statusText }}</span>
        <NodeBadge
          v-if="errorCount > 0"
          type="danger"
          variant="soft"
          size="sm"
          :count="errorCount"
        />
      </div>
    </div>

    <!-- 引导提示区：选中时显示编辑提示 -->
    <div v-if="showGuide && $slots.guide" class="section guide-section">
      <slot name="guide" />
    </div>

    <!-- 详情区：校验结果详情 -->
    <div v-if="showDetails" class="section details-section">
      <slot name="details" />
    </div>
  </div>
</template>

<script setup lang="ts">
  import NodeBadge from '@/components/ui/NodeBadge.vue'

  interface Props {
    /** 校验状态 */
    status: string
    /** 状态文本 */
    statusText: string
    /** 错误数量 */
    errorCount?: number
    /** 是否显示引导提示 */
    showGuide?: boolean
    /** 是否显示详情 */
    showDetails?: boolean
    /** 紧凑模式（减少间距） */
    compact?: boolean
  }

  withDefaults(defineProps<Props>(), {
    errorCount: 0,
    showGuide: false,
    showDetails: false,
    compact: false,
  })
</script>

<style scoped src="./ConstraintNodeLayout.styles.css"></style>
