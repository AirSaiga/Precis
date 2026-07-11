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
  import { logger } from '@/core/utils/logger'
  import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import RuleConfigPanel from './RuleConfigPanel.vue'
  import type { Rule, RegexExtractNodeData } from '@/features/regex/types'
  import { useGraphStore } from '@/stores/graphStore'
  import { useRegexConnection } from '@/features/regex/composables'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { deepToRaw } from '@/utils/typeHelpers'

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
  const { fetchSampleDataForRegexEdit } = useRegexConnection()
  const { showConfirm } = useGlobalConfirm()

  const panelRef = ref<HTMLElement | null>(null)
  const dragState = ref({ x: 0, y: 0, startX: 0, startY: 0, dragging: false })
  const panelStyle = ref<Record<string, string>>({})

  function onDragStart(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('input, button')) return
    const el = panelRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragState.value = {
      x: rect.left,
      y: rect.top,
      startX: e.clientX,
      startY: e.clientY,
      dragging: true,
    }
    panelStyle.value = {
      position: 'fixed',
      left: rect.left + 'px',
      top: rect.top + 'px',
      right: 'auto',
    }
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }

  function onDragMove(e: MouseEvent) {
    if (!dragState.value.dragging) return
    const dx = e.clientX - dragState.value.startX
    const dy = e.clientY - dragState.value.startY
    panelStyle.value = {
      position: 'fixed',
      left: dragState.value.x + dx + 'px',
      top: dragState.value.y + dy + 'px',
      right: 'auto',
    }
  }

  function onDragEnd() {
    dragState.value.dragging = false
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
  }

  watch(
    () => props.visible,
    (v) => {
      if (v) {
        panelStyle.value = {}
      }
    }
  )

  const currentSampleText = computed(() => graphStore.regexEditSampleData)

  const rules = ref<Rule[]>([])
  const savedRulesSnapshot = ref<string>('')
  const hasUnsavedChanges = computed(() => {
    if (rules.value.length === 0) return false
    return JSON.stringify(rules.value) !== savedRulesSnapshot.value
  })

  const activeRule = computed(() => {
    const rule = rules.value.length > 0 ? rules.value[0] : null
    logger.debug('[RegexExtractDesignModal] activeRule computed:', {
      rulesLength: rules.value.length,
      ruleExists: !!rule,
      ruleId: rule?.id,
      ruleRegex: rule?.regex,
    })
    return rule
  })

  function initDefaultRule() {
    const defaultPattern = props.ruleData?.pattern || '(?P<name>.+)'
    const defaultRule: Rule = {
      id: `rule-${Date.now()}`,
      name: t('regexExtractDesignModal.defaultRuleName'),
      regex: defaultPattern,
      description: '',
      output: {},
    }
    rules.value = [defaultRule]
  }

  function cloneRules(input: unknown): Rule[] {
    // 使用 JSON round-trip 避免 Vue proxy 导致 structuredClone 失败
    try {
      return JSON.parse(JSON.stringify(input)) as Rule[]
    } catch {
      return []
    }
  }

  watch(
    () => props.visible,
    async (isOpened) => {
      if (isOpened) {
        if (props.ruleData && props.ruleData.rules && props.ruleData.rules.length > 0) {
          rules.value = cloneRules(deepToRaw(props.ruleData.rules))
        } else if (props.ruleData?.pattern) {
          const defaultRule: Rule = {
            id: `rule-${Date.now()}`,
            name: props.ruleData.configName || t('regexExtractDesignModal.defaultRuleName'),
            regex: props.ruleData.pattern,
            description: '',
            output: {},
          }
          rules.value = [defaultRule]
        } else {
          initDefaultRule()
        }

        if (!graphStore.regexEditSampleData && graphStore.activeRegexExtractNodeId) {
          await fetchSampleDataForRegexEdit({ regexNodeId: graphStore.activeRegexExtractNodeId })
        }

        await nextTick()
        savedRulesSnapshot.value = JSON.stringify(rules.value)
      }
    },
    { immediate: true }
  )

  function handleRuleUpdate(updatedRule: Rule) {
    const index = rules.value.findIndex((rule) => rule.id === updatedRule.id)
    if (index !== -1) {
      rules.value[index] = { ...deepToRaw(updatedRule) }
    } else {
      logger.warn('[RegexExtractDesignModal] 未找到匹配规则:', updatedRule.id)
    }
  }

  function handleNameInput(event: Event) {
    const name = (event.target as HTMLInputElement).value
    if (activeRule.value) {
      handleRuleUpdate({ ...activeRule.value, name })
    }
  }

  function handleSaveAll() {
    handleSave()
  }

  function handleClose() {
    if (hasUnsavedChanges.value) {
      showConfirm({
        title: t('regexDesignModal.unsavedChangesTitle'),
        message: t('regexDesignModal.unsavedChangesMessage'),
        confirmText: t('regexDesignModal.unsavedChangesConfirm'),
        cancelText: t('regexDesignModal.unsavedChangesCancel'),
        type: 'warning',
      }).then((confirmed) => {
        if (confirmed) emit('close')
      })
      return
    }
    emit('close')
  }

  function handleSave() {
    if (props.ruleData && activeRule.value) {
      const currentRegex = rules.value[0]?.regex || ''
      const clonedRules = cloneRules(deepToRaw(rules.value))

      const updatedRuleData: RegexExtractNodeData = {
        ...props.ruleData,
        pattern: currentRegex,
        rules: clonedRules,
      }

      emit('save', updatedRuleData)
      savedRulesSnapshot.value = JSON.stringify(rules.value)
      handleClose()
    } else {
      logger.warn('[RegexExtractDesignModal] handleSave - 无效数据:', {
        ruleData: props.ruleData,
        activeRule: activeRule.value,
        rules: rules.value,
      })
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!props.visible) return
    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      handleSave()
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
  })
</script>

<style scoped src="./RegexDesignModal.styles.css"></style>
