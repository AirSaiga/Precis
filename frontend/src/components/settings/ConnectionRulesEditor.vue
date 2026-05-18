<!--
  @file ConnectionRulesEditor.vue
  @description 连接规则编辑器设置面板

  允许用户自定义画布中节点类型的连接规则：
  - 哪些节点类型可以连接到哪些节点类型
  - 连接数量限制（单条/多条）
  - 验证模式（strict / loose）

  连接规则决定了画布拖拽连线时的合法性校验。
-->

<template>
  <div class="ui-workbench-page" style="position: relative">
    <!-- Panel Header -->
    <div class="settings-panel-header">
      <h2 class="settings-panel-header__title">{{ t('connectionRules.title') }}</h2>
      <p class="settings-panel-header__desc">{{ t('connectionRules.description') }}</p>
    </div>

    <div class="page-actions">
      <div class="page-actions-left">
        <span class="rules-count">{{
          t('connectionRules.rulesCount', { count: rules.length })
        }}</span>
      </div>
      <div class="page-actions-right">
        <button class="ui-btn ui-btn--primary" @click="addNewRule" :disabled="loading">
          + {{ t('connectionRules.addRule') }}
        </button>
        <button class="ui-btn ui-btn--secondary" @click="saveRules" :disabled="loading">
          {{ t('connectionRules.save') }}
        </button>
        <button class="ui-btn ui-btn--ghost" @click="resetRules" :disabled="loading">
          {{ t('connectionRules.reset') }}
        </button>
      </div>
    </div>

    <div v-if="rules.length > 0" class="rules-grid">
      <div
        v-for="(rule, index) in rules"
        :key="rule.id"
        class="ui-card rule-card"
        :class="{ 'is-expanded': expandedRuleId === rule.id }"
      >
        <div class="rule-header" @click="toggleRule(rule.id)">
          <div class="rule-info">
            <span class="rule-name">{{ rule.name }}</span>
            <span class="rule-id">({{ rule.id }})</span>
          </div>
          <div class="rule-header-right">
            <div class="rule-arrows">
              <span class="arrow-source">{{ rule.source.node_types.join(', ') }}</span>
              <span class="arrow-icon">→</span>
              <span class="arrow-target">{{ rule.target.node_types.join(', ') }}</span>
            </div>
            <span class="expand-icon" :class="{ 'is-expanded': expandedRuleId === rule.id }"
              >▼</span
            >
            <button
              class="ui-icon-btn ui-icon-btn--danger"
              @click.stop="deleteRule(index)"
              :disabled="loading"
            >
              ×
            </button>
          </div>
        </div>

        <div v-show="expandedRuleId === rule.id" class="rule-body">
          <div class="ui-form-group">
            <label class="ui-form-label">{{ t('connectionRules.ruleId') }}</label>
            <input v-model="rule.id" type="text" class="ui-input" :disabled="loading" />
          </div>

          <div class="ui-form-group">
            <label class="ui-form-label">{{ t('connectionRules.ruleName') }}</label>
            <input v-model="rule.name" type="text" class="ui-input" :disabled="loading" />
          </div>

          <div class="endpoint-section">
            <h4 class="ui-section-title">{{ t('connectionRules.sourceEndpoint') }}</h4>
            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('connectionRules.nodeTypes') }}</label>
              <div class="ui-workbench-grid ui-workbench-grid--two checkbox-grid">
                <label v-for="nodeType in allNodeTypes" :key="nodeType" class="ui-checkbox">
                  <input
                    type="checkbox"
                    :value="nodeType"
                    v-model="rule.source.node_types"
                    :disabled="loading"
                    class="ui-checkbox__input"
                  />
                  <span class="ui-checkbox__box">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </span>
                  <span>{{ nodeType }}</span>
                </label>
              </div>
            </div>
            <div class="ui-form-group">
              <label class="ui-form-label"
                >{{ t('connectionRules.handles') }} ({{ t('connectionRules.optional') }})</label
              >
              <input
                type="text"
                class="ui-input"
                :placeholder="t('connectionRules.handlesPlaceholder')"
                :value="rule.source.handles?.join(', ') || ''"
                @input="updateHandles($event, rule.source, 'source')"
                :disabled="loading"
              />
            </div>
          </div>

          <div class="endpoint-section">
            <h4 class="ui-section-title">{{ t('connectionRules.targetEndpoint') }}</h4>
            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('connectionRules.nodeTypes') }}</label>
              <div class="ui-workbench-grid ui-workbench-grid--two checkbox-grid">
                <label v-for="nodeType in allNodeTypes" :key="nodeType" class="ui-checkbox">
                  <input
                    type="checkbox"
                    :value="nodeType"
                    v-model="rule.target.node_types"
                    :disabled="loading"
                    class="ui-checkbox__input"
                  />
                  <span class="ui-checkbox__box">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </span>
                  <span>{{ nodeType }}</span>
                </label>
              </div>
            </div>
            <div class="ui-form-group">
              <label class="ui-form-label"
                >{{ t('connectionRules.handles') }} ({{ t('connectionRules.optional') }})</label
              >
              <input
                type="text"
                class="ui-input"
                :placeholder="t('connectionRules.handlesPlaceholder')"
                :value="rule.target.handles?.join(', ') || ''"
                @input="updateHandles($event, rule.target, 'target')"
                :disabled="loading"
              />
            </div>
          </div>

          <div class="config-section">
            <h4 class="ui-section-title">{{ t('connectionRules.ruleConfig') }}</h4>
            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('connectionRules.allowMultiple') }}</label>
              <label class="ui-switch">
                <input
                  type="checkbox"
                  v-model="rule.config!.allow_multiple"
                  :disabled="loading"
                  class="ui-switch__input"
                />
                <span class="ui-switch__track"></span>
              </label>
            </div>
            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('connectionRules.validationMode') }}</label>
              <select v-model="rule.config!.validation_mode" class="ui-select" :disabled="loading">
                <option value="strict">{{ t('connectionModes.strict') }}</option>
                <option value="loose">{{ t('connectionModes.loose') }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="ui-empty" v-else>
      <p class="ui-empty__description">{{ t('connectionRules.empty') }}</p>
      <button class="ui-btn ui-btn--secondary" @click="addNewRule" :disabled="loading">
        + {{ t('connectionRules.addFirstRule') }}
      </button>
    </div>

    <div class="ui-loading-overlay" v-if="loading">
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

  function updateHandles(
    event: Event,
    endpoint: { handles?: string[] | undefined },
    _type: string
  ) {
    const value = (event.target as HTMLInputElement).value.trim()
    if (value) {
      endpoint.handles = value.split(',').map((h) => h.trim())
    } else {
      endpoint.handles = undefined
    }
  }

  onMounted(() => {
    loadRules()
  })
</script>

<style scoped src="./ConnectionRulesEditor.styles.css"></style>
