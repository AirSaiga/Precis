<!--
  @file RuleConfigPanel.vue
  @description 正则规则配置面板

  RegexDesignModal 的核心子组件，负责正则规则的详细配置：
  - 规则名称和正则表达式编辑
  - 匹配模式选择（full/partial/extract）
  - 参数定义和类型配置
  - 样例数据实时匹配预览
  - 规则启用/禁用控制
-->

<template>
  <div class="rule-config-panel">
    <!-- 正则表达式（最顶部，最显眼） -->
    <div class="regex-bar">
      <span class="regex-marker">/</span>
      <input
        type="text"
        v-model="localRegex"
        class="regex-input"
        spellcheck="false"
        :placeholder="t('expressions.ruleConfigPanel.regexPlaceholder')"
        @input="handleManualRegexInput"
      />
      <span class="regex-marker">/g</span>
    </div>

    <!-- 样例文本输入 -->
    <div class="section">
      <textarea
        v-model="inputText"
        class="sample-textarea"
        :placeholder="t('expressions.interactiveBuilder.exampleText')"
        @mouseup="handleTextSelection"
        @keyup="handleTextSelection"
      ></textarea>
    </div>

    <!-- 选中文本提示 -->
    <div v-if="selectedText" class="selection-bar">
      <span class="selection-label"
        >{{ t('expressions.interactiveBuilder.previewSelection') }}:</span
      >
      <span class="selection-text">{{ selectedText }}</span>
      <button @click="clearSelection" class="selection-clear">&times;</button>
    </div>

    <!-- 构建器预览 -->
    <div v-if="patternParts.length > 0" class="section preview-section">
      <div class="preview-parts">
        <span
          v-for="(part, index) in patternParts"
          :key="index"
          :class="part.type === 'param' ? 'part-param' : 'part-static'"
        >
          {{ getPartDisplayText(part) }}
        </span>
      </div>
    </div>

    <!-- 匹配高亮预览 -->
    <div v-if="matchSegments.length > 0" class="section match-section">
      <div class="match-text">
        <span
          v-for="(seg, i) in matchSegments"
          :key="i"
          :class="seg.isMatch ? 'seg-match' : 'seg-plain'"
          >{{ seg.text }}</span
        >
      </div>
    </div>

    <!-- 输出映射 -->
    <div class="section mapping-section">
      <div class="mapping-header">
        <span class="mapping-title">{{ t('expressions.ruleConfigPanel.outputMapping') }}</span>
        <button class="add-btn" @click="addOutputKey">
          + {{ t('expressions.ruleConfigPanel.addKeyValue') }}
        </button>
      </div>

      <div v-if="!rule.output || Object.keys(rule.output).length === 0" class="mapping-empty">
        {{ t('expressions.ruleConfigPanel.clickToAddFirst') }}
      </div>

      <div v-else class="mapping-list">
        <div
          v-for="(value, key) in rule.output"
          :key="key"
          class="mapping-card"
          :class="{ 'is-param': isParamValue(value) }"
        >
          <div class="card-row">
            <input
              type="text"
              :value="key"
              class="card-key"
              @change="updateOutputKey(String(key), ($event.target as HTMLInputElement).value)"
            />
            <div class="card-mode">
              <button
                class="mode-btn"
                :class="{ active: !isParamValue(value) }"
                @click="updateOutputValue(String(key), String(value))"
              >
                Aa
              </button>
              <button
                class="mode-btn"
                :class="{ active: isParamValue(value) }"
                :disabled="availableParams.length === 0"
                @click="updateOutputParam(String(key), availableParams[0]?.name || '')"
              >
                .*
              </button>
            </div>
            <button class="card-del" @click="removeOutputKey(String(key))">&times;</button>
          </div>
          <div class="card-detail">
            <template v-if="isParamValue(value)">
              <select
                class="card-select"
                @change="updateOutputParam(String(key), ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="availableParams.length === 0" disabled value="">
                  {{ t('expressions.ruleConfigPanel.noNamedGroups') }}
                </option>
                <option
                  v-for="p in availableParams"
                  :key="p.name"
                  :value="p.name"
                  :selected="getParamName(String(value)) === p.name"
                >
                  {{ p.name }}
                </option>
              </select>
              <div class="type-pills">
                <button
                  v-for="typeOpt in ['string', 'int', 'float']"
                  :key="typeOpt"
                  class="type-pill"
                  :class="{ active: getParamType(String(value)) === typeOpt }"
                  @click="updateOutputType(String(key), typeOpt)"
                >
                  {{ typeOpt.toUpperCase() }}
                </button>
              </div>
            </template>
            <input
              v-else
              type="text"
              :value="String(value)"
              class="card-static"
              :placeholder="t('expressions.ruleConfigPanel.staticValuePlaceholder')"
              @input="updateOutputValue(String(key), ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 弹窗（悬浮） -->
    <SelectionPopover
      v-if="selection.text"
      :selection="selection"
      :container-ref="containerRef"
      @define-as-param="defineAsParam"
      @clear="clearSelection"
    />
    <ParamDefinitionModal
      v-if="isDefiningParam"
      @confirm="confirmParamDefinition($event)"
      @cancel="isDefiningParam = false"
    />
    <div ref="containerRef" style="display: none"></div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, watch, computed, reactive, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { Rule } from '@/features/regex/types'
  import SelectionPopover from './SelectionPopover.vue'
  import ParamDefinitionModal from './ParamDefinitionModal.vue'
  import { useToast } from '@/composables/shared/useToast'

  const props = defineProps<{
    rule: Rule
    sampleText?: string
  }>()
  const emit = defineEmits<{
    (e: 'update:rule', rule: Rule): void
    (e: 'save-all'): void
  }>()

  const { t } = useI18n()
  const toast = useToast()

  // --- Regex state ---
  const localRegex = ref(props.rule.regex || '')

  // --- Pattern parts (builder state) ---
  interface PatternPart {
    type: 'static' | 'param'
    text?: string
    name?: string
    paramType?: string
  }
  const patternParts = ref<PatternPart[]>([])

  // --- Selection state ---
  interface SelectionInfo {
    text: string
    start: number
    end: number
    x: number
    y: number
  }
  const selection = reactive<SelectionInfo>({ text: '', start: 0, end: 0, x: 0, y: 0 })
  const selectedText = ref('')
  const isDefiningParam = ref(false)
  const paramDefinition = reactive({ name: '', type: 'int' })
  const containerRef = ref<HTMLElement | null>(null)
  const isUpdatingFromParamDefinition = ref(false)

  // --- Params ---
  interface ParamInfo {
    name: string
    type: string
  }
  const availableParams = ref<ParamInfo[]>([])

  const parseRegexParams = (regex: string): string[] => {
    if (!regex) return []
    const matches = [...regex.matchAll(/\(\?P<(\w+)>/g)]
    return matches.map((m) => m[1] ?? '')
  }

  // --- Textarea text (local, synced with sampleText) ---
  const inputText = ref('')

  watch(
    () => props.sampleText,
    (newText) => {
      if (newText && newText.trim()) {
        inputText.value = newText
        patternParts.value = [{ type: 'static', text: newText }]
        emit('update:rule', { ...props.rule, regex: '', output: props.rule.output })
      }
    },
    { immediate: true }
  )

  // Sync regex from props
  watch(
    () => props.rule.regex,
    (val) => {
      const newVal = val ?? ''
      if (newVal !== localRegex.value) {
        localRegex.value = newVal
      }
      const extractedParams = parseRegexParams(newVal)
      const existingNames = new Set(availableParams.value.map((p) => p.name))
      for (const name of extractedParams) {
        if (!existingNames.has(name)) {
          availableParams.value.push({ name: name ?? '', type: 'string' })
        }
      }
    },
    { immediate: true }
  )

  // Watch inputText changes — reset to static if user edits
  watch(inputText, (newText) => {
    if (isUpdatingFromParamDefinition.value) return
    const currentPartsText = patternParts.value.map((p) => p.text || '').join('')
    if (currentPartsText !== newText) {
      patternParts.value = [{ type: 'static', text: newText }]
      emit('update:rule', { ...props.rule, regex: '', output: props.rule.output })
    }
  })

  // --- Text selection ---
  function handleTextSelection() {
    const el = document.activeElement
    if (!(el instanceof HTMLTextAreaElement)) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const text = el.value.substring(start, end)
    if (text && start !== end && text.trim().length > 0) {
      selection.text = text
      selection.start = start
      selection.end = end
      const rect = el.getBoundingClientRect()
      selection.x = rect.left + 20
      selection.y = rect.top + 40
      selectedText.value = text
    } else {
      clearSelection()
    }
  }

  function clearSelection() {
    selection.text = ''
    selectedText.value = ''
  }

  function defineAsParam() {
    paramDefinition.name = ''
    isDefiningParam.value = true
  }

  function confirmParamDefinition(payload?: { name: string; type: string }) {
    if (payload) Object.assign(paramDefinition, payload)
    if (!paramDefinition.name.trim()) {
      toast.warning(t('expressions.paramDefinitionModal.paramNameCannotBeEmpty'))
      return
    }
    isDefiningParam.value = false
    isUpdatingFromParamDefinition.value = true

    const start = selection.start
    const end = selection.end
    const currentInputValue = inputText.value

    const charMap: {
      char: string
      type: 'static' | 'param'
      paramInfo?: { name: string; paramType: string }
    }[] = []
    for (const part of patternParts.value) {
      const pText = part.text || ''
      for (const char of pText) {
        charMap.push({
          char,
          type: part.type,
          paramInfo:
            part.type === 'param' ? { name: part.name!, paramType: part.paramType! } : undefined,
        })
      }
    }

    if (charMap.length !== currentInputValue.length) {
      charMap.length = 0
      for (const char of currentInputValue) {
        charMap.push({ char, type: 'static' })
      }
    }

    for (let i = start; i < end; i++) {
      const item = charMap[i]
      if (item) {
        item.type = 'param'
        item.paramInfo = { name: paramDefinition.name, paramType: paramDefinition.type }
      }
    }

    const newParts: PatternPart[] = []
    let currentPart: PatternPart | null = null
    for (let i = 0; i < charMap.length; i++) {
      const c = charMap[i]
      if (!c) continue
      const isParam = c.type === 'param'
      const paramName = isParam ? c.paramInfo?.name : undefined
      let shouldStartNew = false
      if (!currentPart) {
        shouldStartNew = true
      } else if (currentPart.type !== c.type) {
        shouldStartNew = true
      } else if (isParam && currentPart.name !== paramName) {
        shouldStartNew = true
      }
      if (shouldStartNew) {
        if (currentPart) newParts.push(currentPart)
        currentPart = {
          type: c.type,
          text: c.char,
          ...(isParam && c.paramInfo ? { name: paramName, paramType: c.paramInfo.paramType } : {}),
        }
      } else {
        if (currentPart) currentPart.text += c.char
      }
    }
    if (currentPart) newParts.push(currentPart)

    patternParts.value = newParts
    clearSelection()

    nextTick(() => {
      updateAndEmit()
      isUpdatingFromParamDefinition.value = false
    })
  }

  // --- Compute and emit regex ---
  function updateAndEmit() {
    const generatedParams: { name: string; type: string }[] = []
    const regexParts = patternParts.value.map((p) => {
      if (p.type === 'static') {
        return p.text?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }
      const paramName = p.name as string
      const paramType = p.paramType || 'word'
      if (!generatedParams.some((gp) => gp.name === paramName)) {
        generatedParams.push({ name: paramName, type: paramType })
      }
      const regexMap: Record<string, string> = {
        int: '(-?\\d+)',
        float: '(-?\\d+(?:\\.\\d+)?)',
        word: '(\\w+)',
        non_space: '\\S+',
        anything: '.*?',
      }
      return `(?P<${paramName}>${regexMap[paramType] || '(.*?)'})`
    })
    const finalRegex = regexParts.join('')
    localRegex.value = finalRegex
    emit('update:rule', { ...props.rule, regex: finalRegex, output: props.rule.output })

    // Also update available params and auto-generate output mapping
    handleParamsUpdate(generatedParams)
  }

  // --- Match highlight ---
  interface MatchSegment {
    text: string
    isMatch: boolean
  }

  const matchSegments = computed<MatchSegment[]>(() => {
    if (!inputText.value || patternParts.value.length === 0) return []
    const regexParts = patternParts.value.map((p) => {
      if (p.type === 'static') return p.text?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const paramType = p.paramType || 'word'
      const regexMap: Record<string, string> = {
        int: '(-?\\d+)',
        float: '(-?\\d+(?:\\.\\d+)?)',
        word: '(\\w+)',
        non_space: '\\S+',
        anything: '.*?',
      }
      return `(?P<${p.name}>${regexMap[paramType] || '(.*?)'})`
    })
    const finalRegex = regexParts.join('')
    if (!finalRegex) return []
    const jsRegex = finalRegex.replace(/\(\?P</g, '(?<')
    try {
      const re = new RegExp(jsRegex, 'g')
      const segments: MatchSegment[] = []
      let lastIndex = 0
      for (const match of inputText.value.matchAll(re)) {
        const matchStart = match.index!
        const matchEnd = matchStart + match[0].length
        if (matchStart > lastIndex) {
          segments.push({ text: inputText.value.slice(lastIndex, matchStart), isMatch: false })
        }
        segments.push({ text: match[0], isMatch: true })
        lastIndex = matchEnd
      }
      if (lastIndex < inputText.value.length) {
        segments.push({ text: inputText.value.slice(lastIndex), isMatch: false })
      }
      return segments
    } catch {
      return []
    }
  })

  // --- Regex input handler ---
  function handleManualRegexInput(e: Event) {
    const val = (e.target as HTMLInputElement).value
    localRegex.value = val
    emit('update:rule', { ...props.rule, regex: val, output: props.rule.output })
  }

  // --- Params + output mapping sync ---
  function handleParamsUpdate(newParams: { name: string; type: string }[]) {
    const newParamList = newParams.map((p) => ({ name: p.name, type: p.type || 'string' }))
    const existingOutput = props.rule.output || {}
    const newOutput: Record<string, string> = { ...existingOutput }
    const newParamNames = newParamList.map((p) => p.name)
    const newParamMap = new Map(newParamList.map((p) => [p.name, p.type]))
    let hasChanges = false

    for (const [key, value] of Object.entries(newOutput)) {
      if (isParamValue(value)) {
        const paramName = getParamName(value)
        if (!newParamNames.includes(paramName)) {
          delete newOutput[key]
          hasChanges = true
        } else {
          const paramType = newParamMap.get(paramName)
          const currentType = getParamType(value)
          if (paramType && paramType !== currentType) {
            newOutput[key] = `{${paramName}:${paramType}}`
            hasChanges = true
          }
        }
      }
    }
    for (const param of newParamList) {
      if (!newOutput[param.name]) {
        newOutput[param.name] = `{${param.name}:${param.type}}`
        hasChanges = true
      }
    }
    availableParams.value = newParamList
    if (hasChanges) {
      emit('update:rule', { ...props.rule, output: newOutput, regex: localRegex.value })
    }
  }

  // --- Output mapping CRUD ---
  function addOutputKey() {
    const nextOutput = { ...(props.rule.output || {}) }
    const makeUniqueKey = (base: string) => {
      const b = String(base || '').trim() || 'field'
      if (!nextOutput[b]) return b
      let i = 2
      while (nextOutput[`${b}_${i}`]) i++
      return `${b}_${i}`
    }
    const firstParam = availableParams.value[0]
    const defaultKeyBase = firstParam ? firstParam.name : 'field'
    const newKey = makeUniqueKey(defaultKeyBase)
    nextOutput[newKey] = firstParam ? `{${firstParam.name}:${firstParam.type}}` : ''
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  function removeOutputKey(key: string) {
    const nextOutput = { ...(props.rule.output || {}) }
    delete nextOutput[key]
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  function updateOutputKey(oldKey: string, newKey: string) {
    if (!newKey || oldKey === newKey) return
    const nextOutput = { ...(props.rule.output || {}) }
    if (nextOutput[newKey]) {
      toast.error(
        t('common.error'),
        t('expressions.ruleConfigPanel.keyAlreadyExists', { key: newKey })
      )
      return
    }
    const oldVal = nextOutput[oldKey]
    if (oldVal !== undefined) {
      nextOutput[newKey] = oldVal
    }
    delete nextOutput[oldKey]
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  function updateOutputValue(key: string, val: string) {
    const nextOutput = { ...(props.rule.output || {}) }
    nextOutput[key] = val
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  function updateOutputParam(key: string, paramName: string) {
    const nextOutput = { ...(props.rule.output || {}) }
    const currentType = getParamType(String(nextOutput[key]))
    if (/^field_\d+$/.test(key) && !nextOutput[paramName]) {
      nextOutput[paramName] = `{${paramName}:${currentType}}`
      delete nextOutput[key]
    } else {
      nextOutput[key] = `{${paramName}:${currentType}}`
    }
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  function updateOutputType(key: string, type: string) {
    const nextOutput = { ...(props.rule.output || {}) }
    const currentParam = getParamName(String(nextOutput[key]))
    nextOutput[key] = `{${currentParam}:${type}}`
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  // --- Helpers ---
  function isParamValue(v: unknown): boolean {
    return typeof v === 'string' && /^\{\w+:\w+\}$/.test(v)
  }
  function getParamName(v: string): string {
    const match = v.match(/^\{(\w+):/)
    return match && match[1] ? match[1] : ''
  }
  function getParamType(v: string): string {
    const match = v.match(/:(\w+)\}$/)
    return match && match[1] ? match[1] : 'string'
  }
  function getPartDisplayText(part: PatternPart): string {
    return part.type === 'param' ? '{' + part.name + '}' : part.text || ''
  }
</script>

<style scoped src="./RuleConfigPanel.styles.css" />
