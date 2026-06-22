/**
 * @file useRegexPattern.ts
 * @description 正则表达式模式管理组合式函数
 *
 * 【业务场景】
 * 该模块是正则表达式设计器 (RegexDesignModal) 的核心逻辑层，
 * 负责管理正则表达式的编辑、测试、保存等功能。
 *
 * 【功能模块】
 * 1. 模式编辑：管理正则表达式的模式字符串
 * 2. 标志设置：设置正则表达式的标志（g、i、m 等）
 * 3. 匹配模式：选择匹配模式（full/partial/extract）
 * 4. 实时测试：在界面上测试正则表达式效果
 * 5. 状态管理：管理测试结果和错误信息
 *
 * 【与设计器的交互】
 * - InteractiveBuilder: 提供正则测试 UI
 * - RuleConfigPanel: 提供规则配置 UI
 * - RegexDesignModal: 顶层容器，组合各子组件
 *
 * 【设计考量】
 * - 使用 Vue 的响应式系统（ref、computed）管理状态
 * - 通过 props 接收节点数据，emit 通知上层组件
 * - 封装正则表达式相关的所有操作逻辑
 *
 * 【状态说明】
 * - pattern: 正则表达式模式字符串
 * - flags: 正则表达式标志（默认为 'g' 全局匹配）
 * - matchMode: 匹配模式（full/partial/extract）
 * - caseSensitive: 是否区分大小写
 * - testText: 测试用的示例文本
 * - testResults: 测试结果（匹配列表、错误信息）
 */

import { ref, computed } from 'vue'
import type { RegexNodeData } from '@/features/regex/types'
import { eventBus } from '@/core/eventBus'
/**
 * 正则表达式模式管理
 *
 * 【功能说明】
 * 管理正则表达式节点的模式编辑、标志设置、匹配模式选择等功能。
 * 提供正则表达式的实时测试功能。
 *
 * 【使用方式】
 * 在 RegexDesignModal 或相关组件中调用：
 * ```ts
 * const {
 *   pattern,
 *   flags,
 *   testText,
 *   testResults,
 *   testRegex,
 *   savePattern
 * } = useRegexPattern(props, emit);
 * ```
 *
 * @param props - 组件属性，包含节点 ID 和数据
 * @param emit - Vue 的 emit 函数，用于向上层组件通知事件
 * @returns 包含模式管理方法和状态的对象
 */
