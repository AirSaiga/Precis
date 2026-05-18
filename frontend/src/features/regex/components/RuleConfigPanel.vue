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
    <!-- 左侧：编辑器区域 (60%) -->
    <div class="editor-section">
      <div class="regex-card">
        <div class="card-header">
          <span class="rx-icon">⚙️</span>
          <h3>{{ t('expressions.ruleConfigPanel.ruleDefinition') }}</h3>
        </div>

        <div class="card-body">
          <!-- 1. 规则名称 -->
          <div class="form-item">
            <label class="item-label">{{ t('expressions.ruleConfigPanel.ruleName') }}</label>
            <input
              type="text"
              :value="rule.name"
              class="primary-input"
              :placeholder="t('expressions.ruleConfigPanel.ruleNamePlaceholder')"
              @input="
                $emit('update:rule', {
                  ...rule,
                  name: ($event.target as HTMLInputElement).value,
                  regex: localRegex,
                })
              "
            />
          </div>

          <!-- 2. 构建器可视化区域 (自适应高度) -->
          <div class="form-item builder-container">
            <label class="item-label">{{
              t('expressions.ruleConfigPanel.interactiveBuilder')
            }}</label>
            <div class="builder-content">
              <InteractiveBuilder
                :sample-text="sampleText"
                @update:regex="handleRegexUpdate"
                @update:params="handleParamsUpdate"
              />
            </div>
          </div>

          <!-- 3. 正则预览 (精致单行版) -->
          <div class="form-item">
            <label class="item-label">
              {{ t('expressions.ruleConfigPanel.regex') }}
              <span class="type-tag">Result</span>
            </label>
            <div class="regex-preview-bar">
              <span class="regex-marker">/</span>
              <input
                type="text"
                v-model="localRegex"
                class="regex-clean-input"
                spellcheck="false"
                @input="handleManualRegexInput"
              />
              <span class="regex-marker">/g</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：映射面板 (40%) -->
    <div class="mapping-section">
      <div class="regex-card">
        <div class="card-header">
          <span class="rx-icon">🔗</span>
          <h3>{{ t('expressions.ruleConfigPanel.outputMapping') }}</h3>
        </div>

        <div class="card-body scrollable">
          <div class="mapping-hint">{{ t('expressions.ruleConfigPanel.outputMappingHint') }}</div>
          <!-- 空状态 -->
          <div
            v-if="!rule.output || Object.keys(rule.output).length === 0"
            class="empty-placeholder"
          >
            <div class="placeholder-icon">📥</div>
            <p>{{ t('expressions.ruleConfigPanel.clickToAddFirst') }}</p>
          </div>

          <!-- 映射列表 -->
          <div v-else class="mapping-stack">
            <div v-for="(value, key) in rule.output" :key="key" class="mapping-node">
              <div class="node-main">
                <div class="key-area">
                  <input
                    type="text"
                    :value="key"
                    class="node-key-input"
                    @change="
                      updateOutputKey(String(key), ($event.target as HTMLInputElement).value)
                    "
                  />
                </div>
                <button class="node-del-btn" @click="removeOutputKey(String(key))">&times;</button>
              </div>

              <div class="node-sub">
                <div class="arrow-path">∟</div>
                <div class="value-logic">
                  <!-- 如果是绑定参数模式 {paramName:type} -->
                  <template v-if="isParamValue(value)">
                    <select
                      class="param-link-select"
                      @change="
                        updateOutputParam(String(key), ($event.target as HTMLSelectElement).value)
                      "
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
                    <div class="type-pill-selector">
                      <button
                        v-for="type in ['string', 'int', 'float']"
                        :key="type"
                        class="type-pill"
                        :class="{ active: getParamType(String(value)) === type }"
                        @click="updateOutputType(String(key), type)"
                      >
                        {{ type.toUpperCase() }}
                      </button>
                    </div>
                  </template>

                  <!-- 如果是普通静态值 -->
                  <input
                    v-else
                    type="text"
                    :value="String(value)"
                    class="node-static-input"
                    :placeholder="t('expressions.ruleConfigPanel.staticValuePlaceholder')"
                    @input="
                      updateOutputValue(String(key), ($event.target as HTMLInputElement).value)
                    "
                  />
                  <!-- 转换成参数绑定按钮 -->
                  <button
                    v-show="!isParamValue(value) && availableParams.length > 0"
                    class="bind-toggle"
                    @click="updateOutputParam(String(key), availableParams[0].name)"
                    :title="t('expressions.ruleConfigPanel.bindToParam')"
                  >
                    🔗
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <button class="add-mapping-btn" @click="addOutputKey">
            <span>+</span> {{ t('expressions.ruleConfigPanel.addKeyValue') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { Rule } from '@/features/regex/types'
  import InteractiveBuilder from './InteractiveBuilder.vue'

  /**
   * 规则配置面板组件
   *
   * 该组件提供了规则配置的完整界面，分为两个主要区域：
   * 1. 左侧编辑器区域 - 包含规则名称、交互式构建器和正则表达式预览
   * 2. 右侧映射面板 - 配置输出字段与正则捕获组的映射关系
   *
   * 支持功能：
   * - 可视化正则表达式构建
   * - 实时参数提取和同步
   * - 输出映射配置
   * - 类型安全的数据绑定
   */

  // 组件属性：单条规则与示例文本
  const props = defineProps<{
    rule: Rule
    sampleText?: string
  }>()
  // 组件事件：通知父组件更新规则或触发保存
  const emit = defineEmits<{
    (e: 'update:rule', rule: Rule): void
    (e: 'save-all'): void
  }>()

  // 国际化实例，用于 UI 文案
  const { t } = useI18n()
  // 当前正则表达式可用的命名捕获组列表（包含参数名和类型）
  interface ParamInfo {
    name: string
    type: string
  }
  const availableParams = ref<ParamInfo[]>([])

  // 正则预览输入框的本地状态
  // 使用本地状态确保实时更新，避免 props 响应式更新的竞态条件
  const localRegex = ref(props.rule.regex || '')

  /**
   * 核心逻辑：解析正则表达式中的命名捕获组
   * @param regex - 正则表达式字符串
   * @returns 捕获组名称数组
   */
  const parseRegexParams = (regex: string) => {
    if (!regex) return []
    // 使用正则表达式匹配所有命名捕获组 (?P<name>)
    const matches = [...regex.matchAll(/\(\?P<(\w+)>/g)]
    return matches.map((m) => m[1])
  }

  // 同步本地正则状态与 props，同时更新参数列表
  watch(
    () => props.rule.regex,
    (val) => {
      const newVal = val || ''
      if (newVal !== localRegex.value) {
        localRegex.value = newVal
      }
      const extractedParams = parseRegexParams(newVal)
      const existingNames = new Set(availableParams.value.map((p) => p.name))
      for (const name of extractedParams) {
        if (!existingNames.has(name)) {
          availableParams.value.push({ name, type: 'string' })
        }
      }
    },
    { immediate: true }
  )

  // --- 更新处理器 ---

  function handleRegexUpdate(newRegex: string) {
    // 同步更新本地状态，确保正则预览实时显示
    localRegex.value = newRegex
    logger.debug('[RuleConfigPanel] 收到正则更新:', newRegex)
    // 保持规则对象不可变更新，同时通知父组件
    // 使用 localRegex.value 确保值的一致性
    emit('update:rule', { ...props.rule, regex: localRegex.value })
  }

  function handleManualRegexInput(e: Event) {
    // 用户手动编辑预览区的正则表达式
    const val = (e.target as HTMLInputElement).value
    // 检查值是否真的变化了，避免 v-model 更新时重复触发
    if (val !== localRegex.value) {
      localRegex.value = val
      emit('update:rule', { ...props.rule, regex: localRegex.value })
    }
  }

  /**
   * 同步参数并自动生成输出映射
   * @param newParams - 交互式构建器回传的参数列表（包含名称和类型）
   */
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
      const bindingKey = param.name
      if (!newOutput[bindingKey]) {
        newOutput[bindingKey] = `{${param.name}:${param.type}}`
        hasChanges = true
      }
    }

    availableParams.value = newParamList

    if (hasChanges) {
      emit('update:rule', { ...props.rule, output: newOutput, regex: localRegex.value })
    }
  }

  // --- 映射逻辑处理 ---

  /**
   * 添加新的输出键值对
   * 自动生成唯一的键名，并绑定第一个可用参数（如果存在）
   */
  function addOutputKey() {
    // 复制现有 output，避免直接修改 props
    const nextOutput = { ...(props.rule.output || {}) }
    // 生成唯一 key，优先使用捕获组名，冲突时追加后缀
    const makeUniqueKey = (base: string) => {
      const normalizedBase = String(base || '').trim() || 'field'
      if (!nextOutput[normalizedBase]) return normalizedBase
      let i = 2
      while (nextOutput[`${normalizedBase}_${i}`]) i++
      return `${normalizedBase}_${i}`
    }
    // 默认 key 来源：优先捕获组名，否则回退为 field
    const defaultKeyBase =
      availableParams.value.length > 0 ? availableParams.value[0].name : 'field'
    const newKey = makeUniqueKey(defaultKeyBase)

    // 默认绑定第一个捕获组，如果没有则空文本
    nextOutput[newKey] =
      availableParams.value.length > 0
        ? `{${availableParams.value[0].name}:${availableParams.value[0].type}}`
        : ''

    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  /**
   * 删除指定的输出键值对
   * @param key - 要删除的键名
   */
  function removeOutputKey(key: string) {
    // 删除映射项并提交更新
    const nextOutput = { ...(props.rule.output || {}) }
    delete nextOutput[key]
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  /**
   * 重命名输出键
   * @param oldKey - 原始键名
   * @param newKey - 新键名
   */
  function updateOutputKey(oldKey: string, newKey: string) {
    // 空 key 或重复 key 时不处理
    if (!newKey || oldKey === newKey) return
    const nextOutput = { ...(props.rule.output || {}) }
    // 如果目标 key 已存在，则提示并中止
    if (nextOutput[newKey]) {
      const message = t('expressions.ruleConfigPanel.keyAlreadyExists', { key: newKey })
      const toast = (
        window as unknown as { $toast?: { error: (title: string, msg: string) => void } }
      ).$toast
      if (toast) {
        toast.error(t('common.error'), message)
      } else {
        alert(message)
      }
      return
    }
    // 迁移旧值到新 key，保持映射内容不丢失
    nextOutput[newKey] = nextOutput[oldKey]
    delete nextOutput[oldKey]
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  /**
   * 更新输出值（静态文本）
   * @param key - 输出键名
   * @param val - 新的值
   */
  function updateOutputValue(key: string, val: string) {
    // 更新静态值映射，保持输出字段名不变
    const nextOutput = { ...(props.rule.output || {}) }
    nextOutput[key] = val
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  /**
   * 更新输出映射为参数绑定
   * @param key - 输出键名
   * @param paramName - 绑定的参数名
   */
  function updateOutputParam(key: string, paramName: string) {
    // 将输出值切换为参数绑定表达式 {param:type}
    const nextOutput = { ...(props.rule.output || {}) }
    const currentType = getParamType(String(nextOutput[key]))
    // 如果 key 是默认 field_n，且目标捕获组未被占用，则重命名为参数名
    if (/^field_\d+$/.test(key) && !nextOutput[paramName]) {
      nextOutput[paramName] = `{${paramName}:${currentType}}`
      delete nextOutput[key]
    } else {
      nextOutput[key] = `{${paramName}:${currentType}}`
    }
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  /**
   * 更新参数类型
   * @param key - 输出键名
   * @param type - 新的类型
   */
  function updateOutputType(key: string, type: string) {
    // 保留当前绑定的参数名，仅更新类型
    const nextOutput = { ...(props.rule.output || {}) }
    const currentParam = getParamName(String(nextOutput[key]))
    nextOutput[key] = `{${currentParam}:${type}}`
    emit('update:rule', { ...props.rule, output: nextOutput, regex: localRegex.value })
  }

  // --- 字符串解析辅助 ---

  function isParamValue(v: unknown): boolean {
    // 参数绑定格式：{paramName:type}
    return typeof v === 'string' && /^\{\w+:\w+\}$/.test(v)
  }

  function getParamName(v: string): string {
    // 解析参数名，失败时返回空字符串
    const match = v.match(/^\{(\w+):/)
    return match ? match[1] : ''
  }

  function getParamType(v: string): string {
    // 解析参数类型，失败时默认 string
    const match = v.match(/:(\w+)\}$/)
    return match ? match[1] : 'string'
  }
</script>

<style scoped src="./RuleConfigPanel.styles.css" />
