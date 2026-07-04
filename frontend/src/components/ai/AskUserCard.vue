<!--
  @file AskUserCard.vue
  @description ask_user 交互问答卡

  按 question_type 渲染不同输入控件：
  - free_text：多行文本框
  - choice：单选/多选（radio/checkbox）
  - value：integer/float/boolean/string 输入（带类型校验）
  - confirm：Yes/No 两按钮（无通用操作栏）

  已答态（answered=true）折叠为单行摘要（来自 lastAskSummary）。

  Props:
    - ask: PendingAsk | null 挂起的提问（已答态时为 null）
    - answered: boolean 是否已回答
    - answerSummary: string | null 已答态展示的摘要（来自 lastAskSummary）

  Emits:
    - respond: (askId, response) 提交回答/skip
-->

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { PendingAsk } from '@/composables/shared/useStreamingMessage'

  /** ask_user 回答的响应体（POST /respond 的 response 字段） */
  export interface AskResponseBody {
    answer?: string | number | boolean | string[]
    skipped?: boolean
    reason?: string
  }

  interface Props {
    /** 挂起的提问（已答态时为 null） */
    ask: PendingAsk | null
    /** 是否已回答（true 时卡片转已答态，不可交互） */
    answered: boolean
    /** 已答态展示的回答摘要（来自 lastAskSummary） */
    answerSummary?: string | null
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    respond: [askId: string, response: AskResponseBody]
  }>()

  const { t } = useI18n()
  const submitting = ref(false)
  // free_text / value 输入
  const textInput = ref('')
  // choice 选中值
  const selectedSingle = ref<string>('')
  const selectedMultiple = ref<string[]>([])
  // value(boolean) toggle
  const boolValue = ref<boolean>(false)

  /** value 类型的输入合法性（integer/float 正则校验） */
  const isInvalid = computed(() => {
    if (props.ask?.questionType !== 'value') return false
    const vt = props.ask.valueType
    if (vt === 'integer') return textInput.value !== '' && !/^-?\d+$/.test(textInput.value)
    if (vt === 'float') return textInput.value !== '' && !/^-?\d+(\.\d+)?$/.test(textInput.value)
    return false
  })

  /** 提交按钮是否可用 */
  const canSubmit = computed(() => {
    if (submitting.value || props.answered) return false
    const qt = props.ask?.questionType
    if (qt === 'choice') {
      if (props.ask?.multiple) return selectedMultiple.value.length > 0
      return selectedSingle.value !== ''
    }
    if (qt === 'value' && !props.ask?.optional) {
      return textInput.value !== '' && !isInvalid.value
    }
    return true
  })

  /** 构造提交响应体并 emit */
  async function handleSubmit() {
    if (!props.ask || !canSubmit.value) return
    submitting.value = true
    try {
      const qt = props.ask.questionType
      let response: AskResponseBody
      if (qt === 'free_text') {
        response = { answer: textInput.value }
      } else if (qt === 'choice') {
        response = props.ask.multiple
          ? { answer: selectedMultiple.value }
          : { answer: selectedSingle.value }
      } else if (qt === 'value') {
        const vt = props.ask.valueType
        let val: string | number | boolean
        if (vt === 'integer') val = parseInt(textInput.value, 10)
        else if (vt === 'float') val = parseFloat(textInput.value)
        else if (vt === 'boolean') val = boolValue.value
        else val = textInput.value
        response = { answer: val }
      } else {
        // confirm
        response = { answer: true }
      }
      emit('respond', props.ask.askId, response)
    } finally {
      submitting.value = false
    }
  }

  /** 跳过：emit skipped 响应 */
  async function handleSkip() {
    if (!props.ask || submitting.value || props.answered) return
    submitting.value = true
    try {
      emit('respond', props.ask.askId, { skipped: true, reason: 'user_skipped' })
    } finally {
      submitting.value = false
    }
  }

  // confirm 型的两个按钮
  function handleConfirmYes() {
    if (!props.ask) return
    emit('respond', props.ask.askId, { answer: true })
  }
  function handleConfirmNo() {
    if (!props.ask) return
    emit('respond', props.ask.askId, { answer: false })
  }

  /** 已答态展示的摘要文本 */
  const summaryText = computed(() => {
    if (!props.answered) return ''
    const s = props.answerSummary
    if (!s) return t('aiChat.askAnswered')
    if (s.startsWith('skipped:timeout')) return t('aiChat.askTimeout')
    if (s.startsWith('skipped:')) return t('aiChat.askSkipped')
    return s
  })
