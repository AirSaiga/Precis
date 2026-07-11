<!--
  @file RegexDesignModal.vue
  @description 正则表达式设计模态框

  提供交互式的正则表达式设计和测试环境：
  - 规则配置面板：编辑正则模式、匹配规则、参数定义
  - 实时预览：在样例数据上测试正则匹配效果
  - 匹配结果展示：高亮匹配成功的文本片段
  - 支持多规则和参数化正则

  通过 graphStore 的 regexDesign 模块管理状态。
-->

<template>
  <Transition name="modal-fade">
    <div v-show="visible" ref="panelRef" class="regex-design-modal" :style="panelStyle" @click.stop>
      <header class="modal-header" @mousedown="onDragStart">
        <div class="header-left">
          <h2>{{ t('regexDesignModal.title') }}</h2>
          <input
            v-if="activeRule"
            type="text"
            :value="activeRule.name"
            class="header-name-input"
            :placeholder="t('expressions.ruleConfigPanel.ruleNamePlaceholder')"
            @input="handleNameInput"
            @mousedown.stop
          />
        </div>
        <div class="header-right">
          <button class="save-btn" @click.stop="handleSave">
            {{ t('regexDesignModal.save') }}
          </button>
          <button class="close-btn" @click.stop="handleClose" :title="t('regexDesignModal.cancel')">
            ×
          </button>
        </div>
      </header>

      <div class="modal-content">
        <div class="config-panel">
          <RuleConfigPanel
            v-if="activeRule"
            :rule="activeRule"
            :sample-text="currentSampleText"
            :flags="props.ruleData?.flags"
            @update:rule="handleRuleUpdate"
            @save-all="handleSaveAll"
          />
          <div v-else class="empty-state">
            <div class="empty-icon">.*</div>
            <div class="empty-text">{{ t('regexDesignModal.selectOrAddRule') }}</div>
            <button class="add-rule-btn" @click="initDefaultRule">
              {{ t('regexDesignModal.addRule') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
  import RuleConfigPanel from './RuleConfigPanel.vue'
  import type { RegexNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useRegexDesignModal } from '@/features/regex/composables/useRegexDesignModal'
  import { useI18n } from 'vue-i18n'

  const { t } = useI18n()

  const props = defineProps<{
    visible: boolean
    ruleData?: RegexNodeData
  }>()

  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'save', ruleData: RegexNodeData): void
  }>()

  const graphStore = useGraphStore()
  const {
    panelRef,
    panelStyle,
    currentSampleText,
    activeRule,
    initDefaultRule,
    onDragStart,
    handleRuleUpdate,
    handleNameInput,
    handleSaveAll,
    handleClose,
    handleSave,
  } = useRegexDesignModal<RegexNodeData>(props, emit, {
    defaultPattern: '^.+$',
    defaultNameKey: 'regexDesignModal.defaultRuleName',
    getActiveNodeId: () => graphStore.activeRegexNodeId,
  })
</script>

<style scoped src="./RegexDesignModal.styles.css"></style>
