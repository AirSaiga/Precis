<!--
  @file InteractiveBuilder.vue
  @description 正则表达式交互式构建器

  允许用户通过选中文本来自动生成正则表达式片段。
  提供实时预览和手动编辑模式切换。

  功能：
  - 输入文本并高亮选中的片段
  - 根据选中内容生成正则模式片段
  - 实时预览匹配结果
  - 组合多个片段构建完整正则
-->

<template>
  <div class="interactive-builder">
    <div class="input-group">
      <label>{{ t('expressions.interactiveBuilder.inputText') }}</label>
      <textarea
        v-model="inputText"
        @mouseup="updateSelection"
        @keyup="updateSelection"
        :placeholder="t('expressions.interactiveBuilder.exampleText')"
      ></textarea>
    </div>

    <!-- 显示选中的文本 -->
    <div v-if="selectedText" class="selected-text">
      <span class="label">{{ t('expressions.interactiveBuilder.previewSelection') }}:</span>
      <span class="text">{{ selectedText }}</span>
      <button @click="clearSelection" class="clear-btn"><AppIcon name="x" :size="14" /></button>
    </div>

    <!-- 预览区域 -->
    <div v-else class="preview-area">
      <div v-if="!inputText && patternParts.length === 0" class="preview-placeholder">
        {{ t('expressions.interactiveBuilder.previewHere') }}
      </div>
      <div v-else class="preview-result">
        <span v-for="(part, index) in patternParts" :key="index" :class="getPartClass(part)">
          {{ getPartText(part) }}
        </span>
      </div>
    </div>

    <!-- 匹配高亮预览 -->
    <div v-if="matchSegments.length > 0" class="match-highlight-area">
      <div class="match-highlight-label">
        {{ t('expressions.interactiveBuilder.matchPreview') }}
      </div>
      <div class="match-highlight-text">
        <span
          v-for="(seg, i) in matchSegments"
          :key="i"
          :class="seg.isMatch ? 'seg-match' : 'seg-plain'"
          >{{ seg.text }}</span
        >
      </div>
    </div>

    <!-- 悬浮弹窗必须传入 container-ref，虽然在fixed定位下不是必须的，但为了类型完整 -->
    <SelectionPopover
      v-if="selection.text"
      :selection="selection"
      :container-ref="previewRef"
      @define-as-param="defineAsParam"
      @clear="clearSelection"
    />
    <ParamDefinitionModal
      v-if="isDefiningParam"
      @confirm="confirmParamDefinition($event)"
      @cancel="isDefiningParam = false"
    />
    <!-- 增加一个隐藏的 ref 元素给 Popover 用 -->
    <div ref="previewRef" style="display: none"></div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, reactive, watch, nextTick, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import SelectionPopover from './SelectionPopover.vue'
  import ParamDefinitionModal from './ParamDefinitionModal.vue'
  import { useToast } from '@/composables/shared/useToast'

  /**
   * 模式片段数据结构：
   * - static：纯文本片段（会被转义后拼接入正则）
   * - param：参数片段（以命名捕获组形式输出）
   */
  interface PatternPart {
    type: 'static' | 'param'
    text?: string
    name?: string
    paramType?: string
  }
  /**
   * 文本选择信息：
   * - text：当前选择的原文
   * - start/end：在 inputText 中的字符范围（半开区间）
   * - x/y：用于 Popover 的大致坐标（仅用于初始定位）
   */
  interface SelectionInfo {
    text: string
    start: number
    end: number
    x: number
    y: number
  }
  /**
   * 参数定义载体：来自 ParamDefinitionModal 的用户输入
   */
  interface ParamDefinition {
    name: string
    type: string
  }
  /**
   * 字符映射附加信息：当某字符属于参数片段时携带其 name 和 type
   */
  interface ParamInfo {
    name?: string
    paramType?: string
  }
  /**
   * 字符映射条目：
   * - char：原始字符
   * - type：当前字符属于 static 还是 param
   * - paramInfo：当 type=param 时的参数元信息
   */
  interface CharMapItem {
    char: string
    type: 'static' | 'param'
    paramInfo?: ParamInfo
  }

  const emit = defineEmits(['update:regex', 'update:params'])

  // 支持外部填充示例文本的Props
  const props = defineProps<{
    sampleText?: string
  }>()

  // 使用 i18n
  const { t } = useI18n()
  const toast = useToast()

  // 输入文本 - 初始化为空，避免与正则预览框的默认正则冲突
  const inputText = ref('')
  const selectedText = ref('')
  const previewResult = ref(false)

  // 核心状态：由多个片段组成的数组 - 初始化为空
  const patternParts = ref<PatternPart[]>([])

  // 监听外部sampleText变化，同步到内部状态
  watch(
    () => props.sampleText,
    (newText) => {
      if (newText && newText.trim()) {
        inputText.value = newText
        patternParts.value = [{ type: 'static', text: newText }]
        // 清空正则表达式，因为是新文本
        emit('update:regex', '')
        emit('update:params', [])
      }
    },
    { immediate: true }
  )

  const selection = reactive<SelectionInfo>({ text: '', start: 0, end: 0, x: 0, y: 0 })
  const isDefiningParam = ref(false)
  const paramDefinition = reactive<ParamDefinition>({ name: '', type: 'int' })
  const previewRef = ref<HTMLElement | null>(null)

  // 标志：是否正在从参数定义更新模式
  // 防止 watch 监听 inputText 变化时意外清空正则表达式
  const isUpdatingFromParamDefinition = ref(false)

  // 更新选中文本函数
  /**
   * 更新选中文本
   * 监听鼠标或键盘事件，获取用户在文本框中的选择范围
   * 并显示悬浮弹窗用于参数定义
   *
   * 关键点：
   * - 不对选择子串做 trim，保证字符位置与 charMap 对齐；
   * - 当选择为空或仅空白时，清除选择状态。
   */
  function updateSelection() {
    const activeElement = document.activeElement

    if (activeElement instanceof HTMLTextAreaElement) {
      const start = activeElement.selectionStart
      const end = activeElement.selectionEnd

      // 获取原始文本，不做 trim，确保位置精确
      const text = activeElement.value.substring(start, end)

      if (text && start !== end && text.trim().length > 0) {
        selection.text = text
        selection.start = start
        selection.end = end

        const rect = activeElement.getBoundingClientRect()
        // 这里的坐标计算只是估算，SelectionPopover 内部有更智能的计算
        selection.x = rect.left + 20
        selection.y = rect.top + 40

        selectedText.value = text
        previewResult.value = true
      } else {
        clearSelection()
      }
    } else {
      // 点击空白处根据需求决定是否清除
      // clearSelection();
    }
  }

  // 监听输入文本变化
  /**
   * 监听输入文本变化
   * 当用户修改输入文本时，智能处理参数结构的保持或重置
   *
   * 核心逻辑：
   * - 如果文本内容确实发生变化，则重置为纯文本模式
   * - 避免复杂的索引计算错误
   * - 保持数据一致性
   *
   * 设计权衡：
   * - 不做增量 diff，而是采用“文本变更即回退到静态片段”的策略；
   * - 若需保留参数结构需引入复杂 diff，此处刻意简化以保证稳定性。
   */
  watch(inputText, (newText) => {
    // 如果是内部从参数定义更新，跳过处理
    if (isUpdatingFromParamDefinition.value) {
      return
    }

    // 仅当纯文本拼接结果与输入不一致时回退到静态片段，避免频繁清空
    const currentPartsText = patternParts.value.map((p) => p.text || '').join('')
    if (currentPartsText !== newText) {
      patternParts.value = [{ type: 'static', text: newText }]
      // 文本变了，旧的正则和参数都没用了，清空
      emit('update:regex', '')
      emit('update:params', [])
    }
  })

  /**
   * 清除当前选择
   * 重置选择状态，但不清除位置信息以备后用
   *
   * 注意：
   * - 不重置 start/end，以便在 Modal 确认使用最近的选区；
   * - 仅清除 UI 展示相关状态。
   */
  function clearSelection() {
    selection.text = ''
    // 不重置 selection.start/end，以防在 Modal 确认时还需要用到位置信息
    // 但为了安全起见，通常 Modal 打开时已经拷贝了位置
    // selection.start = 0;
    // selection.end = 0;
    selectedText.value = ''
    previewResult.value = false
  }

  /**
   * 开始定义参数
   * 打开参数定义模态框
   *
   * 副作用：
   * - 切换 isDefiningParam 触发 Modal 渲染。
   */
  function defineAsParam() {
    paramDefinition.name = ''
    isDefiningParam.value = true
  }

  /**
   * 确认参数定义：使用字符映射重组策略 (Flatten-Map-Rebuild)
   * 这是最稳健的方法，专门处理“位置错乱”或者“只显示原文本”的问题
   *
   * 算法说明：
   * - Flatten：将 patternParts 展开为 charMap，逐字符附带来源片段信息；
   * - Map：对选区范围内字符标记为新的 param（统一 name/type）；
   * - Rebuild：按字符流重组为最少片段（相同类型/同名 param 合并）。
   */
  function confirmParamDefinition(payload?: ParamDefinition) {
    if (payload) {
      Object.assign(paramDefinition, payload)
    }

    if (!paramDefinition.name.trim()) {
      toast.warning(t('expressions.paramDefinitionModal.paramNameCannotBeEmpty'))
      return
    }
    isDefiningParam.value = false

    // 设置标志，防止 watch 监听 inputText 变化时意外清空正则
    isUpdatingFromParamDefinition.value = true

    const start = selection.start
    const end = selection.end
    const currentInputValue = inputText.value

    logger.debug('开始处理参数定义:', { start, end, totalLen: currentInputValue.length })

    // 1. 构建字符映射表 (Character Map)
    // 这个数组的长度必须严格等于输入文本的长度
    // 每个元素代表一个字符的元数据：它是静态的还是参数的一部分
    const charMap: CharMapItem[] = []

    // 先根据当前的 patternParts 填充 map
    for (const part of patternParts.value) {
      const pText = part.text || ''
      for (const char of pText) {
        charMap.push({
          char,
          type: part.type,
          paramInfo:
            part.type === 'param' ? { name: part.name, paramType: part.paramType } : undefined,
        })
      }
    }

    // 2. 校验同步性
    // 如果因为任何原因（比如空格、换行符处理差异）导致长度不一致，暴力重置为纯文本
    if (charMap.length !== currentInputValue.length) {
      logger.warn('状态不同步，charMap长度与inputText不一致，重置为纯文本模式重新计算')
      charMap.length = 0
      for (const char of currentInputValue) {
        charMap.push({ char, type: 'static' })
      }
    }

    // 3. 应用新的选择区域
    // 在 start 到 end 的区间内，强制将字符属性改为新的参数
    for (let i = start; i < end; i++) {
      // 边界检查，防止越界
      const item = charMap[i]
      if (item) {
        item.type = 'param'
        item.paramInfo = {
          name: paramDefinition.name,
          paramType: paramDefinition.type,
        }
      }
    }

    // 4. 重组 patternParts (Rebuild)
    const newParts: PatternPart[] = []
    let currentPart: PatternPart | null = null

    for (let i = 0; i < charMap.length; i++) {
      const charObj = charMap[i]
      if (!charObj) continue
      const isParam = charObj.type === 'param'
      // 注意：这里的 paramName 取值逻辑，如果是 static 则为 undefined
      const paramName = isParam ? charObj.paramInfo?.name : undefined

      // 判断是否需要开启新片段
      let shouldStartNew = false

      if (!currentPart) {
        shouldStartNew = true
      } else {
        // 如果类型不同（static vs param），必须切分
        if (currentPart.type !== charObj.type) {
          shouldStartNew = true
        }
        // 如果都是 param，但名字不同，也必须切分
        else if (isParam && currentPart.name !== paramName) {
          shouldStartNew = true
        }
      }

      if (shouldStartNew) {
        // 归档旧片段
        if (currentPart) {
          newParts.push(currentPart)
        }
        // 开启新片段
        currentPart = {
          type: charObj.type,
          text: charObj.char,
          // 只有是参数时才带上 name 和 paramType
          ...(isParam && charObj.paramInfo
            ? { name: paramName, paramType: charObj.paramInfo.paramType }
            : {}),
        }
      } else {
        // 延续当前片段，追加字符
        if (currentPart) currentPart.text += charObj.char
      }
    }

    // 别忘了推入最后一个循环结束时留在手中的片段
    if (currentPart) {
      newParts.push(currentPart)
    }

    // 赋值并触发更新
    patternParts.value = newParts
    logger.debug('重组完成:', JSON.parse(JSON.stringify(newParts)))

    clearSelection()

    // 等待 Vue 更新 DOM 后再计算 emit，确保逻辑一致性
    nextTick(() => {
      updateAndEmit()
      // 重置标志，允许 watch 正常工作
      isUpdatingFromParamDefinition.value = false
    })
  }

  // 核心函数：计算并向上发送结果
  /**
   * 计算并输出最终的正则表达式和参数定义
   *
   * 该函数将内部的 patternParts 转换为最终的正则表达式字符串，
   * 并提取所有参数的名称和类型信息
   *
   * 输出格式：
   * - 正则表达式：使用命名捕获组 (?P<name>pattern)
   * - 参数数组：包含参数名和类型的对象数组
   *
   * 细节：
   * - 静态片段需转义特殊字符，防止影响匹配语义；
   * - 参数片段根据 paramType 映射为具体的基础模式；
   * - generatedParams 去重，保证名称唯一。
   */
  function updateAndEmit() {
    const generatedParams: { name: string; type: string }[] = []

    const regexParts = patternParts.value.map((p) => {
      if (p.type === 'static') {
        // 转义正则表达式中的特殊字符，确保原文被正确匹配
        return p.text?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }

      // 处理参数部分
      const paramName = p.name as string
      const paramType = p.paramType || 'word'

      // 记录参数定义（去重）
      if (!generatedParams.some((gp) => gp.name === paramName)) {
        generatedParams.push({ name: paramName, type: paramType })
      }

      // 根据类型生成正则
      const regexMap: Record<string, string> = {
        int: '(-?\\d+)',
        float: '(-?\\d+(?:\\.\\d+)?)',
        word: '(\\w+)',
        non_space: '\\S+',
        anything: '.*?',
      }
      const regexPattern = regexMap[paramType] || '(.*?)'

      // 生成命名捕获组
      return `(?P<${paramName}>${regexPattern})`
    })

    const finalRegex = regexParts.join('')

    logger.debug('[InteractiveBuilder] 更新正则表达式:', {
      timestamp: new Date().toISOString(),
      regex: finalRegex,
      params: generatedParams,
      patternParts: patternParts.value.map((p) => ({
        type: p.type,
        text: p.text?.substring(0, 20),
        name: p.name,
        paramType: p.paramType,
      })),
    })

    emit('update:regex', finalRegex)
    emit('update:params', generatedParams)
  }

  // --- CSS 类名辅助 ---
  /**
   * 获取CSS类名
   * 根据片段类型返回对应的CSS类名用于样式渲染
   *
   * @param part - 模式片段
   * @returns CSS类名
   *
   * 注意：此处仅用于展示层，不影响正则计算。
   */
  function getPartClass(part: PatternPart) {
    return part.type === 'param' ? 'part-param' : 'part-static'
  }

  // --- 文本显示辅助 ---
  /**
   * 获取片段显示文本
   * 参数片段显示为 {name} 格式，静态片段显示原文
   *
   * @param part - 模式片段
   * @returns 显示文本
   *
   * 该显示仅用于 UI 预览，与最终正则拼接逻辑独立。
   */
  function getPartText(part: PatternPart) {
    // 如果是参数，显示 {name}，否则显示原文
    return part.type === 'param' ? `{${part.name}}` : part.text
  }

  // --- 匹配高亮预览 ---
  interface MatchSegment {
    text: string
    isMatch: boolean
  }

  /**
   * 计算匹配高亮片段
   * 将 inputText 按当前正则匹配结果拆分为 matched/unmatched 片段
   * 用于在预览区域高亮显示匹配的文本部分
   */
  const matchSegments = computed<MatchSegment[]>(() => {
    if (!inputText.value || patternParts.value.length === 0) return []

    // 构建正则（与 updateAndEmit 相同逻辑）
    const regexParts = patternParts.value.map((p) => {
      if (p.type === 'static') {
        return p.text?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }
      const paramType = p.paramType || 'word'
      const regexMap: Record<string, string> = {
        int: '(-?\\d+)',
        float: '(-?\\d+(?:\\.\\d+)?)',
        word: '(\\w+)',
        non_space: '\\S+',
        anything: '.*?',
      }
      const regexPattern = regexMap[paramType] || '(.*?)'
      return `(?P<${p.name}>${regexPattern})`
    })

    const finalRegex = regexParts.join('')
    if (!finalRegex) return []

    // 转换 Python (?P<name>) 为 JS (?<name>) 以便在浏览器中测试
    const jsRegex = finalRegex.replace(/\(\?P</g, '(?<')

    try {
      const re = new RegExp(jsRegex, 'g')
      const segments: MatchSegment[] = []
      let lastIndex = 0

      for (const match of inputText.value.matchAll(re)) {
        const matchStart = match.index
        const matchEnd = matchStart + match[0].length

        // 匹配之前的非匹配文本
        if (matchStart > lastIndex) {
          segments.push({ text: inputText.value.slice(lastIndex, matchStart), isMatch: false })
        }
        // 匹配的文本
        segments.push({ text: match[0], isMatch: true })
        lastIndex = matchEnd
      }

      // 最后一段非匹配文本
      if (lastIndex < inputText.value.length) {
        segments.push({ text: inputText.value.slice(lastIndex), isMatch: false })
      }

      return segments
    } catch {
      return []
    }
  })
</script>

<style scoped src="./InteractiveBuilder.styles.css"></style>
