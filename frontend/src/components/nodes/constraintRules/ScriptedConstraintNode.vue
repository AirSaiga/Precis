/** * @file ScriptedConstraintNode.vue * @description 脚本约束节点组件 * * 核心功能： * - 配置自定义
JavaScript 脚本进行数据校验 * - 接收 Schema 节点列的输入 * -
执行脚本校验（运行用户自定义的验证逻辑） * - 显示校验状态和错误数量 * * 数据流： * Schema列 →
[target Handle] → ScriptedConstraintNode → 脚本执行 → 校验结果 */
<template>
  <ConstraintNodeFrame
    class="scripted-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="script"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.scriptedConstraintNode.title')"
    icon-name="constraint-scripted"
    :help-text="t('customNodes.constraintRules.scriptedConstraintNode.helpTooltip')"
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
        title: t('customNodes.constraintRules.scriptedConstraintNode.inputHandle'),
      },
    ]"
    @delete="handleDelete"
    @save="handleSave"
  >
    <template #actions>
      <NodeBadge
        v-if="!scriptEnabled"
        type="warning"
        variant="soft"
        :tooltip="t('settings.script.hint')"
      >
        {{ t('settings.script.hint') }}
      </NodeBadge>
    </template>

    <ConstraintNodeLayout
      :status="validationStatus"
      :status-text="statusText"
      :error-count="errorCount"
      :show-guide="selected"
      :show-details="showDetails"
    >
      <!-- 信息区：表名与列名 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.scriptedConstraintNode.table')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{ tableDisplay }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.scriptedConstraintNode.column')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{ columnDisplay }}</span>
        </div>
      </template>

      <!-- 预览区：脚本状态 -->
      <template #preview>
        <div v-if="!hasScript" class="preview-empty">
          {{ t('customNodes.constraintRules.scriptedConstraintNode.noScript') }}
        </div>
        <div v-else class="preview-content">
          <span class="script-badge">{{
            t('customNodes.constraintRules.scriptedConstraintNode.scriptConfigured')
          }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.scriptedConstraintNode.detailsTitle') }}
        </div>
        <div v-if="data.lastValidation" class="details-metrics">
          <div class="metric">
            {{ t('customNodes.constraintRules.scriptedConstraintNode.totalRows') }}:
            {{ data.lastValidation.totalRows || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.scriptedConstraintNode.matchCount') }}:
            {{ data.lastValidation.matchCount || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.scriptedConstraintNode.errorCount') }}:
            {{ data.lastValidation.errorCount || 0 }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors" :key="idx" class="details-error">
            {{ msg }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.scriptedConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  /**
   * @file ScriptedConstraintNode.vue
   * @description 脚本约束节点组件
   *
   * 对齐外键/允许值节点的交互与架构：
   * - 使用 sourceRef(nodeId+columnId) 表达被校验列，避免仅依赖字符串字段
   * - 选中态提供源表/源列下拉与脚本编辑器
   * - 自动触发后端校验，并在节点内展示状态、指标与错误明细
   */

  import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import NodeBadge from '@/components/ui/NodeBadge.vue'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { ScriptedConstraintNodeData } from '@/types/constraints'
  import { useGraphStore } from '@/stores/graphStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  import { validateConstraintNodeById } from '@/services/constraints/validationRegistry'
  const props = defineProps<{
    id: string
    data: ScriptedConstraintNodeData
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
  const settingsStore = useSettingsStore()

  const performValidation = async () => {
    await validateConstraintNodeById(props.id, store.nodes, store.edges, store.updateNodeData)
  }

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
    statusI18nPrefix: 'customNodes.constraintRules.scriptedConstraintNode',
    getStatusText: (_data, _status) => {
      if (!scriptEnabled.value) {
        return t('customNodes.constraintRules.scriptedConstraintNode.statusDisabled')
      }
      return undefined
    },
  })

  const validateNow = async () => {
    await nextTick()
    await performValidation().catch(() => undefined)
  }

  const scriptEnabled = computed(() => settingsStore.isScriptEnabled)

  const hasSource = computed(
    () => !!props.data.sourceRef?.nodeId && !!props.data.sourceRef?.columnId
  )
  const hasScript = computed(() => !!props.data.script)

  const tableDisplay = computed(() => {
    if (!hasSource.value)
      return t('customNodes.constraintRules.scriptedConstraintNode.waitingForSource')
    return props.data.table || ''
  })

  const columnDisplay = computed(() => {
    if (!hasSource.value)
      return t('customNodes.constraintRules.scriptedConstraintNode.waitingForSourceColumn')
    return props.data.column || ''
  })

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

  watch(
    () => props.data.sourceRef?.columnId,
    (next) => {
      if (next && props.data.script) {
        scheduleValidation()
      }
    }
  )

  watch(
    () => props.data.script,
    (next) => {
      if (next && hasSource.value) {
        scheduleValidation()
      }
    }
  )
</script>

<style scoped src="./ScriptedConstraintNode.styles.css"></style>
