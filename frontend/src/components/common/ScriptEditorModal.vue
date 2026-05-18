<!--
  @file ScriptEditorModal.vue
  @description 脚本约束代码编辑模态框

  功能职责：
  - 提供轻量级代码编辑器界面，用于编写和编辑 scripted 约束的表达式/脚本
  - 支持插入常用代码模板（基础验证、范围检查、正则匹配、复杂逻辑）
  - 提供内置变量与函数的帮助文档面板，支持一键插入代码片段
  - 配置脚本名称并保存到约束节点

  关键特性：
  - 多行文本编辑区，支持语法高亮风格的编辑器外观
  - 可折叠的帮助面板（变量说明、数学函数、逻辑函数）
  - 代码模板按钮快速生成常用脚本骨架
  - 代码片段一键插入（value、row、tables 等上下文变量）

  Props:
    - modelValue: boolean  控制模态框显示/隐藏（支持 v-model）

  Emits:
    - update:modelValue: 模态框显隐状态变更时触发
    - save: 保存脚本时触发，携带 { script: string; scriptName: string } 载荷
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="script-editor-overlay" @click.self="handleClose">
        <div class="script-editor-modal" role="dialog" aria-modal="true">
          <div class="script-editor-header">
            <h3 class="script-editor-title">
              {{ t('customNodes.constraintRules.scriptedConstraintNode.scriptEditorTitle') }}
            </h3>
            <button class="script-editor-close" type="button" @click="handleClose">×</button>
          </div>

          <div class="script-editor-body">
            <div class="script-config-row">
              <label class="script-config-label"
                >{{ t('customNodes.constraintRules.scriptedConstraintNode.configName') }}:</label
              >
              <input
                v-model="scriptName"
                class="script-config-input"
                type="text"
                :placeholder="
                  t('customNodes.constraintRules.scriptedConstraintNode.configNamePlaceholder')
                "
              />
            </div>

            <div class="script-editor-main">
              <div class="script-editor-toolbar">
                <span class="toolbar-title"
                  >{{
                    t('customNodes.constraintRules.scriptedConstraintNode.scriptContent')
                  }}:</span
                >
                <div class="toolbar-actions">
                  <button class="toolbar-btn" type="button" @click="insertTemplate('basic')">
                    {{ t('customNodes.constraintRules.scriptedConstraintNode.templateBasic') }}
                  </button>
                  <button class="toolbar-btn" type="button" @click="insertTemplate('range')">
                    {{ t('customNodes.constraintRules.scriptedConstraintNode.templateRange') }}
                  </button>
                  <button class="toolbar-btn" type="button" @click="insertTemplate('regex')">
                    {{ t('customNodes.constraintRules.scriptedConstraintNode.templateRegex') }}
                  </button>
                  <button class="toolbar-btn" type="button" @click="insertTemplate('complex')">
                    {{ t('customNodes.constraintRules.scriptedConstraintNode.templateComplex') }}
                  </button>
                </div>
              </div>

              <div class="script-editor-textarea-wrapper">
                <textarea
                  ref="scriptTextarea"
                  v-model="scriptContent"
                  class="script-editor-textarea"
                  :placeholder="
                    t('customNodes.constraintRules.scriptedConstraintNode.scriptPlaceholder')
                  "
                  spellcheck="false"
                ></textarea>
              </div>

              <div class="script-help">
                <div class="help-section">
                  <div
                    class="help-header"
                    @click="expandedSections.variables = !expandedSections.variables"
                  >
                    <span class="help-toggle">{{ expandedSections.variables ? '▼' : '▶' }}</span>
                    <h4>
                      {{
                        t('customNodes.constraintRules.scriptedConstraintNode.helpVariablesTitle')
                      }}
                    </h4>
                  </div>
                  <div v-if="expandedSections.variables" class="help-content">
                    <div class="help-list">
                      <button class="help-item" type="button" @click="insertSnippet('value')">
                        <code class="help-code">value</code>
                        <span class="help-desc">{{
                          t('customNodes.constraintRules.scriptedConstraintNode.helpValueDesc')
                        }}</span>
                      </button>
                      <button class="help-item" type="button" @click="insertSnippet('row')">
                        <code class="help-code">row</code>
                        <span class="help-desc">{{
                          t('customNodes.constraintRules.scriptedConstraintNode.helpRowDesc')
                        }}</span>
                      </button>
                      <button class="help-item" type="button" @click="insertSnippet('tables')">
                        <code class="help-code">tables</code>
                        <span class="help-desc">{{
                          t('customNodes.constraintRules.scriptedConstraintNode.helpTablesDesc')
                        }}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div class="help-section">
                  <div
                    class="help-header"
                    @click="expandedSections.functions = !expandedSections.functions"
                  >
                    <span class="help-toggle">{{ expandedSections.functions ? '▼' : '▶' }}</span>
                    <h4>
                      {{
                        t('customNodes.constraintRules.scriptedConstraintNode.helpFunctionsTitle')
                      }}
                    </h4>
                  </div>
                  <div v-if="expandedSections.functions" class="help-content">
                    <div class="help-block">
                      <div class="help-subtitle">
                        {{ t('customNodes.constraintRules.scriptedConstraintNode.helpMathTitle') }}
                      </div>
                      <div class="help-snippets">
                        <button class="snippet" type="button" @click="insertSnippet('abs(')">
                          abs()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('round(')">
                          round()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('min(')">
                          min()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('max(')">
                          max()
                        </button>
                      </div>
                    </div>
                    <div class="help-block">
                      <div class="help-subtitle">
                        {{ t('customNodes.constraintRules.scriptedConstraintNode.helpLogicTitle') }}
                      </div>
                      <div class="help-snippets">
                        <button class="snippet" type="button" @click="insertSnippet('bool(')">
                          bool()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('int(')">
                          int()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('float(')">
                          float()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('str(')">
                          str()
                        </button>
                      </div>
                    </div>
                    <div class="help-block">
                      <div class="help-subtitle">
                        {{
                          t(
                            'customNodes.constraintRules.scriptedConstraintNode.helpCollectionTitle'
                          )
                        }}
                      </div>
                      <div class="help-snippets">
                        <button class="snippet" type="button" @click="insertSnippet('len(')">
                          len()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('any(')">
                          any()
                        </button>
                        <button class="snippet" type="button" @click="insertSnippet('all(')">
                          all()
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="help-section">
                  <div
                    class="help-header"
                    @click="expandedSections.examples = !expandedSections.examples"
                  >
                    <span class="help-toggle">{{ expandedSections.examples ? '▼' : '▶' }}</span>
                    <h4>
                      {{
                        t('customNodes.constraintRules.scriptedConstraintNode.helpExamplesTitle')
                      }}
                    </h4>
                  </div>
                  <div v-if="expandedSections.examples" class="help-content">
                    <div class="example-grid">
                      <button
                        v-for="ex in examples"
                        :key="ex.key"
                        class="example-card"
                        type="button"
                        @click="insertExample(ex)"
                      >
                        <div class="example-title">{{ t(ex.titleKey) }}</div>
                        <div class="example-desc">{{ t(ex.descKey) }}</div>
                        <div class="example-code">{{ ex.code }}</div>
                      </button>
                    </div>
                  </div>
                </div>

                <div class="script-warning">
                  {{ t('customNodes.constraintRules.scriptedConstraintNode.helpWarning') }}
                </div>
              </div>
            </div>

            <div class="script-editor-footer">
              <button class="btn btn-cancel" type="button" @click="handleClose">
                {{ t('common.cancel') }}
              </button>
              <button class="btn btn-confirm" type="button" @click="handleSave">
                {{ t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * 脚本编辑器弹窗组件
   * 提供完整的脚本编辑功能：
   * - 脚本名称输入
   * - 脚本内容编辑区
   * - 模板快速插入
   * - 可用函数/变量提示
   * - 实用示例参考
   */

  import { computed, ref, watch, nextTick, onMounted, onUnmounted, reactive } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useScriptEditorStore } from '@/stores/scriptEditorStore'
  import { loadScriptDraft, saveScriptDraft } from '@/composables/common/useScriptEditor'

  const props = defineProps<{
    modelValue: boolean
  }>()

  const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void
    (e: 'save', data: { script: string; scriptName: string }): void
  }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const scriptEditorStore = useScriptEditorStore()

  const scriptContent = ref('')
  const scriptName = ref('')
  const scriptTextarea = ref<HTMLTextAreaElement | null>(null)

  const expandedSections = reactive({
    variables: true,
    functions: false,
    examples: true,
  })

  const visible = computed({
    get: () => props.modelValue,
    set: (value: boolean) => emit('update:modelValue', value),
  })

  const loadCurrentScript = () => {
    const id = scriptEditorStore.nodeId
    if (!id) {
      scriptContent.value = ''
      scriptName.value = ''
      return
    }

    const draft = loadScriptDraft(id)
    if (draft.script || draft.scriptName) {
      scriptContent.value = draft.script
      scriptName.value = draft.scriptName
      return
    }

    const node = graphStore.nodes.find((n) => n.id === id)
    const data = node?.data as { script?: string; configName?: string } | undefined
    scriptContent.value = data?.script ?? ''
    scriptName.value = data?.configName ?? ''
  }

  watch(visible, (newVal) => {
    if (newVal) {
      loadCurrentScript()
    }
  })

  const handleClose = () => {
    scriptEditorStore.close()
    visible.value = false
  }

  const handleSave = () => {
    if (!scriptContent.value.trim()) {
      return
    }

    const id = scriptEditorStore.nodeId
    if (!id) {
      return
    }

    saveScriptDraft(id, { script: scriptContent.value, scriptName: scriptName.value })
    graphStore.updateNodeData(id, {
      script: scriptContent.value,
      configName: scriptName.value,
      validationStatus: 'idle',
      validationErrors: [],
    })

    emit('save', {
      script: scriptContent.value,
      scriptName: scriptName.value,
    })

    scriptEditorStore.close()
    visible.value = false
  }

  const insertTemplate = (template: 'basic' | 'range' | 'regex' | 'complex') => {
    const templates: Record<string, string> = {
      basic: '# 基本条件判断\nvalue > 0',
      range: '# 范围校验示例\nvalue >= 0 and value <= 100',
      regex: '# 正则匹配示例\nre.match(r"^[A-Z]{2}\\d{4}$", str(value)) is not None',
      complex: '# 复合条件示例\nvalue > 0 and len(str(value)) <= 10',
    }

    const templateText = templates[template] || ''
    scriptContent.value = templateText

    nextTick(() => {
      scriptTextarea.value?.focus()
    })
  }

  const examples = [
    {
      key: 'positive',
      titleKey: 'customNodes.constraintRules.scriptedConstraintNode.examplePositiveTitle',
      descKey: 'customNodes.constraintRules.scriptedConstraintNode.examplePositiveDesc',
      code: 'value is not None and value > 0',
    },
    {
      key: 'range',
      titleKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleRangeTitle',
      descKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleRangeDesc',
      code: 'value is not None and value >= 1 and value <= 100',
    },
    {
      key: 'length',
      titleKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleLengthTitle',
      descKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleLengthDesc',
      code: 'value is None or len(str(value)) <= 10',
    },
    {
      key: 'regex',
      titleKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleRegexTitle',
      descKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleRegexDesc',
      code: 're.match(r"^[A-Z]{2}\\d{4}$", str(value)) is not None',
    },
    {
      key: 'inlist',
      titleKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleInlistTitle',
      descKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleInlistDesc',
      code: 'value in ["A", "B", "C"]',
    },
    {
      key: 'crossTable',
      titleKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleCrossTableTitle',
      descKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleCrossTableDesc',
      code: 'value in tables["other_table"]["id"]',
    },
    {
      key: 'nullCheck',
      titleKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleNullCheckTitle',
      descKey: 'customNodes.constraintRules.scriptedConstraintNode.exampleNullCheckDesc',
      code: "value is not None and str(value).strip() != ''",
    },
  ] as const

  type ExampleItem = (typeof examples)[number]

  const insertExample = (ex: ExampleItem) => {
    scriptContent.value = `# ${t(ex.titleKey)}\n${ex.code}`
    nextTick(() => scriptTextarea.value?.focus())
  }

  const insertSnippet = (snippet: string) => {
    const textarea = scriptTextarea.value
    if (!textarea) {
      scriptContent.value = `${scriptContent.value}${snippet}`
      return
    }

    const start = textarea.selectionStart ?? scriptContent.value.length
    const end = textarea.selectionEnd ?? scriptContent.value.length
    const before = scriptContent.value.slice(0, start)
    const after = scriptContent.value.slice(end)
    scriptContent.value = `${before}${snippet}${after}`

    nextTick(() => {
      textarea.focus()
      const cursor = start + snippet.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (!visible.value) return

    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
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

  defineExpose({
    close: () => handleClose(),
  })
</script>

<style scoped src="./ScriptEditorModal.styles.css" />
