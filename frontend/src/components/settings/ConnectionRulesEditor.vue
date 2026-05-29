<!--
  @file ConnectionRulesEditor.vue
  @description 连接规则编辑器设置面板（macOS 风格简化版）

  允许用户自定义画布中节点类型的连接规则：
  - 哪些节点类型可以连接到哪些节点类型
  - 连接数量限制（单条/多条）
  - 验证模式（strict / loose）

  连接规则决定了画布拖拽连线时的合法性校验。
-->

<template>
  <div class="settings-page">
    <!-- 头部操作 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('connectionRules.title') }}</div>
        <div class="settings-section__desc">{{ t('connectionRules.rulesCount', { count: rules.length }) }}</div>
      </div>
      <div class="settings-actions" style="padding: var(--ui-space-sm) 0">
        <button class="ui-btn ui-btn--primary ui-btn--sm" type="button" :disabled="loading" @click="addNewRule">
          + {{ t('connectionRules.addRule') }}
        </button>
        <button class="ui-btn ui-btn--secondary ui-btn--sm" type="button" :disabled="loading" @click="saveRules">
          {{ t('connectionRules.save') }}
        </button>
        <button class="ui-btn ui-btn--ghost ui-btn--sm" type="button" :disabled="loading" @click="resetRules">
          {{ t('connectionRules.reset') }}
        </button>
      </div>
    </div>

    <!-- 规则列表 -->
    <div v-if="rules.length > 0" class="settings-section">
      <div class="settings-list">
        <div
          v-for="(rule, index) in rules"
          :key="rule.id"
          class="settings-list__item"
          style="flex-direction: column; align-items: stretch; gap: var(--ui-space-sm); cursor: pointer"
          @click="toggleRule(rule.id)"
        >
          <!-- 摘要行 -->
          <div style="display: flex; align-items: center; gap: var(--ui-space-md); width: 100%">
            <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0">
              <div style="font-size: var(--ui-font-size-sm); font-weight: var(--ui-font-weight-medium); color: var(--ui-text-body)">
                {{ rule.name }}
                <span style="color: var(--ui-text-muted); font-weight: normal">({{ rule.id }})</span>
              </div>
              <div style="font-size: var(--ui-font-size-xs); color: var(--ui-text-muted)">
                <span class="settings-code">{{ rule.source.node_types.join(', ') }}</span>
                →
                <span class="settings-code">{{ rule.target.node_types.join(', ') }}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: var(--ui-space-sm)">
              <span class="settings-pill" :class="rule.config?.allow_multiple ? 'settings-pill--info' : 'settings-pill--success'">
                {{ rule.config?.allow_multiple ? t('connectionRules.multiple') : t('connectionRules.single') }}
              </span>
              <span
                class="expand-icon"
                :class="{ 'is-expanded': expandedRuleId === rule.id }"
                style="font-size: 10px; transition: transform 0.2s; color: var(--ui-text-muted)"
              >
                ▼
              </span>
              <button class="ui-icon-btn ui-icon-btn--danger" type="button" :disabled="loading" @click.stop="deleteRule(index)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 展开内容 -->
          <div v-show="expandedRuleId === rule.id" style="display: flex; flex-direction: column; gap: var(--ui-space-sm); padding-top: var(--ui-space-sm); border-top: 1px solid var(--ui-border-light)" @click.stop
          >
            <div class="settings-row" style="padding: var(--ui-space-xs) 0">
              <div class="settings-row__label">{{ t('connectionRules.ruleId') }}</div>
              <div class="settings-row__control settings-row__control--wide">
                <input v-model="rule.id" type="text" class="settings-input" :disabled="loading" />
              </div>
            </div>
            <div class="settings-row" style="padding: var(--ui-space-xs) 0">
              <div class="settings-row__label">{{ t('connectionRules.ruleName') }}</div>
              <div class="settings-row__control settings-row__control--wide">
                <input v-model="rule.name" type="text" class="settings-input" :disabled="loading" />
              </div>
            </div>
            <div class="settings-row" style="padding: var(--ui-space-xs) 0">
              <div class="settings-row__label">{{ t('connectionRules.sourceEndpoint') }}</div>
              <div class="settings-row__control settings-row__control--wide">
                <select v-model="rule.source.node_types" class="settings-select" multiple :disabled="loading" style="height: 80px"
                >
                  <option v-for="nodeType in allNodeTypes" :key="nodeType" :value="nodeType">{{ nodeType }}</option>
                </select>
              </div>
            </div>
            <div class="settings-row" style="padding: var(--ui-space-xs) 0">
              <div class="settings-row__label">{{ t('connectionRules.targetEndpoint') }}</div>
              <div class="settings-row__control settings-row__control--wide">
                <select v-model="rule.target.node_types" class="settings-select" multiple :disabled="loading" style="height: 80px"
                >
                  <option v-for="nodeType in allNodeTypes" :key="nodeType" :value="nodeType">{{ nodeType }}</option>
                </select>
              </div>
            </div>
            <div class="settings-row" style="padding: var(--ui-space-xs) 0">
              <div class="settings-row__label">{{ t('connectionRules.allowMultiple') }}</div>
              <div class="settings-row__desc"></div>
              <div class="settings-row__control">
                <label class="settings-switch"
                >
                  <input type="checkbox" v-model="rule.config!.allow_multiple" :disabled="loading" class="settings-switch__input" />
                  <span class="settings-switch__track"></span>
                </label>
              </div>
            </div>
            <div class="settings-row" style="padding: var(--ui-space-xs) 0">
              <div class="settings-row__label">{{ t('connectionRules.validationMode') }}</div>
              <div class="settings-row__desc"></div>
              <div class="settings-row__control">
                <select v-model="rule.config!.validation_mode" class="settings-select" :disabled="loading"
                >
                  <option value="strict">{{ t('connectionModes.strict') }}</option>
                  <option value="loose">{{ t('connectionModes.loose') }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="ui-empty">
      <p class="ui-empty__description">{{ t('connectionRules.empty') }}</p>
      <button class="ui-btn ui-btn--secondary ui-btn--sm" type="button" :disabled="loading" @click="addNewRule"
      >
        + {{ t('connectionRules.addFirstRule') }}
      </button>
    </div>

    <div v-if="loading" class="ui-loading-overlay"
    >
      <div class="ui-spinner"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, onMounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { FrontendConnectionRule } from '@/services/api/connectionRulesApi'
  import {
    fetchConnectionRules,
    saveConnectionRules,
    resetConnectionRules,
  } from '@/services/api/connectionRulesApi'

  const { t } = useI18n()

  const loading = ref(false)
  const rules = ref<FrontendConnectionRule[]>([])
  const expandedRuleId = ref<string | null>(null)

  const allNodeTypes = [
    'projectRoot',
    'patternToolbox',
    'pattern',
    'constraintDashboard',
    'schema',
    'sourcePreview',
    'regex',
    'constraint',
    'notNullConstraint',
    'uniqueConstraint',
    'foreignKeyConstraint',
    'allowedValuesConstraint',
    'conditionalConstraint',
    'scriptedConstraint',
  ]

  function createEmptyRule(): FrontendConnectionRule {
    const id = `custom-rule-${Date.now()}`
    return {
      id,
      name: t('connectionRules.newRule'),
      source: {
        node_types: [],
        handles: undefined,
      },
      target: {
        node_types: [],
        handles: undefined,
      },
      config: {
        allow_multiple: true,
        validation_mode: 'strict',
      },
    }
  }

  function createDefaultRules(): FrontendConnectionRule[] {
    return [
      {
        id: 'source-to-schema',
        name: 'SourcePreview to Schema',
        source: { node_types: ['sourcePreview'], handles: undefined },
        target: { node_types: ['schema'], handles: ['target-left'] },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-regex',
        name: 'Schema to Regex',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['regex'], handles: ['regex-input'] },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'pattern-to-regex',
        name: 'Pattern to Regex',
        source: { node_types: ['pattern'], handles: undefined },
        target: { node_types: ['regex'], handles: ['regex-input'] },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-not-null',
        name: 'Schema to NotNull Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['notNullConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-unique',
        name: 'Schema to Unique Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['uniqueConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-foreign-key',
        name: 'Schema to ForeignKey Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['foreignKeyConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-allowed-values',
        name: 'Schema to AllowedValues Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['allowedValuesConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-conditional',
        name: 'Schema to Conditional Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['conditionalConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-scripted',
        name: 'Schema to Scripted Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['scriptedConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-charset',
        name: 'Schema to Charset Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['charsetConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'schema-to-date-logic',
        name: 'Schema to DateLogic Constraint',
        source: { node_types: ['schema'], handles: undefined },
        target: { node_types: ['dateLogicConstraint'], handles: undefined },
        config: { allow_multiple: false, validation_mode: 'strict' },
      },
      {
        id: 'foreign-key-display',
        name: 'ForeignKey to Schema (Display)',
        source: { node_types: ['foreignKeyConstraint'], handles: undefined },
        target: { node_types: ['schema'], handles: undefined },
        config: { allow_multiple: true, validation_mode: 'loose' },
      },
    ]
  }

  async function loadRules() {
    loading.value = true
    try {
      const data = await fetchConnectionRules()
      if (data.rules && data.rules.length > 0) {
        rules.value = data.rules
      } else {
        rules.value = createDefaultRules()
      }
    } catch (error) {
      logger.error('Failed to load rules:', error)
      rules.value = createDefaultRules()
    } finally {
      loading.value = false
    }
  }

  async function saveRules() {
    loading.value = true
    try {
      await saveConnectionRules({
        version: '1.0',
        rules: rules.value,
      })
      alert(t('connectionRules.saved'))
    } catch (error) {
      logger.error('Failed to save rules:', error)
      alert(t('connectionRules.saveFailed'))
    } finally {
      loading.value = false
    }
  }

  async function resetRules() {
    if (!confirm(t('connectionRules.resetConfirm'))) {
      return
    }
    loading.value = true
    try {
      await resetConnectionRules()
      rules.value = createDefaultRules()
      alert(t('connectionRules.resetSuccess'))
    } catch (error) {
      logger.error('Failed to reset rules:', error)
      alert(t('connectionRules.resetFailed'))
    } finally {
      loading.value = false
    }
  }

  function addNewRule() {
    const newRule = createEmptyRule()
    rules.value.push(newRule)
    expandedRuleId.value = newRule.id
  }

  function deleteRule(index: number) {
    if (confirm(t('connectionRules.deleteConfirm'))) {
      rules.value.splice(index, 1)
    }
  }

  function toggleRule(ruleId: string) {
    expandedRuleId.value = expandedRuleId.value === ruleId ? null : ruleId
  }
</script>
