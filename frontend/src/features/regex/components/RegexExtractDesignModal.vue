<!--
  @file RegexExtractDesignModal.vue
  @description 正则提取设计模态框

  专门用于 regexExtract 节点：
  - 编辑正则表达式与命名捕获组
  - 配置输出映射（派生列）
  - 实时预览匹配效果
  - 保存后自动推导 captureGroups / outputColumns
-->

<template>
  <Transition name="modal-fade">
    <div v-show="visible" ref="panelRef" class="regex-design-modal" :style="panelStyle" @click.stop>
      <header class="modal-header" @mousedown="onDragStart">
        <div class="header-left">
          <h2>{{ t('regexExtractDesignModal.title') }}</h2>
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
            {{ t('regexExtractDesignModal.save') }}
          </button>
          <button
            class="close-btn"
            @click.stop="handleClose"
            :title="t('regexExtractDesignModal.cancel')"
          >
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
            <div class="empty-text">{{ t('regexExtractDesignModal.selectOrAddRule') }}</div>
            <button class="add-rule-btn" @click="initDefaultRule">
              {{ t('regexExtractDesignModal.addRule') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import RuleConfigPanel from './RuleConfigPanel.vue'
  import type { RegexExtractNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useRegexDesignModal } from '@/features/regex/composables/useRegexDesignModal'
  import { parseNamedGroups } from '@/features/regex/composables/regexExtractUtils'

  const props = defineProps<{
    visible: boolean
    ruleData?: RegexExtractNodeData
  }>()

  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'save', ruleData: RegexExtractNodeData): void
  }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()

  function deriveExtractMetadata(data: RegexExtractNodeData): Partial<RegexExtractNodeData> {
    const output = data.rules?.[0]?.output ?? {}
    const outputColumns = Object.keys(output)
    const groupNames = parseNamedGroups(data.pattern || '')
    const seen = new Set<string>()
    const captureGroups: RegexExtractNodeData['captureGroups'] = []
    for (const value of Object.values(output)) {
      const str = String(value || '')
      const match = str.match(/^\{(\w+):(\w+)\}$/)
      if (!match) continue
      const name = match[1] || ''
      if (seen.has(name)) continue
      seen.add(name)
      const groupIndex = groupNames.indexOf(name)
      if (groupIndex >= 0) {
        captureGroups.push({ name, groupIndex: groupIndex + 1 })
      }
    }
    return { captureGroups, outputColumns }
  }

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
  } = useRegexDesignModal<RegexExtractNodeData>(props, emit, {
    defaultPattern: '(?P<name>.+)',
    defaultNameKey: 'regexExtractDesignModal.defaultRuleName',
    getActiveNodeId: () => graphStore.activeRegexExtractNodeId,
    deriveAdditionalData: deriveExtractMetadata,
  })
</script>

<style scoped src="./RegexDesignModal.styles.css"></style>
