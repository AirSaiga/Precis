<!--
  @file CharsetConstraintNode.vue
  @description 字符集约束节点组件

  在可视化画布中配置字符集约束，限制字段内容必须符合指定的字符编码规则。
-->
<template>
  <ConstraintNodeFrame
    class="charset-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="pink"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.charsetConstraintNode.title')"
    icon-name="constraint-charset"
    :help-text="t('customNodes.constraintRules.charsetConstraintNode.helpTooltip')"
    :error-count="errorCount"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('common.delete')"
    :error-title="t('common.error')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :handles="[
      {
        id: `target-input-${id}`,
        type: 'target',
        position: Position.Left,
        color: 'warning',
        title: t('customNodes.constraintRules.charsetConstraintNode.inputHandle'),
      },
    ]"
    @delete="handleDelete"
    @save="handleSave"
  >
    <ConstraintNodeLayout
      :status="validationStatus"
      :status-text="statusText"
      :error-count="errorCount"
      :show-guide="selected"
      :show-details="showDetails"
    >
      <!-- 信息区：源和模式 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.charsetConstraintNode.sourceLabel', '源')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{
            data.table || t('customNodes.constraintRules.charsetConstraintNode.waitingForSource')
          }}</span>
        </div>
        <div v-if="hasSource && data.column" class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.charsetConstraintNode.columnLabel', '列')
          }}</span>
          <span class="info-value">{{ data.column }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.charsetConstraintNode.modeLabel')
          }}</span>
          <span class="info-value">{{ modeSummary }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.charsetConstraintNode.detailsTitle') }}
        </div>
        <div v-if="data.lastValidation" class="details-metrics">
          <div class="metric">
            {{ t('customNodes.constraintRules.charsetConstraintNode.totalRows') }}:
            {{ data.lastValidation.totalRows || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.charsetConstraintNode.matchCount') }}:
            {{ data.lastValidation.matchCount || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.charsetConstraintNode.errorCount') }}:
            {{ data.lastValidation.errorCount || 0 }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors" :key="idx" class="details-error">
            {{ msg }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.charsetConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>

    <!-- 手动校验按钮区 -->
    <div class="charset-validate-section">
      <button
        class="charset-validate-btn"
        :disabled="!hasSource || isValidating"
        :title="
          !hasSource
            ? t('customNodes.constraintRules.charsetConstraintNode.waitingForSource')
            : t('customNodes.constraintRules.charsetConstraintNode.validate')
        "
        @mousedown.stop
        @click.stop="handleValidate"
      >
        {{
          isValidating
            ? t('customNodes.constraintRules.charsetConstraintNode.validating')
            : t('customNodes.constraintRules.charsetConstraintNode.validate')
        }}
      </button>
    </div>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { CharsetConstraintNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  import { validateConstraintNodeById } from '@/services/constraints/validationRegistry'
  import { useToast } from '@/composables/shared/useToast'
  const props = defineProps<{
    id: string
    data: CharsetConstraintNodeData
    selected?: boolean
  }>()

  defineEmits<{
    (e: 'schemaConnected', payload: { nodeId: string; columnId?: string }): void
    (e: 'schemaDisconnected', payload: { nodeId: string; columnId?: string }): void
    (e: 'validationCompleted', payload: { nodeId: string; status: string }): void
    (e: 'validationErrors', payload: { nodeId: string; errors: string[] }): void
    (e: 'configUpdated', payload: { nodeId: string; patch: Record<string, unknown> }): void
  }>()

  const { t } = useI18n()
  const store = useGraphStore()
  const toast = useToast()

  const {
    isSaving,
    validationStatus,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
    handleSave,
    handleDelete,
  } = useConstraintNodeBase(props, {
    statusI18nPrefix: 'customNodes.constraintRules.charsetConstraintNode',
  })

  const isValidating = ref(false)

  const localCharsetMode = ref<'ascii' | 'chinese'>(props.data.charsetMode || 'ascii')

  const validateNow = async () => {
    await nextTick()
    await performValidation()
  }

  const hasSource = computed(
    () => !!props.data.sourceRef?.nodeId && !!props.data.sourceRef?.columnId
  )
  const hasMode = computed(() => !!localCharsetMode.value)

  const modeSummary = computed(() => {
    const mode = localCharsetMode.value
    return mode === 'ascii'
      ? t('customNodes.constraintRules.charsetConstraintNode.modeAscii')
      : t('customNodes.constraintRules.charsetConstraintNode.modeChinese')
  })

  const performValidation = async () => {
    if (!hasSource.value || !hasMode.value) return
    await validateConstraintNodeById(props.id, store.nodes, store.edges, store.updateNodeData)
  }

  let validationTimer: number | undefined
  onBeforeUnmount(() => {
    if (validationTimer) clearTimeout(validationTimer)
  })
  const scheduleValidation = () => {
    if (validationTimer) window.clearTimeout(validationTimer)
    validationTimer = window.setTimeout(() => {
      validateNow().catch(() => undefined)
    }, 300)
  }

  const handleValidate = async () => {
    if (isValidating.value) return
    isValidating.value = true
    try {
      await validateNow()
      await nextTick()
      const node = store.nodes.find((n) => n.id === props.id)
      const status = (node?.data as Record<string, unknown>)?.validationStatus as string
      const lastVal = (node?.data as Record<string, unknown>)?.lastValidation as
        | { totalRows?: number; errorCount?: number }
        | undefined
      if (status === 'error') {
        toast.error(
          t(
            'customNodes.constraintRules.charsetConstraintNode.validationFailed',
            '字符集校验未通过'
          ),
          t(
            'customNodes.constraintRules.charsetConstraintNode.errorCountMessage',
            { count: lastVal?.errorCount || 0 },
            `发现 ${lastVal?.errorCount || 0} 条不符合约束的数据`
          )
        )
      } else if (status === 'pass') {
        toast.success(
          t('customNodes.constraintRules.charsetConstraintNode.validationPassed', '字符集校验通过'),
          t(
            'customNodes.constraintRules.charsetConstraintNode.allRowsMatch',
            { count: lastVal?.totalRows || 0 },
            `全部 ${lastVal?.totalRows || 0} 行数据符合字符集约束`
          )
        )
      }
    } finally {
      isValidating.value = false
    }
  }

  watch(
    () => props.data.sourceRef?.columnId,
    (next) => {
      if (next && hasMode.value) {
        scheduleValidation()
      }
    }
  )

  watch(
    () => props.data.charsetMode,
    (next) => {
      localCharsetMode.value = next || 'ascii'
    }
  )
</script>

<style scoped src="./CharsetConstraintNode.styles.css"></style>
