/** * @file ConstraintDashboardNode.vue * @description 约束仪表板节点组件 * * 核心功能： * -
显示约束规则的仪表板视图 * - 展示所有约束规则的概览信息 * - 提供约束规则的统计和状态展示 * -
支持快速导航到具体约束节点 * * 节点结构： * - Header：仪表板图标、标题 * - Stats：约束规则统计信息 *
- Quick Links：快速导航链接 */
<template>
  <div class="constraint-dashboard-node graph-node" :class="{ 'is-selected': selected }">
    <div class="header">
      <span class="icon">📋</span>
      <span class="title">{{ t('customNodes.constraintDashboardNode.title') }}</span>
      <span v-if="data.items?.length" class="count">{{ data.items.length }}</span>
    </div>

    <div class="content-body">
      <div v-if="!data.items || data.items.length === 0" class="empty">
        {{ t('customNodes.constraintDashboardNode.empty') }}
      </div>

      <div v-else class="list">
        <button
          v-for="item in data.items"
          :key="item.id"
          class="row"
          type="button"
          @click="focus(item.relatedSchemaIds)"
          :title="item.name"
        >
          <span class="name">{{ item.name }}</span>
          <span class="type">{{ item.type || '-' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { eventBus } from '@/core/eventBus'

  const { t } = useI18n()

  defineProps<{
    data: {
      items: Array<{ id: string; name: string; type?: string; relatedSchemaIds: string[] }>
    }
    selected?: boolean
  }>()

  const focus = (nodeIds: string[]) => {
    eventBus.emit('focus-canvas-nodes', { nodeIds })
  }
</script>

<style scoped src="./ConstraintDashboardNode.styles.css"></style>
