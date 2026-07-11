/**
 * @file useRegexDesignModal.ts
 * @description Regex / RegexExtract 设计弹窗公共逻辑
 */

import { logger } from '@/core/utils/logger'
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Rule } from '@/features/regex/types'
import { useGraphStore } from '@/stores/graphStore'
import { useRegexConnection } from './useRegexConnection'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { deepToRaw } from '@/utils/typeHelpers'

export interface UseRegexDesignModalOptions<T> {
  defaultPattern: string
  defaultNameKey: string
  getActiveNodeId: () => string | null | undefined
  deriveAdditionalData?: (data: T) => Partial<T>
}

export function useRegexDesignModal<T extends Record<string, unknown>>(
  props: { visible: boolean; ruleData?: T },
  emit: ((event: 'close') => void) & ((event: 'save', data: T) => void),
  options: UseRegexDesignModalOptions<T>
) {
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
      if (v) panelStyle.value = {}
    }
  )

  const currentSampleText = computed(() => graphStore.regexEditSampleData)
  const rules = ref<Rule[]>([])
  const savedRulesSnapshot = ref<string>('')
  const hasUnsavedChanges = computed(() => {
    if (rules.value.length === 0) return false
    return JSON.stringify(rules.value) !== savedRulesSnapshot.value
  })
  const activeRule = computed(() => (rules.value.length > 0 ? rules.value[0] : null))

  function cloneRules(input: unknown): Rule[] {
    try {
      return JSON.parse(JSON.stringify(input)) as Rule[]
    } catch {
      return []
    }
  }

  function initDefaultRule() {
    const defaultPattern =
      (props.ruleData as { pattern?: string } | undefined)?.pattern || options.defaultPattern
    const defaultRule: Rule = {
      id: `rule-${Date.now()}`,
      name: t(options.defaultNameKey),
      regex: defaultPattern,
      description: '',
      output: {},
    }
    rules.value = [defaultRule]
  }

  watch(
    () => props.visible,
    async (isOpened) => {
      if (!isOpened) return
      const ruleData = props.ruleData as
        | { rules?: Rule[]; pattern?: string; configName?: string }
        | undefined
      if (ruleData?.rules && ruleData.rules.length > 0) {
        rules.value = cloneRules(deepToRaw(ruleData.rules))
      } else if (ruleData?.pattern) {
        rules.value = [
          {
            id: `rule-${Date.now()}`,
            name: ruleData.configName || t(options.defaultNameKey),
            regex: ruleData.pattern,
            description: '',
            output: {},
          },
        ]
      } else {
        initDefaultRule()
      }

      const activeNodeId = options.getActiveNodeId()
      if (!graphStore.regexEditSampleData && activeNodeId) {
        await fetchSampleDataForRegexEdit({ regexNodeId: activeNodeId })
      }

      await nextTick()
      savedRulesSnapshot.value = JSON.stringify(rules.value)
    },
    { immediate: true }
  )

  function handleRuleUpdate(updatedRule: Rule) {
    const index = rules.value.findIndex((rule) => rule.id === updatedRule.id)
    if (index !== -1) {
      rules.value[index] = { ...deepToRaw(updatedRule) }
    } else {
      logger.warn('[useRegexDesignModal] rule not found:', updatedRule.id)
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

  function buildSavePayload(): T | null {
    if (!props.ruleData || !activeRule.value) {
      logger.warn('[useRegexDesignModal] invalid save state')
      return null
    }
    const currentRegex = rules.value[0]?.regex || ''
    const clonedRules = cloneRules(deepToRaw(rules.value))
    const base = {
      ...(props.ruleData as Record<string, unknown>),
      pattern: currentRegex,
      rules: clonedRules,
    }
    const additional = options.deriveAdditionalData?.(base as unknown as T) ?? {}
    return { ...base, ...additional } as unknown as T
  }

  function handleSave() {
    const payload = buildSavePayload()
    if (!payload) return
    emit('save', payload)
    savedRulesSnapshot.value = JSON.stringify(rules.value)
    handleClose()
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

  onMounted(() => document.addEventListener('keydown', handleKeydown))
  onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

  return {
    panelRef,
    panelStyle,
    currentSampleText,
    rules,
    activeRule,
    hasUnsavedChanges,
    onDragStart,
    initDefaultRule,
    handleRuleUpdate,
    handleNameInput,
    handleSaveAll,
    handleClose,
    handleSave,
  }
}
