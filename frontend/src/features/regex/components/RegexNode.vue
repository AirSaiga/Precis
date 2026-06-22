<!--
  @file RegexNode.vue
  @description 正则表达式验证节点组件 - 模式配置、数据校验与结果展示
-->

/** * @file RegexNode.vue * @description 正则表达式验证节点组件 * * 核心功能： * -
正则表达式模式配置（full/partial/extract三种匹配模式） * - 数据源连接与列绑定 * -
正则校验执行与结果展示 * - 校验状态管理与历史记录 * - 校验结果保存到配置文件 * * 数据流： *
Schema节点/Pattern节点 → [regex-input Handle] → RegexNode → 校验结果输出 * * 节点结构： * - 左侧输入
Handle：接收来自 Schema 节点的数据 * - Header：节点标题、操作按钮（保存、删除） * -
Summary：数据源和匹配模式的简要信息 * - Pattern Section：正则表达式模式的显示区域 * - Metrics
Row：校验结果指标（总行数、匹配数、错误数） */
<template>
  <ConstraintNodeFrame
    class="regex-constraint-node constraint-node"
    :class="['status-' + data.validationStatus, { 'fill-animation': showFillAnimation }]"
    :selected="selected"
    theme="purple"
    :state="resolveNodeState(data.validationStatus, selected)"
    :title="data.configName || t('customNodes.regexNode.title')"
    icon="🔤"
    :help-text="t('customNodes.regexNode.helpTooltip')"
    :error-count="data.errorCount || 0"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('customNodes.regexNode.closeTooltip')"
    :error-title="t('common.error')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :shell-title="data.configName || t('customNodes.regexNode.title')"
    :handles="[
      {
        id: 'regex-input',
        type: 'target',
        position: Position.Left,
        color: 'warning',
        title: t('customNodes.regexNode.inputHandle'),
      },
    ]"
    @click="onNodeClick"
    @delete="handleClose"
    @save="handleSave"
    @error-click="emit('regex-badge-click', id)"
  >
    <div class="content">
      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.regexNode.sourceLabel') }}</span>
        <span class="summary-value" :class="{ placeholder: !hasSource }">{{ sourceDisplay }}</span>
      </div>

      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.regexNode.modeLabel') }}</span>
        <span class="summary-value">{{ matchModeText }}</span>
      </div>

      <div class="pattern-section">
        <div class="pattern-header">
          <span class="summary-label">{{ t('customNodes.regexNode.pattern') }}</span>
        </div>
        <code class="mono-block" :class="{ placeholder: !hasPattern }">
          {{ hasPattern ? data.pattern : t('customNodes.regexNode.patternEmpty') }}
        </code>
      </div>

      <div v-if="hasLastValidation" class="metrics-row">
        <div class="metric-item">
          <span class="metric-label">{{ t('customNodes.regexNode.totalRows') }}:</span>
          <span class="metric-value">{{ data.totalRows || 0 }}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">{{ t('customNodes.regexNode.matchCount') }}:</span>
          <span class="metric-value">{{ data.matchCount || 0 }}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">{{ t('customNodes.regexNode.errorCount') }}:</span>
          <span class="metric-value">{{ data.errorCount || 0 }}</span>
        </div>
      </div>

      <div class="actions-row">
        <div class="status-indicator">
          <span class="status-dot" :class="'status-' + data.validationStatus"></span>
          <span class="status-text">{{ statusText }}</span>
        </div>

        <div class="action-buttons">
          <button class="secondary-btn" @click="onOpenDesigner">
            {{ t('customNodes.regexNode.openDesigner') }}
          </button>
          <button
            class="primary-btn"
            :disabled="!hasSource || !hasPattern"
            :title="
              !hasSource
                ? t('customNodes.regexNode.connectFirst')
                : t('customNodes.regexNode.startValidation')
            "
            @click="onValidateClick"
          >
            {{ t('customNodes.regexNode.validate') }}
          </button>
        </div>
      </div>

      <div v-if="showGuide" class="guide">
        <div class="guide-item" :class="{ done: hasSource }">
          ① {{ t('customNodes.regexNode.hintConnectSource') }}
        </div>
        <div class="guide-item" :class="{ done: hasPattern }">
          ② {{ t('customNodes.regexNode.hintSetPattern') }}
        </div>
        <div v-if="data.matchMode === 'extract'" class="guide-item" :class="{ done: canExtract }">
          ③ {{ t('customNodes.regexNode.hintExtractReady') }}
        </div>
      </div>

      <div v-if="!hasSource && !showGuide" class="details-hint">
        {{ t('customNodes.regexNode.connectFirst') }}
      </div>
    </div>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  /**
   * @file RegexNode.vue
   * @description 正则表达式验证节点组件
   *
   * 【业务场景】
   * 该组件是 Precis 数据质量平台中"正则校验"功能的可视化节点。
   * 用户可以将数据表的某一列连接到该节点，配置正则表达式规则后，
   * 系统会对该列的所有数据进行正则匹配验证，并返回匹配统计结果。
   *
   * 【数据流】
   * SourcePreview(原始数据) → Schema(表结构) → Regex(正则校验) → 输出结果
   *
   * 1. 左侧 Handle (regex-input): 接收来自 Schema 或 Pattern 节点的连接
   *    - 通过 sourceRef 关联到上游 Schema 节点
   *    - 通过 sourceRef.columnId / columnName 关联到具体的列
   *    - Pattern 连接时自动应用正则表达式内容
   *
   * 【组件职责】
   * 1. 展示正则节点的核心信息：
   *    - 配置名称、匹配模式、正则表达式模式
   *    - 数据源信息（表名.列名）
   *    - 校验状态（通过/错误/待机）
   * 2. 提供用户交互：
   *    - 点击"开始校验"触发正则校验逻辑
   *    - 点击状态行查看校验详情
   *    - 删除节点
   * 3. 引导用户完成配置：
   *    - 显示配置指引（连接数据源 → 设置正则 → 提取就绪）
   *    - 根据当前状态动态显示提示信息
   *
   * 【状态流转】
   * idle → (校验成功) → pass
   * idle → (校验失败) → error
   * pass/error → (修改配置) → idle
   *
   * 【依赖说明】
   * - useRegexValidation: 提供正则校验的核心逻辑
   * - graphStore: 管理节点数据和全局状态
   * - NodeDeletionManager: 处理节点删除及关联边的清理
   */

  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import type { RegexNodeData, SchemaNodeData } from '@/types/graph'
  import { NodeDeletionManager } from '@/services/managers/nodeDeletionManager'
  import { useRegexValidation } from '@/features/regex/composables'
  import { createV2Pattern, checkV2PatternExists } from '@/api/projectV2Api'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import ConstraintNodeFrame from '@/components/nodes/constraintRules/shared/ConstraintNodeFrame.vue'

  /**
   * 【组件属性定义】
   *
   * Vue Flow 节点的标准 props 结构：
   * - id: 节点的唯一标识符，由 Vue Flow 自动生成和管理
   * - data: 节点的业务数据，包含正则配置、校验状态等
   * - selected: 节点是否被选中，用于显示选中态样式
   *
   * 【设计考量】
   * 使用 defineProps 而非 props 选项，是为了配合 <script setup> 语法，
   * 实现编译时的类型检查和更好的 IDE 智能提示支持。
   */
  const props = defineProps<{
    id: string
    data: RegexNodeData
    selected?: boolean
  }>()

  /**
   * 【组件事件定义】
   *
   * 向父组件通知节点内部发生的重要事件：
   * - regex-badge-click: 当用户点击错误状态角标时触发
   *   用于通知父组件打开错误详情面板或执行过滤操作
   *
   * 【使用场景】
   * 父组件（NodeCanvas）监听此事件，根据节点 ID 定位到对应的
   * 错误行数据，并在侧边栏或弹窗中展示详细错误信息。
   */
  const emit = defineEmits<{
    'regex-badge-click': [regexNodeId: string]
  }>()

  /**
   * 【依赖初始化】
   *
   * 1. store (graphStore): 全局图存储
   *    - 提供节点的增删改查能力
   *    - 管理节点之间的连接关系（edges）
   *    - 存储当前画布的所有节点和边数据
   *
   * 2. t (useI18n): 国际化翻译函数
   *    - 用于获取本地化的文本内容
   *    - 支持中英文等多语言切换
   *
   * 3. showConfirm (useGlobalConfirm): 全局确认对话框
   *    - 提供删除确认等交互功能
   *    - 避免每个组件都重复实现确认逻辑
   *
   * 4. handleRegexValidate (useRegexValidation): 正则校验核心函数
   *    - 执行实际的正则匹配和校验逻辑
   *    - 更新节点的校验状态和统计信息
   */
  const store = useGraphStore()
  const projectStore = useProjectStore()
  const resourceTreeStore = useResourceTreeStore()
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const { handleRegexValidate } = useRegexValidation()

  const isSaving = ref(false)
  const showFillAnimation = ref(false)
  const previousPattern = ref('')
  const showRegisterAsPattern = ref(false)
  const patternName = ref('')

  watch(
    () => props.data.pattern,
    (newPattern, oldPattern) => {
      const oldIsEmpty = !oldPattern || oldPattern === '' || oldPattern === '^.+$'
      const newHasContent = newPattern && newPattern.length > 0

      if (newHasContent && oldIsEmpty) {
        showFillAnimation.value = true
        setTimeout(() => {
          showFillAnimation.value = false
        }, 600)
      }
      previousPattern.value = newPattern || ''
    },
    { immediate: true }
  )

  async function handleSave() {
    if (isSaving.value) return

    if (!hasUsesPattern.value && hasPattern.value) {
      const shouldRegister = await showConfirm({
        title: t('customNodes.regexNode.registerAsPatternTitle') || '注册为 Pattern',
        message:
          t('customNodes.regexNode.registerAsPatternMessage') ||
          '是否将此正则表达式注册为可复用的 Pattern？',
        confirmText: t('customNodes.regexNode.registerAsPatternConfirm') || '注册',
        cancelText: t('common.cancel') || '取消',
        type: 'info',
      })

      if (shouldRegister) {
        const configPath = projectStore.currentPaths?.configPath
        if (!configPath) {
          logger.error('无法获取项目配置路径')
          return
        }
        const defaultName = String(props.data.configName || props.id || 'pattern')
        patternName.value = defaultName

        const existsResult = await checkV2PatternExists(patternName.value, configPath)
        let finalName = patternName.value
        let overwrite = false

        if (existsResult.exists) {
          const shouldOverwrite = await showConfirm({
            title: t('customNodes.regexNode.patternExistsTitle') || 'Pattern 已存在',
            message:
              t('customNodes.regexNode.patternExistsMessage') ||
              `Pattern "${patternName.value}" 已存在，是否覆盖？`,
            confirmText: t('customNodes.regexNode.overwrite') || '覆盖',
            cancelText: t('customNodes.regexNode.useNewName') || '使用新名称',
            type: 'warning',
          })

          if (shouldOverwrite) {
            overwrite = true
          } else {
            let counter = 1
            while (true) {
              finalName = `${patternName.value}_${counter}`
              const newExists = await checkV2PatternExists(finalName, configPath)
              if (!newExists.exists) break
              counter++
            }
          }
        }

        try {
          await createV2Pattern(
            {
              name: finalName,
              regex: props.data.pattern,
              description: props.data.description || '',
              overwrite,
            },
            configPath
          )

          // eslint-disable-next-line vue/no-mutating-props
          props.data.uses_pattern = {
            registry: 'patterns',
            pattern_name: finalName,
          }
          // eslint-disable-next-line vue/no-mutating-props
          props.data.pattern = ''
        } catch (error) {
          logger.error('注册 Pattern 失败:', error)
          return
        }
      }
    }

    isSaving.value = true
    try {
      await store.saveRegexNode(props.id)
    } finally {
      isSaving.value = false
    }
  }

  /**
   * 【计算属性：是否有数据源】
   *
   * 【业务含义】
   * 判断当前正则节点是否已连接到上游的 Schema 节点。
   * 这是执行校验的前置条件。
   *
   * 【使用场景】
   * - 控制"开始校验"按钮的禁用状态
   * - 显示/隐藏连接指引
   * - 决定详情面板中的提示信息
   */
  const hasSource = computed(() => !!props.data.sourceRef?.nodeId)

  /**
   * 【计算属性：是否有正则模式】
   *
   * 【业务含义】
   * 判断用户是否已配置正则表达式模式。
   * 这是执行校验的另一个前置条件。
   *
   * 【实现细节】
   * - 使用 String() 包装确保类型安全
   * - trim() 过滤纯空格的无效模式
   */
  const hasPattern = computed(() => !!String(props.data.pattern || '').trim())

  const hasUsesPattern = computed(() => {
    return !!props.data.uses_pattern && props.data.uses_pattern.pattern_name
  })

  /**
   * 【计算属性：上游 Schema 节点】
   *
   * 【数据来源】
   * 根据 sourceRef.nodeId 在 store.nodes 中查找类型为 'schema' 的节点。
   *
   * 【使用场景】
   * - 获取 Schema 节点的表名、列定义等信息
   * - 用于 sourceDisplay 计算属性
   * - 传递给 useRegexValidation 执行实际校验
   *
   * 【边缘情况】
   * - sourceRef.nodeId 为空时返回 null
   * - 节点已被删除时返回 null
   */
  const schemaNode = computed(() => {
    if (!props.data.sourceRef?.nodeId) return null
    return (
      store.nodes.find(
        (n) =>
          (n.type === 'schema' || n.type === 'jsonSchema') && n.id === props.data.sourceRef?.nodeId
      ) || null
    )
  })

  /**
   * 【计算属性：数据源显示文本】
   *
   * 【业务目的】
   * 生成用户在节点卡片上看到的数据源信息。
   *
   * 【显示格式】
   * - 未连接：显示本地化占位文本
   * - 已连接：格式为 "表名.列名"
   *
   * 【数据来源】
   * - 优先从画布上的 schema 节点 data.tableName（反映可能的编辑）
   * - 回退到 resourceTreeStore 中按 sourceRef.nodeId 查找的 schema 资源 name
   * - 最终回退到"未注册表"并发出 warn 日志
   */
  const sourceDisplay = computed(() => {
    const srcRef = props.data.sourceRef
    if (!srcRef?.nodeId) return t('customNodes.regexNode.sourceNotConnected')
    const resource = resourceTreeStore.resources[srcRef.nodeId]
    const canvasName = (schemaNode.value?.data as SchemaNodeData | undefined)?.tableName
    const resourceName = resource?.kind === 'schema' ? resource.name : undefined
    const tableName = canvasName || resourceName
    if (!tableName) {
      logger.warn(
        '[RegexNode] 无法找到 schema 节点或资源树中的表名, sourceRef.nodeId:',
        srcRef.nodeId
      )
      return t('customNodes.regexNode.unregisteredTable')
    }
    const columnObj = (
      (schemaNode.value?.data as unknown as Record<string, unknown>)?.columns as
        | unknown[]
        | undefined
    )?.find((c) => (c as Record<string, unknown>).id === srcRef.columnId) as
      | Record<string, unknown>
      | undefined
    const col = (columnObj?.columnName as string) || ''
    if (!col) return `${tableName}.${t('customNodes.regexNode.columnNotSelected')}`
    return `${tableName}.${col}`
  })

  /**
   * 【计算属性：匹配模式显示文本】
   *
   * 【业务目的】
   * 将 matchMode 枚举值转换为用户可读的本地化文本。
   *
   * 【值映射】
   * - 'full' → 完整匹配
   * - 'partial' → 子串匹配
   * - 'extract' → 提取模式
   * - 其他 → 未知模式
   */
  const matchModeText = computed(() => getMatchModeText())

  /**
   * 【计算属性：输出映射条目】
   *
   * 【业务目的】
   * 从 rules[0].output 中提取有效的键值对。
   *
   * 【过滤条件】
   * - 键不能为空或纯空白字符
   *
   * 【使用场景】
   * - 判断 canExtract 计算属性
   * - 传递给后端用于派生列生成
   */
  const outputMappingEntries = computed(() => {
    const outputMapping = props.data.rules?.[0]?.output || {}
    return Object.entries(outputMapping).filter(([k]) => String(k ?? '').trim() !== '')
  })

  /**
   * 【计算属性：是否可以提取】
   *
   * 【业务含义】
   * 判断当前配置是否满足"提取模式"的前置条件。
   *
   * 【判断逻辑】
   * - 非 extract 模式：始终返回 true（无需提取）
   * - extract 模式 + 有输出映射：返回 true
   * - extract 模式 + 无输出映射：检查正则中是否包含命名捕获组 (?P<name>...)
   *
   * 【命名捕获组正则】
   * /\(\?P<(\w+)>/g 用于检测正则表达式中的命名捕获组定义
   */
  const canExtract = computed(() => {
    if (props.data.matchMode !== 'extract') return true
    if (outputMappingEntries.value.length > 0) return true
    return /\(\?P<(\w+)>/g.test(props.data.pattern || '')
  })

  /**
   * 【计算属性：是否显示指引】
   *
   * 【业务目的】
   * 根据当前节点状态决定是否显示配置指引。
   *
   * 【显示条件】
   * - 校验状态为 error 时不显示（已校验完成）
   * - 未连接数据源时显示（需要连接）
   * - 未设置正则模式时显示（需要设置）
   * - extract 模式且无法提取时显示（需要配置输出映射或命名捕获组）
   */
  const showGuide = computed(() => {
    if (props.data.validationStatus === 'error') return false
    if (!hasSource.value) return true
    if (!hasPattern.value) return true
    if (props.data.matchMode === 'extract' && !canExtract.value) return true
    return false
  })

  /**
   * 【计算属性：状态文本】
   *
   * 【业务目的】
   * 将 validationStatus 转换为用户可读的本地化状态描述。
   *
   * 【值映射】
   * - 'idle' → 待校验
   * - 'pass' → 校验通过
   * - 'error' → 校验失败
   */
  const statusText = computed(() => {
    const statusMap: Record<string, string> = {
      idle: t('customNodes.regexNode.statusIdle'),
      pass: t('customNodes.regexNode.statusPass'),
      error: t('customNodes.regexNode.statusError'),
    }
    return statusMap[props.data.validationStatus] || statusMap.idle
  })

  /**
   * 【计算属性：是否有最近校验结果】
   *
   * 【业务含义】
   * 判断节点是否有已保存的校验历史记录。
   *
   * 【判断依据】
   * - totalRows 有值：已执行过校验
   * - matchCount 有值：已执行过校验
   * - errorCount 有值：已执行过校验
   * - lastValidationTime 有值：曾完成过校验
   */
  const hasLastValidation = computed(() => {
    return (
      typeof props.data.totalRows === 'number' ||
      typeof props.data.matchCount === 'number' ||
      typeof props.data.errorCount === 'number' ||
      !!props.data.lastValidationTime
    )
  })

  /**
   * 【函数：获取匹配模式文本】
   *
   * 【业务目的】
   * 将 matchMode 枚举值映射为本地化的显示文本。
   *
   * 【参数说明】
   * 无（直接读取 props.data.matchMode）
   *
   * 【返回值】
   * 对应模式的本地化显示名称
   */
  function getMatchModeText(): string {
    switch (props.data.matchMode) {
      case 'full':
        return t('customNodes.regexNode.matchModes.full')
      case 'partial':
        return t('customNodes.regexNode.matchModes.partial')
      case 'extract':
        return t('customNodes.regexNode.matchModes.extract')
      default:
        return t('customNodes.regexNode.matchModes.unknown')
    }
  }

  /**
   * 【函数：节点点击处理】
   *
   * 【业务目的】
   * 处理用户点击节点主体的事件。
   *
   * 【当前实现】
   * 空函数（预留扩展）。
   *
   * 【设计考量】
   * 预留此钩子是为了后续可能需要：
   * - 点击节点打开配置弹窗
   * - 触发节点编辑模式
   * - 其他交互逻辑
   *
   * 【扩展建议】
   * 可根据需求实现打开正则设计器、编辑配置等功能。
   */
  function onNodeClick() {
    // 当前为空实现，预留扩展
  }

  /**
   * 【函数：关闭/删除节点】
   *
   * 【业务目的】
   * 处理用户点击关闭按钮的事件，执行节点删除流程。
   *
   * 【处理流程】
   * 1. 显示删除确认对话框（防止误操作）
   * 2. 用户确认后，调用 NodeDeletionManager 删除节点
   * 3. NodeDeletionManager 会自动清理关联的边
   *
   * 【设计考量】
   * 使用全局确认对话框确保用户体验一致性。
   * 使用 NodeDeletionManager 集中处理删除逻辑，确保：
   * - 节点与关联边一起被清理
   * - 可能触发其他相关节点的联动更新
   *
   * 【国际化】
   * 所有对话框文本均通过 t() 函数获取，支持多语言。
   */
  async function handleClose() {
    const confirmed = await showConfirm({
      title: t('customNodes.regexNode.closeConfirm.title'),
      message: t('customNodes.regexNode.closeConfirm.message'),
      confirmText: t('customNodes.regexNode.closeConfirm.confirm'),
      cancelText: t('customNodes.regexNode.closeConfirm.cancel'),
      type: 'error',
    })

    if (confirmed) {
      const manager = NodeDeletionManager.getInstance()
      await manager.delete(props.id)
    }
  }

  /**
   * 【函数：打开正则设计器】
   *
   * 【业务目的】
   * 用户点击"打开设计器"按钮时，触发正则设计器弹窗。
   *
   * 【实现逻辑】
   * 调用 store.openRegexDesignModal 方法，传入当前节点 ID。
   * 该方法会设置 designModalVisible 为 true 并记录 activeRegexNodeId。
   *
   * 【后续流程】
   * RegexDesignModal 组件监听 designModalVisible 变化，
   * 并根据 activeRegexNodeId 加载对应的正则节点数据。
   */
  function onOpenDesigner() {
    store.openRegexDesignModal(props.id)
  }

  /**
   * 【函数：开始校验按钮点击】
   *
   * 【业务目的】
   * 用户点击"开始校验"按钮时，触发正则校验流程。
   *
   * 【前置条件检查】
   * - 必须已连接数据源（hasSource 为 true）
   * - 必须已配置正则模式（hasPattern 为 true）
   *
   * 【校验流程】
   * 1. 检查 sourceRef.nodeId 是否存在
   * 2. 调用 useRegexValidation 的 handleRegexValidate 方法
   * 3. 等待校验完成，更新节点状态
   *
   * 【状态更新】
   * 校验过程中 validationStatus 可能变为 'idle'，
   * 校验完成后根据结果变为 'pass' 或 'error'。
   *
   * 【错误处理】
   * - 未连接数据源时直接返回（不执行校验）
   * - 校验过程中的错误由 handleRegexValidate 内部处理
   */
  async function onValidateClick() {
    if (!props.data.sourceRef?.nodeId) {
      return
    }

    await handleRegexValidate(props.id)
  }

  /**
   * 【函数：执行节点校验（备用入口）】
   *
   * 【业务目的】
   * 提供另一种调用校验逻辑的方式。
   *
   * 【使用场景】
   * 供外部模块（如父组件）调用，提供与 onValidateClick 相同的功能。
   *
   * 【实现逻辑】
   * 直接委托给 handleRegexValidate 执行实际校验。
   */
  async function performNodeValidation() {
    await handleRegexValidate(props.id)
  }
</script>

<style scoped src="./RegexNode.styles.css" />
