<!--
  @file RegexDesignModal.vue
  @description 正则表达式设计模态框

  提供交互式的正则表达式设计和测试环境：
  - 规则配置面板：编辑正则模式、匹配规则、参数定义
  - 实时预览：在样例数据上测试正则匹配效果
  - 匹配结果展示：高亮匹配成功的文本片段
  - 支持多规则和参数化正则

  通过 graphStore 的 regexDesign 模块管理状态。
-->

<template>
  <Transition name="modal-fade">
    <div
      v-show="visible"
      ref="panelRef"
      class="regex-design-modal"
      :style="panelStyle"
      @click.stop
    >
      <header class="modal-header" @mousedown="onDragStart">
        <div class="header-left">
          <h2>{{ t('regexDesignModal.title') }}</h2>
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
            {{ t('regexDesignModal.save') }}
          </button>
          <button class="close-btn" @click.stop="handleClose" :title="t('regexDesignModal.cancel')">
            &times;
          </button>
        </div>
      </header>

      <div class="modal-content">
        <div class="config-panel">
          <RuleConfigPanel
            v-if="activeRule"
            :rule="activeRule"
            :sample-text="currentSampleText"
            @update:rule="handleRuleUpdate"
            @save-all="handleSaveAll"
          />
          <div v-else class="empty-state">
            <div class="empty-icon">.*</div>
            <div class="empty-text">{{ t('regexDesignModal.selectOrAddRule') }}</div>
            <button class="add-rule-btn" @click="initDefaultRule">
              {{ t('regexDesignModal.addRule') }}
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
  import type { Rule } from '@/features/regex/types'
  import type { RegexNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useRegexConnection } from '@/features/regex/composables'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'

  /**
   * 组件属性定义
   * @param visible - 控制弹窗显示/隐藏状态
   * @param ruleData - 可选的正则节点数据，用于编辑现有规则
   */
  const props = defineProps<{
    visible: boolean
    ruleData?: RegexNodeData
  }>()

  /**
   * 组件事件定义
   * @param close - 关闭弹窗事件
   * @param save - 保存规则数据事件
   */
  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'save', ruleData: RegexNodeData): void
  }>()

  // 国际化 Hook，用于获取本地化的文本
  const { t } = useI18n()

  // 获取 graphStore 实例，用于访问全局状态
  const graphStore = useGraphStore()

  // 获取 useRegexConnection 中的 fetchSampleDataForRegexEdit 函数
  // 用于在弹窗打开时获取样例数据
  const { fetchSampleDataForRegexEdit } = useRegexConnection()
  const { showConfirm } = useGlobalConfirm()

  // --- Drag state ---
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

  // Reset position when panel becomes visible
  watch(
    () => props.visible,
    (v) => {
      if (v) {
        panelStyle.value = {}
      }
    }
  )

  /**
   * 当前样例文本
   * 使用 computed 从 store 中获取，确保数据最新
   * 这是一个响应式引用，当 store 中的值变化时会自动更新
   *
   * 数据来源：
   * - 新连接时：从数据源提取的第一行数据
   * - 打开弹窗时：从 store 获取已保存的数据
   */
  const currentSampleText = computed(() => graphStore.regexEditSampleData)

  /**
   * 内部维护的规则列表
   * 使用 ref 保持响应式状态
   * 使用深度拷贝（JSON.parse/stringify）避免直接修改 props
   *
   * 为什么需要内部状态？
   * - props.ruleData 是只读的，不能直接修改
   * - 用户编辑规则时需要实时预览效果
   * - 只有点击保存时才将数据同步回父组件
   */
  const rules = ref<Rule[]>([])

  // 保存时的快照，用于检测未保存的更改
  const savedRulesSnapshot = ref<string>('')

  // 检测是否有未保存的更改
  const hasUnsavedChanges = computed(() => {
    if (rules.value.length === 0) return false
    return JSON.stringify(rules.value) !== savedRulesSnapshot.value
  })

  /**
   * 计算当前激活的规则
   * 逻辑：默认取第一条规则进行编辑
   * 如果规则列表为空则返回 null
   */
  const activeRule = computed(() => {
    // 如果规则列表有数据，返回第一条规则
    // 否则返回 null（空状态）
    const rule = rules.value.length > 0 ? rules.value[0] : null
    logger.debug('[RegexDesignModal] activeRule computed:', {
      rulesLength: rules.value.length,
      ruleExists: !!rule,
      ruleId: rule?.id,
      ruleRegex: rule?.regex,
    })
    return rule
  })

  /**
   * 初始化默认规则
   * 创建并设置一个默认的新规则实例
   *
   * 触发场景：
   * - 完全没有数据时（没有 pattern 也没有 rules）
   * - 用户点击"添加规则"按钮
   */
  function initDefaultRule() {
    // 从 props.ruleData 获取 pattern 作为默认正则
    // 如果不存在则使用通用默认正则 '^.+$'（匹配任意非空字符）
    // 使用 Python re 模块兼容的语法（不支持命名捕获组 ?<name>）
    const defaultPattern = props.ruleData?.pattern || '^.+$'

    // 构建默认规则对象
    const defaultRule: Rule = {
      // 使用时间戳生成唯一 ID，避免冲突
      id: `rule-${Date.now()}`,
      // 默认名称
      name: t('regexDesignModal.defaultRuleName'),
      // 使用节点已保存的正则表达式或默认表达式
      regex: defaultPattern,
      // 初始描述为空
      description: '',
      // 初始输出配置为空对象
      output: {},
    }

    // 将默认规则设置到 rules 中
    rules.value = [defaultRule]
  }

  /**
   * 监听 visible 和 ruleData 变化
   * 当弹窗打开时，根据传入的数据同步内部状态
   *
   * 监听逻辑：
   * 1. visible 变为 true 时触发
   * 2. 根据 ruleData 的内容决定如何初始化 rules
   * 3. 如果样例数据为空，尝试获取样例数据
   * 4. 等待组件渲染完成
   *
   * 数据初始化优先级：
   * 1. 有 rules：深度拷贝 rules 到内部状态
   * 2. 只有 pattern：用 pattern 创建默认规则
   * 3. 都没有：调用 initDefaultRule 创建空规则
   */
  watch(
    () => props.visible,
    async (isOpened) => {
      // 只在弹窗打开时执行初始化逻辑
      if (isOpened) {
        // =====================================================
        // 场景1：有完整的规则配置
        // =====================================================
        // 使用深度克隆防止修改未保存时影响原始数据
        if (props.ruleData && props.ruleData.rules && props.ruleData.rules.length > 0) {
          rules.value = structuredClone(props.ruleData.rules)
        }
        // =====================================================
        // 场景2：只有正则表达式，没有规则配置
        // =====================================================
        else if (props.ruleData?.pattern) {
          // 用 pattern 初始化默认规则
          const defaultRule: Rule = {
            id: `rule-${Date.now()}`,
            name: props.ruleData.configName || t('regexDesignModal.defaultRuleName'),
            regex: props.ruleData.pattern,
            description: '',
            output: {},
          }
          rules.value = [defaultRule]
        }
        // =====================================================
        // 场景3：完全没有数据
        // =====================================================
        else {
          // 创建全新的默认规则
          initDefaultRule()
        }

        // =====================================================
        // 获取样例数据
        // =====================================================
        // 如果 store 中的样例数据为空，尝试获取
        // 这样可以支持打开已有正则节点的编辑弹窗
        if (!graphStore.regexEditSampleData && graphStore.activeRegexNodeId) {
          await fetchSampleDataForRegexEdit({ regexNodeId: graphStore.activeRegexNodeId })
        }

        // =====================================================
        // 等待组件渲染完成
        // =====================================================
        // 等待一个 tick 确保组件已渲染
        // 由于 currentSampleText 是 computed，会自动响应 store 中的值变化
        // RuleConfigPanel -> InteractiveBuilder 的 watch 会自动同步
        await nextTick()

        // 保存初始快照，用于检测未保存的更改
        savedRulesSnapshot.value = JSON.stringify(rules.value)
      }
    },
    { immediate: true }
  )

  /**
   * 处理规则更新
   * 由子组件 RuleConfigPanel 触发
   */
  function handleRuleUpdate(updatedRule: Rule) {
    logger.debug('[RegexDesignModal] handleRuleUpdate 收到更新:', {
      updatedRuleId: updatedRule.id,
      updatedRegex: updatedRule.regex,
      currentRulesCount: rules.value.length,
    })

    const index = rules.value.findIndex((rule) => rule.id === updatedRule.id)

    if (index !== -1) {
      logger.debug('[RegexDesignModal] 找到匹配规则，索引:', index)
      rules.value[index] = { ...updatedRule }
      logger.debug('[RegexDesignModal] 更新后的 rules[0].regex:', rules.value[0]?.regex)
    } else {
      logger.warn('[RegexDesignModal] 未找到匹配规则:', updatedRule.id)
    }
  }

  /**
   * 处理 header 中规则名输入
   */
  function handleNameInput(event: Event) {
    const name = (event.target as HTMLInputElement).value
    if (activeRule.value) {
      handleRuleUpdate({ ...activeRule.value, name })
    }
  }

  /**
   * 处理侧边栏或面板触发的全保存请求
   * 作为保存按钮的代理方法
   */
  function handleSaveAll() {
    // 直接调用 handleSave 执行保存逻辑
    handleSave()
  }

  /**
   * 关闭弹窗
   */
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

  /**
   * 保存并提交数据
   * 将编辑后的规则数据同步回父组件
   */
  function handleSave() {
    // 验证必要数据是否存在
    if (props.ruleData && activeRule.value) {
      // 直接从 rules.value[0] 获取最新的正则表达式
      // 避免 computed 缓存问题
      const currentRegex = rules.value[0]?.regex || ''
      logger.debug('[RegexDesignModal] handleSave - currentRegex from rules:', currentRegex)
      logger.debug('[RegexDesignModal] handleSave - activeRule regex:', activeRule.value.regex)

      // =====================================================
      // 构建更新的数据对象
      // =====================================================
      // 合并现有数据与更新数据
      const updatedRuleData: RegexNodeData = {
        ...props.ruleData,
        // 更新正则表达式模式到 RegexNode 显示区域
        pattern: currentRegex,
        // 保存完整的规则配置（深度拷贝避免引用问题）
        rules: structuredClone(rules.value),
      }

      logger.debug('[RegexDesignModal] handleSave - updatedRuleData:', {
        pattern: updatedRuleData.pattern,
        rules: updatedRuleData.rules,
      })

      // =====================================================
      // 触发 save 事件
      // =====================================================
      // 将更新后的数据传递给父组件
      emit('save', updatedRuleData)

      // 重置快照，标记为已保存
      savedRulesSnapshot.value = JSON.stringify(rules.value)

      // =====================================================
      // 关闭弹窗
      // =====================================================
      // 保存成功后关闭弹窗
      handleClose()
    } else {
      logger.warn('[RegexDesignModal] handleSave - 无效数据:', {
        ruleData: props.ruleData,
        activeRule: activeRule.value,
        rules: rules.value,
      })
    }
  }

  // 键盘快捷键处理
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