</script>

<template>
  <div v-if="ask || answered" class="ask-user-card">
    <!-- 已答态：折叠摘要 -->
    <div v-if="answered" class="ask-answered">
      <span class="ask-answered-icon">✓</span>
      <span class="ask-answered-text">{{ summaryText }}</span>
    </div>

    <!-- 等待回答态 -->
    <div v-else-if="ask" class="ask-active">
      <div class="ask-prompt">{{ ask.prompt }}</div>

      <!-- free_text -->
      <textarea
        v-if="ask.questionType === 'free_text'"
        v-model="textInput"
        class="ask-textarea"
        :placeholder="ask.placeholder || t('aiChat.askPlaceholder')"
        :disabled="submitting"
        rows="2"
      />

      <!-- choice -->
      <div v-else-if="ask.questionType === 'choice'" class="ask-options">
        <template v-if="ask.multiple">
          <label v-for="opt in ask.options" :key="opt.value" class="ask-option">
            <input
              v-model="selectedMultiple"
              type="checkbox"
              :value="opt.value"
              :disabled="submitting"
            />
            <span class="ask-option-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="ask-option-desc">{{ opt.description }}</span>
          </label>
        </template>
        <template v-else>
          <label v-for="opt in ask.options" :key="opt.value" class="ask-option">
            <input
              v-model="selectedSingle"
              type="radio"
              :value="opt.value"
              :disabled="submitting"
            />
            <span class="ask-option-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="ask-option-desc">{{ opt.description }}</span>
          </label>
        </template>
      </div>

      <!-- value -->
      <div v-else-if="ask.questionType === 'value'" class="ask-value">
        <template v-if="ask.valueType === 'boolean'">
          <label class="ask-toggle">
            <input v-model="boolValue" type="checkbox" :disabled="submitting" />
            <span>{{ boolValue ? 'true' : 'false' }}</span>
          </label>
        </template>
        <template v-else>
          <input
            v-model="textInput"
            type="text"
            class="ask-input"
            :placeholder="ask.placeholder || ask.valueType"
            :disabled="submitting"
          />
          <span v-if="isInvalid" class="ask-invalid">{{
            t('aiChat.askInvalidValue', { type: ask.valueType })
          }}</span>
        </template>
      </div>

      <!-- confirm -->
      <div v-else-if="ask.questionType === 'confirm'" class="ask-confirm">
        <button class="ask-btn ask-btn-yes" :disabled="submitting" @click="handleConfirmYes">
          {{ t('aiChat.askSubmit') }}
        </button>
        <button class="ask-btn ask-btn-no" :disabled="submitting" @click="handleConfirmNo">
          {{ t('aiChat.askSkip') }}
        </button>
      </div>

      <!-- 通用操作（非 confirm 型） -->
      <div v-if="ask.questionType !== 'confirm'" class="ask-actions">
        <button class="ask-btn ask-btn-submit" :disabled="!canSubmit" @click="handleSubmit">
          {{ t('aiChat.askSubmit') }}
        </button>
        <button class="ask-btn ask-btn-skip" :disabled="submitting" @click="handleSkip">
          {{ t('aiChat.askSkip') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .ask-user-card {
    margin: 8px 0;
    padding: 12px;
    border: 1px solid var(--color-border, #ddd);
    border-radius: 8px;
    background: var(--color-bg-secondary, #fafafa);
  }
  .ask-prompt {
    font-weight: 500;
    margin-bottom: 8px;
  }
  .ask-textarea,
  .ask-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--color-border, #ccc);
    border-radius: 4px;
    box-sizing: border-box;
  }
  .ask-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ask-option {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ask-option-desc {
    color: var(--color-text-secondary, #888);
    font-size: 0.85em;
  }
  .ask-actions,
  .ask-confirm {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .ask-btn {
    padding: 6px 14px;
    border: 1px solid var(--color-border, #ccc);
    border-radius: 4px;
    cursor: pointer;
  }
  .ask-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ask-btn-submit,
  .ask-btn-yes {
    background: var(--color-primary, #409eff);
    color: #fff;
  }
  .ask-invalid {
    color: var(--color-danger, #f56c6c);
    font-size: 0.85em;
  }
  .ask-answered {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-secondary, #888);
  }
</style>