export function useRegexPattern(
  props: { id: string; data: RegexNodeData },
  emit: (event: string, ...args: unknown[]) => void
) {
  /**
   * 国际化支持
   *
   * 【用途】
   * 获取本地化的文本内容，用于界面显示和错误信息。
   */

  /**
   * 正则表达式模式
   *
   * 【响应式保证】
   * 使用 ref 确保状态变化能触发 UI 更新
   *
   * 【初始化】
   * 从 props.data.pattern 获取初始值，默认为空字符串
   *
   * 【使用场景】
   * - 显示在正则编辑器中
   * - 执行测试匹配
   * - 保存到节点数据
   */
  const pattern = ref(props.data.pattern || '')

  /**
   * 正则表达式标志
   *
   * 【标志说明】
   * - g: 全局匹配（匹配所有结果，而非仅第一个）
   * - i: 忽略大小写
   * - m: 多行模式
   *
   * 【默认值】
   * 'g' (全局匹配)
   *
   * 【使用场景】
   * - 传递给 RegExp 构造函数
   * - 显示在标志编辑器中
   */
  const flags = ref(props.data.flags || 'g')

  /**
   * 匹配模式
   *
   * 【模式说明】
   * - full: 完整匹配（必须完全匹配整个字符串）
   * - partial: 子串匹配（只需部分匹配）
   * - extract: 提取模式（匹配并提取命名捕获组）
   *
   * 【默认值】
   * 'full' (完整匹配)
   *
   * 【与后端的对应关系】
   * 传递给后端的 match_mode 字段
   */
  const matchMode = ref(props.data.matchMode || 'full')

  /**
   * 是否区分大小写
   *
   * 【业务含义】
   * 控制正则匹配时是否区分字母大小写
   *
   * 【默认值】
   * true (区分大小写)
   *
   * 【后端处理】
   * - true: 使用正则原样匹配
   * - false: 后端会自动附加 ignorecase 标志
   */
  const caseSensitive = ref(props.data.caseSensitive ?? true)

  /**
   * 测试文本
   *
   * 【用途】
   * 用户输入的示例文本，用于测试正则表达式匹配效果
   *
   * 【初始化】
   * 空字符串，由用户输入或从数据源自动填充
   *
   * 【数据来源】
   * - 用户手动输入
   * - 从 SourcePreview 节点自动提取第一行数据
   */
  const testText = ref('')

  /**
   * 测试结果
   *
   * 【数据结构】
   * {
   *   matches: Array<{ match, index, groups? }>,  // 匹配结果列表
   *   error?: string                              // 错误信息
   * }
   *
   * 【matches 字段说明】
   * - match: 匹配的文本内容
   * - index: 匹配的起始位置
   * - groups: 捕获组内容（如果有）
   *
   * 【error 字段说明】
   * - 正则表达式编译错误信息
   * - undefined 表示没有错误
   */
  const testResults = ref<{
    matches: Array<{
      match: string
      index: number
      groups?: string[]
    }>
    error?: string
  }>({
    matches: [],
    error: undefined,
  })

  /**
   * 【计算属性：是否有测试结果】
   *
   * 【业务目的】
   * 判断是否显示测试结果面板
   *
   * 【判断条件】
   * - 有匹配结果 (matches.length > 0)
   * - 或有错误信息 (error 存在)
   */
  const hasTestResults = computed(() => {
    return testResults.value.matches.length > 0 || testResults.value.error
  })

  /**
   * 【函数：测试正则表达式】
   *
   * 【业务目的】
   * 在前端执行正则表达式测试，
   * 验证正则的语法正确性并预览匹配效果。
   *
   * 【处理流程】
   *
   * 【Step 1: 创建正则对象】
   * 使用 pattern 和 flags 创建 RegExp 对象
   * 如果语法错误，会抛出异常
   *
   * 【Step 2: 执行匹配】
   * 根据 matchMode 选择匹配策略：
   * - match (matchMode='full'): 只匹配第一个结果
   * - 其他: 全局搜索，匹配所有结果
   *
   * 【Step 3: 收集结果】
   * - 记录匹配的文本
   * - 记录匹配的起始位置
   * - 记录捕获组内容（如果有）
   *
   * 【Step 4: 更新状态】
   * - 成功：清空 error，设置 matches
   * - 失败：设置 error，清空 matches
   *
   * 【前端测试 vs 后端校验】
   * - 前端测试：即时反馈，用于正则调试
   * - 后端校验：实际数据校验，统计匹配率
   *
   * 【性能考虑】
   * - 只在 testText 变化或用户点击测试时执行
   * - 不自动触发，避免频繁计算
   */
  const testRegex = () => {
    try {
      const regex = new RegExp(pattern.value, flags.value)

      const matches: Array<{
        match: string
        index: number
        groups?: string[]
      }> = []

      if (matchMode.value === 'full') {
        const match = regex.exec(testText.value)
        if (match) {
          matches.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1),
          })
        }
      } else {
        let match
        while ((match = regex.exec(testText.value)) !== null) {
          matches.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1),
          })
        }
      }

      testResults.value = {
        matches: matches,
        error: undefined,
      }
    } catch (error) {
      testResults.value = {
        matches: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 【函数：清除测试结果】
   *
   * 【业务目的】
   * 重置测试结果状态
   *
   * 【使用场景】
   * - 用户修改正则表达式前
   * - 用户点击"清除"按钮
   */
  const clearTestResults = () => {
    testResults.value = {
      matches: [],
      error: undefined,
    }
  }

  /**
   * 【函数：保存正则表达式】
   *
   * 【业务目的】
   * 将当前的正则配置保存到节点数据，
   * 并通知上层组件进行持久化。
   *
   【触发流程】
   * 1. 构建更新的数据对象
   * 2. 通过 emit('patternSaved') 通知父组件
   * 3. 派发 CustomEvent 供其他模块监听
   *
   * 【更新字段】
   * - pattern: 正则表达式模式
   * - flags: 正则标志
   * - matchMode: 匹配模式
   * - caseSensitive: 是否区分大小写
   *
   * 【事件传递】
   * - patternSaved: 供 RegexDesignModal 监听
   * - regexPatternUpdated: 供 useRegexValidation 监听自动校验
   */
  const savePattern = () => {
    emit('patternSaved', {
      nodeId: props.id,
      pattern: pattern.value,
      flags: flags.value,
      matchMode: matchMode.value,
      caseSensitive: caseSensitive.value,
    })

    eventBus.emit('regexPatternUpdated', {
      nodeId: props.id,
      pattern: pattern.value,
      flags: flags.value,
      matchMode: matchMode.value,
      caseSensitive: caseSensitive.value,
    })
  }

  /**
   * 【函数：重置正则表达式】
   *
   * 【业务目的】
   * 将正则配置恢复到初始状态
   *
   * 【恢复内容】
   * - pattern: 恢复为 props.data.pattern
   * - flags: 恢复为 props.data.flags
   * - matchMode: 恢复为 props.data.matchMode
   * - caseSensitive: 恢复为 props.data.caseSensitive
   *
   * 【副作用】
   * 同时清除测试结果
   */
  const resetPattern = () => {
    pattern.value = props.data.pattern || ''
    flags.value = props.data.flags || 'g'
    matchMode.value = props.data.matchMode || 'full'
    caseSensitive.value = props.data.caseSensitive ?? true

    clearTestResults()
  }

  /**
   * 【函数：更新模式】
   *
   * 【用途】
   * 供外部组件直接更新正则模式
   *
   * @param newPattern - 新的正则模式字符串
   */
  const updatePattern = (newPattern: string) => {
    pattern.value = newPattern
  }

  /**
   * 【函数：更新标志】
   *
   * 【用途】
   * 供外部组件直接更新正则标志
   *
   * @param newFlags - 新的标志字符串
   */
  const updateFlags = (newFlags: string) => {
    flags.value = newFlags
  }

  /**
   * 【函数：更新匹配模式】
   *
   * 【用途】
   * 供外部组件直接更新匹配模式
   *
   * @param newMatchMode - 新的匹配模式
   */
  const updateMatchMode = (newMatchMode: 'full' | 'partial' | 'extract') => {
    matchMode.value = newMatchMode
  }

  /**
   * 【函数：切换大小写敏感】
   *
   * 【用途】
   * 切换是否区分大小写的状态
   */
  const toggleCaseSensitive = () => {
    caseSensitive.value = !caseSensitive.value
  }

  return {
    pattern,
    flags,
    matchMode,
    caseSensitive,
    testText,
    testResults,
    hasTestResults,
    testRegex,
    clearTestResults,
    savePattern,
    resetPattern,
    updatePattern,
    updateFlags,
    updateMatchMode,
    toggleCaseSensitive,
  }
}
