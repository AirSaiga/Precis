<!--
  @file RuleList.vue
  @description 正则规则列表组件

  功能概述：
  - 展示 Patterns 分组下的规则列表
  - 支持规则选择和添加新规则

  Props：
  - patterns: Rule[] — 规则列表
  - activeRule: Rule | null — 当前选中规则

  Emits：
  - select: [rule: Rule] — 选中规则
  - add: [group: string] — 添加规则到指定分组
-->
<template>
  <div class="rule-list">
    <!-- Patterns 分组 -->
    <div class="rule-group">
      <div class="group-header">
        <h3><span class="icon-folder"></span> {{ t('expressions.ruleList.patterns') }}</h3>
        <button
          class="add-btn"
          @click="$emit('add', 'patterns')"
          :title="t('expressions.ruleList.addPattern')"
        >
          <span class="icon-add">+</span>
        </button>
      </div>
      <ul>
        <li
          v-for="rule in patterns"
          :key="rule.name"
          :class="{ active: rule === activeRule }"
          @click="$emit('select', rule)"
        >
          {{ rule.name }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import type { Rule } from '@/features/regex/types'

  defineProps<{
    patterns: Rule[]
    activeRule: Rule | null
  }>()
  defineEmits(['select', 'add'])

  const { t } = useI18n()
</script>

<style scoped src="./RuleList.styles.css"></style>
