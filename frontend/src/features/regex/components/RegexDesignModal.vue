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
  <!-- 使用 v-show 保持组件内部状态，并在视觉上通过 transition 提供动画 -->
  <Transition name="modal-fade">
    <div v-show="visible" class="regex-design-modal-overlay" @click="handleOverlayClick">
      <div class="regex-design-modal" @click.stop>
        <!-- 弹窗头部 -->
        <header class="modal-header">
          <div class="header-title">
            <span class="rx-icon">🔤</span>
            <h2>{{ t('regexDesignModal.title') }}</h2>
          </div>
          <button class="close-btn" @click="handleClose" :title="t('regexDesignModal.cancel')">
            <span class="close-icon">&times;</span>
          </button>
        </header>

        <!-- 弹窗内容 -->
        <div class="modal-content">
          <!-- 侧边栏：如果是多规则模式可以在此扩展，目前保持单规则展示 -->
          <div class="config-panel">
            <RuleConfigPanel
              v-if="activeRule"
              :rule="activeRule"
              :sample-text="currentSampleText"
              @update:rule="handleRuleUpdate"
              @save-all="handleSaveAll"
            />
            <!-- 空状态处理 -->
            <div v-else class="empty-state">
              <div class="empty-icon">🔍</div>
              <div class="empty-text">{{ t('regexDesignModal.selectOrAddRule') }}</div>
              <button class="add-rule-btn" @click="initDefaultRule">
                {{ t('regexDesignModal.addRule') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 弹窗底部 -->
        <footer class="modal-footer">
          <div class="footer-tips">
            {{ t('regexDesignModal.autoSaveTip') }}
          </div>
          <div class="footer-actions">
            <button class="cancel-btn" @click="handleClose">
              {{ t('regexDesignModal.cancel') }}
            </button>
            <button class="save-btn" @click="handleSave">
              <i class="icon-check"></i>
              {{ t('regexDesignModal.save') }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, computed, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import RuleConfigPanel from './RuleConfigPanel.vue'
  import type { Rule } from '@/features/regex/types'
  import type { RegexNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useRegexConnection } from '@/features/regex/composables'

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
      name: '新规则',
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
          rules.value = JSON.parse(JSON.stringify(props.ruleData.rules))
        }
        // =====================================================
        // 场景2：只有正则表达式，没有规则配置
        // =====================================================
        else if (props.ruleData?.pattern) {
          // 用 pattern 初始化默认规则
          const defaultRule: Rule = {
            id: `rule-${Date.now()}`,
            name: props.ruleData.configName || '新规则',
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

    // 在 rules 数组中查找匹配的规则
    const index = rules.value.findIndex((rule) => rule.id === updatedRule.id)

    // 如果找到，更新该规则
    if (index !== -1) {
      logger.debug('[RegexDesignModal] 找到匹配规则，索引:', index)
      // 使用展开运算符创建新对象，触发响应式更新
      rules.value[index] = { ...updatedRule }
      logger.debug('[RegexDesignModal] 更新后的 rules[0].regex:', rules.value[0]?.regex)
    } else {
      logger.warn('[RegexDesignModal] 未找到匹配规则:', updatedRule.id)
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
   * 触发 close 事件，通知父组件关闭弹窗
   */
  function handleClose() {
    // 触发 close 事件
    emit('close')
  }

  /**
   * 遮罩层点击处理
   * 点击遮罩层时关闭弹窗
   *
   * 扩展建议：
   * 如果有内容变动，可以在这里增加二次确认弹窗
   * 防止用户误操作导致未保存的数据丢失
   */
  function handleOverlayClick() {
    // 如果有内容变动，可以在这里增加确认弹窗
    handleClose()
  }

  /**
   * 保存并提交数据
   * 将编辑后的规则数据同步回父组件
   */
  function handleSave() {
    // 验证必要数据是否存在
    if (props.ruleData && activeRule.value) {
      // 从 RuleConfigPanel 中获取当前正则表达式
      const currentRegex = activeRule.value.regex || ''
      logger.debug('[RegexDesignModal] handleSave - currentRegex:', currentRegex)

      // =====================================================
      // 构建更新的数据对象
      // =====================================================
      // 合并现有数据与更新数据
      const updatedRuleData: RegexNodeData = {
        ...props.ruleData,
        // 更新正则表达式模式到 RegexNode 显示区域
        pattern: currentRegex,
        // 保存完整的规则配置（深度拷贝避免引用问题）
        rules: JSON.parse(JSON.stringify(rules.value)),
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

      // =====================================================
      // 关闭弹窗
      // =====================================================
      // 保存成功后关闭弹窗
      handleClose()
    } else {
      logger.warn('[RegexDesignModal] handleSave - 无效数据:', {
        ruleData: props.ruleData,
        activeRule: activeRule.value,
      })
    }
  }
</script>

<style scoped src="./RegexDesignModal.styles.css"></style>
