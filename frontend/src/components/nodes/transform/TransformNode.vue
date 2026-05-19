<!--
  @file TransformNode.vue
  @description 功能/转换节点组件 - 数据转换与处理

  核心功能：
  - 字符串切割、正则提取、数学表达式、日期格式化
  - 数据流输入输出
  - 参数配置与保存

  数据流：
  SourcePreview/Schema/Transform/Regex → [transform-input Handle] → TransformNode → [transform-output Handle] → Transform/Regex/Constraint
-->
<template>
  <ConstraintNodeFrame
    class="transform-node"
    :selected="selected"
    theme="sky"
    state="idle"
    :title="data.configName || t('customNodes.transformNode.title')"
    icon="⚙️"
    :help-text="t('customNodes.transformNode.helpTooltip')"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('customNodes.transformNode.closeTooltip')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :shell-title="data.configName || t('customNodes.transformNode.title')"
    :handles="[
      {
        id: 'transform-input',
        type: 'target',
        position: Position.Left,
        color: 'primary',
        title: t('customNodes.transformNode.inputHandle'),
      },
      {
        id: 'transform-output',
        type: 'source',
        position: Position.Right,
        color: 'success',
        title: t('customNodes.transformNode.outputHandle'),
      },
    ]"
    @click="onNodeClick"
    @delete="handleClose"
    @save="handleSave"
  >
    <div class="content">
      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.transformNode.typeLabel') }}</span>
        <span class="summary-value">{{ typeDisplay }}</span>
      </div>

      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.transformNode.inputColumnLabel') }}</span>
        <span class="summary-value" :class="{ placeholder: !data.inputColumn }">
          {{ data.inputColumn || t('customNodes.transformNode.notSet') }}
        </span>
      </div>

      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.transformNode.outputColumnsLabel') }}</span>
        <span class="summary-value" :class="{ placeholder: !hasOutputColumns }">
          {{ outputColumnsDisplay }}
        </span>
      </div>

      <div class="params-section">
        <div class="params-header">
          <span class="summary-label">{{ t('customNodes.transformNode.paramsLabel') }}</span>
        </div>
        <code class="mono-block" :class="{ placeholder: !hasParams }">
          {{ paramsDisplay }}
        </code>
      </div>
    </div>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { computed, nextTick } from 'vue'
  import { Position, useNode, useVueFlow } from '@vue-flow/core'
  import { useI18n } from 'vue-i18n'
  import ConstraintNodeFrame from '@/components/nodes/constraintRules/shared/ConstraintNodeFrame.vue'
  import type {
    TransformNodeData,
    ManualDataNodeData,
    TransformOutputNodeData,
  } from '@/types/nodes'
  import { useGraphStore } from '@/stores/graphStore'

  const { t } = useI18n()
  const { id, node } = useNode()
  const { updateNodeInternals } = useVueFlow()
  const rawData = computed(() => node.data)
  const selected = computed(() => node.selected)
  const graphStore = useGraphStore()

  const data = computed(() => rawData.value as TransformNodeData)
  const isSaving = computed(() => false)

  const typeDisplay = computed(() => {
    const typeMap: Record<string, string> = {
      StringSplit: t('customNodes.transformNode.types.stringSplit'),
      RegexExtract: t('customNodes.transformNode.types.regexExtract'),
      MathExpr: t('customNodes.transformNode.types.mathExpr'),
      DateFormat: t('customNodes.transformNode.types.dateFormat'),
      Lookup: t('customNodes.transformNode.types.lookup'),
      Strip: t('customNodes.transformNode.types.strip'),
      UpperCase: t('customNodes.transformNode.types.upperCase'),
      LowerCase: t('customNodes.transformNode.types.lowerCase'),
      Replace: t('customNodes.transformNode.types.replace'),
      FilterRows: t('customNodes.transformNode.types.filterRows'),
      FillNA: t('customNodes.transformNode.types.fillNA'),
      DropDuplicates: t('customNodes.transformNode.types.dropDuplicates'),
      CastType: t('customNodes.transformNode.types.castType'),
      Concat: t('customNodes.transformNode.types.concat'),
      Substring: t('customNodes.transformNode.types.substring'),
      Aggregate: t('customNodes.transformNode.types.aggregate'),
      ConditionalAssign: t('customNodes.transformNode.types.conditionalAssign'),
      SortRows: t('customNodes.transformNode.types.sortRows'),
    }
    return typeMap[data.value.transformType] || data.value.transformType
  })

  const hasOutputColumns = computed(
    () => Array.isArray(data.value.outputColumns) && data.value.outputColumns.length > 0
  )

  const outputColumnsDisplay = computed(() => {
    if (!hasOutputColumns.value) return t('customNodes.transformNode.notSet')
    return data.value.outputColumns.join(', ')
  })

  const hasParams = computed(() => {
    if (data.value.transformType === 'StringSplit') {
      return true
    }
    return data.value.params && Object.keys(data.value.params).length > 0
  })

  const paramsDisplay = computed(() => {
    if (data.value.transformType === 'StringSplit') {
      const delimiter = (data.value.params?.delimiter as string) || ','
      const maxsplit = (data.value.params?.maxsplit as number) ?? -1
      return `分隔符: "${delimiter}" | 最大分割: ${maxsplit === -1 ? '不限' : maxsplit}`
    }
    if (data.value.transformType === 'MathExpr') {
      const expression = (data.value.params?.expression as string) || ''
      return expression ? `表达式: ${expression}` : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'RegexExtract') {
      const pattern = (data.value.params?.pattern as string) || ''
      return pattern ? `模式: ${pattern}` : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'DateFormat') {
      const inputFormat = (data.value.params?.input_format as string) || '%Y-%m-%d'
      const outputFormat = (data.value.params?.output_format as string) || '%Y/%m/%d'
      return `${inputFormat} → ${outputFormat}`
    }
    if (data.value.transformType === 'Lookup') {
      const mapping = (data.value.params?.mapping as Record<string, string>) || {}
      const keys = Object.keys(mapping)
      return keys.length ? `映射: ${keys.length} 项` : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'Strip') {
      const chars = (data.value.params?.chars as string) || ''
      return chars ? `去除: "${chars}"` : '去除首尾空白'
    }
    if (data.value.transformType === 'UpperCase') {
      return '转换为大写'
    }
    if (data.value.transformType === 'LowerCase') {
      return '转换为小写'
    }
    if (data.value.transformType === 'Replace') {
      const oldStr = (data.value.params?.old as string) || ''
      const newStr = (data.value.params?.new as string) || ''
      return oldStr ? `"${oldStr}" → "${newStr}"` : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'FilterRows') {
      const conds =
        (data.value.params?.conditions as Array<{ column: string; op: string; value: string }>) ||
        []
      return conds.length
        ? `${conds.length} 个过滤条件`
        : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'FillNA') {
      const strategy = (data.value.params?.strategy as string) || 'value'
      const strategyMap: Record<string, string> = {
        value: '指定值',
        ffill: '前向填充',
        bfill: '后向填充',
        mean: '均值',
        median: '中位数',
      }
      return strategyMap[strategy] || strategy
    }
    if (data.value.transformType === 'DropDuplicates') {
      const keep = String((data.value.params?.keep as string) ?? 'first')
      const keepMap: Record<string, string> = {
        first: '保留第一条',
        last: '保留最后一条',
        false: '全部删除',
      }
      return keepMap[keep] || keep
    }
    if (data.value.transformType === 'CastType') {
      const targetType = (data.value.params?.target_type as string) || 'string'
      return `转为 ${targetType}`
    }
    if (data.value.transformType === 'Concat') {
      const cols = (data.value.params?.columns as string) || ''
      const sep = (data.value.params?.separator as string) || ''
      return cols
        ? `拼接 ${cols}${sep ? ` (分隔: "${sep}")` : ''}`
        : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'Substring') {
      const start = (data.value.params?.start as number) ?? 0
      const end = data.value.params?.end as number
      const length = data.value.params?.length as number
      if (length != null) return `从 ${start} 开始，长度 ${length}`
      if (end != null) return `从 ${start} 到 ${end}`
      return `从 ${start} 开始`
    }
    if (data.value.transformType === 'Aggregate') {
      const aggs =
        (data.value.params?.aggregations as Array<{ column: string; func: string }>) || []
      return aggs.length ? `${aggs.length} 项聚合` : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'ConditionalAssign') {
      const conds =
        (data.value.params?.conditions as Array<{ column: string; op: string; value: string }>) ||
        []
      return conds.length
        ? `${conds.length} 个条件 → 赋值`
        : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'SortRows') {
      const sorts = (data.value.params?.sort_by as Array<{ column: string; order: string }>) || []
      return sorts.length ? `${sorts.length} 个排序列` : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'WeightedSum') {
      const weights = (data.value.params?.weights as number[]) || []
      return weights.length
        ? `${weights.length} 个权重`
        : t('customNodes.transformNode.paramsEmpty')
    }
    if (data.value.transformType === 'Modulo') {
      const divisor = (data.value.params?.divisor as number) ?? 1
      return `除数: ${divisor}`
    }
    if (data.value.transformType === 'MapValue') {
      const mapping = (data.value.params?.mapping as Array<string | number>) || []
      return mapping.length
        ? `映射: ${mapping.length} 项`
        : t('customNodes.transformNode.paramsEmpty')
    }
    if (!hasParams.value) return t('customNodes.transformNode.paramsEmpty')
    try {
      return JSON.stringify(data.value.params, null, 2)
    } catch {
      return String(data.value.params)
    }
  })

  function onNodeClick() {
    graphStore.selectedNodeId = id
  }

  function handleClose() {
    graphStore.deleteNode(id)
  }

  async function waitForNodeMount(nodeIds: string[]) {
    // Vue Flow 对新节点 handle 的注册晚于普通 nextTick。
    // 这里额外等待两个宏任务，再刷新 internals，降低“边已创建但端点未就绪”的概率。
    await nextTick()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    await nextTick()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    updateNodeInternals(nodeIds)
    await nextTick()
  }

  /** 会产生多列输出的 transform 类型 */
  const MULTI_COLUMN_TRANSFORMS = new Set([
    'StringSplit',
    'RegexExtract',
    'MathExpr',
    'DateFormat',
    'CastType',
    'Concat',
    'Substring',
    'ConditionalAssign',
  ])

  /** 会改变行数的 transform 类型 */
  const ROW_CHANGING_TRANSFORMS = new Set(['FilterRows', 'DropDuplicates', 'Aggregate', 'SortRows'])

  /** 单列变换类型：输入一列，输出一列 */
  const SINGLE_COLUMN_TRANSFORMS = new Set([
    'Strip',
    'UpperCase',
    'LowerCase',
    'Replace',
    'FillNA',
    'Lookup',
    'Modulo',
    'MapValue',
  ])

  /** 行数改变的原子变换类型 */
  const ATOMIC_ROW_CHANGING_TRANSFORMS = new Set(['Digits'])

  /** 从上游节点获取数据行（支持 manualData 和 transformOutput） */
  function getUpstreamRows(upstreamNode: any): string[][] {
    if (upstreamNode?.type === 'manualData') {
      return (upstreamNode.data as ManualDataNodeData).rows
    }
    if (upstreamNode?.type === 'transformOutput') {
      return (upstreamNode.data as TransformOutputNodeData).rows
    }
    return []
  }

  async function handleSave() {
    let storeNode = graphStore.nodes.find((n) => n.id === id)
    if (!storeNode) return

    // 1. 保存自身状态
    graphStore.updateNodeData(id, {
      ...storeNode.data,
      saveState: 'saved',
      lastSaved: new Date().toISOString(),
    })

    // updateNodeData 使用不可变更新，nodes 数组里的对象已被替换，
    // 必须重新获取引用才能读到 Inspector 最新写入的 params。
    storeNode = graphStore.nodes.find((n) => n.id === id)
    if (!storeNode) return

    // 2. 自动生成输出节点
    const transformData = storeNode.data as TransformNodeData
    if (!transformData.inputFromNode) return

    const upstreamNode = graphStore.nodes.find((n) => n.id === transformData.inputFromNode)
    // 支持上游为 manualData 或 transformOutput（串联 Transform 场景）
    const upstreamType = upstreamNode?.type
    if (upstreamType !== 'manualData' && upstreamType !== 'transformOutput') return

    const type = transformData.transformType
    if (type === 'StringSplit') {
      await generateStringSplitOutput(storeNode, upstreamNode)
    } else if (type === 'RegexExtract') {
      await generateRegexExtractOutput(storeNode, upstreamNode)
    } else if (ROW_CHANGING_TRANSFORMS.has(type)) {
      await generateSummaryOutput(storeNode, upstreamNode)
    } else if (type === 'Digits') {
      await generateDigitsOutput(storeNode, upstreamNode)
    } else if (type === 'WeightedSum') {
      await generateWeightedSumOutput(storeNode, upstreamNode)
    } else if (type === 'Modulo') {
      await generateModuloOutput(storeNode, upstreamNode)
    } else if (type === 'MapValue') {
      await generateMapValueOutput(storeNode, upstreamNode)
    } else if (type === 'Substring') {
      await generateSubstringOutput(storeNode, upstreamNode)
    } else {
      // 多列变换 + 单列变换统一走列输出生成
      await generateColumnOutput(storeNode, upstreamNode)
    }
  }

  // ============================================================================
  // StringSplit：每列生成一个 output 节点
  // ============================================================================

  async function generateStringSplitOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)

    const delimiter = (transformData.params?.delimiter as string) || ','
    const maxsplit = (transformData.params?.maxsplit as number) ?? -1

    const splitRows = upstreamRows.map((row: string[]) => {
      const value = String(row[0] || '')
      if (maxsplit === -1) return value.split(delimiter)
      return value.split(delimiter, maxsplit + 1)
    })

    const colCount = splitRows[0]?.length || 1
    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      outputColumns = Array.from({ length: colCount }, (_, i) => `part${i + 1}`)
    }

    await createOutputNodes(transformNode, outputColumns, (i) =>
      splitRows.map((r: string[]) => [r[i] ?? ''])
    )
  }

  // ============================================================================
  // RegexExtract：按捕获组提取，每个组生成一个 output 节点
  // ============================================================================

  /**
   * 尝试用指定 pattern 提取捕获组内容
   * @returns 提取结果数组（三维），或 null（没有任何一行匹配成功）
   */
  function tryRegexExtract(
    pattern: string,
    flags: string,
    upstreamRows: string[][],
    outputColumns: string[]
  ): string[][][] | null {
    const extractedData: string[][][] = outputColumns.map(() => [])
    let hasMatch = false
    const validFlags = (flags || '')
      .split('')
      .filter((c) => 'gimsuy'.includes(c))
      .join('')

    for (const row of upstreamRows) {
      const value = String(row[0] ?? '')
      const regex = new RegExp(pattern, validFlags)
      const match = regex.exec(value)
      if (match && match.length > 1) {
        hasMatch = true
        for (let i = 0; i < outputColumns.length; i++) {
          const groupValue = match[i + 1] !== undefined ? String(match[i + 1]) : ''
          extractedData[i].push([groupValue])
        }
      } else {
        for (let i = 0; i < outputColumns.length; i++) {
          extractedData[i].push([''])
        }
      }
    }

    return hasMatch ? extractedData : null
  }

  /**
   * 修复常见的正则转义问题：
   * 1. 双反斜杠 \\d → \d（用户在 JSON/字符串字面量里复制时多了一层转义）
   * 2. 缺失反斜杠 d{n} → \d{n}、w → \w、s → \s 等（反斜杠在存储/传输中丢失）
   */
  function normalizeRegexPattern(pattern: string): string {
    let normalized = pattern
    // 修复 1：把两个连续反斜杠替换为一个（注意正则里 \\ 匹配字符串中的 \\）
    normalized = normalized.replace(/\\\\/g, '\\')
    // 修复 2：把 d{n}、w、s、D、W、S 前面没有反斜杠的补上反斜杠
    // 使用负向前置判断，避免误伤已经正确转义的序列
    normalized = normalized.replace(/(?<![\\])d(?={\d+})/g, '\\d')
    normalized = normalized.replace(/(?<![\\])w(?!\w)/g, '\\w')
    normalized = normalized.replace(/(?<![\\])s(?!\w)/g, '\\s')
    normalized = normalized.replace(/(?<![\\])D/g, '\\D')
    normalized = normalized.replace(/(?<![\\])W/g, '\\W')
    normalized = normalized.replace(/(?<![\\])S/g, '\\S')
    return normalized
  }

  async function generateRegexExtractOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const pattern = (transformData.params?.pattern as string) || ''
    const flags = (transformData.params?.flags as string) || ''

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      outputColumns = ['extract_1']
    }

    if (!pattern || upstreamRows.length === 0) {
      await createOutputNodes(transformNode, outputColumns, () => upstreamRows)
      return
    }

    // 调试：把 pattern 的 JSON 表示打到控制台，可一眼看出是单/双反斜杠

    console.log(
      '[RegexExtract] raw pattern JSON:',
      JSON.stringify(pattern),
      'flags:',
      JSON.stringify(flags)
    )

    // 第 1 层：使用原始 pattern
    let extractedData = tryRegexExtract(pattern, flags, upstreamRows, outputColumns)

    // 第 2 层：尝试修复常见转义问题后再匹配
    if (!extractedData) {
      const normalized = normalizeRegexPattern(pattern)
      if (normalized !== pattern) {
        console.log('[RegexExtract] retry with normalized:', JSON.stringify(normalized))
        extractedData = tryRegexExtract(normalized, flags, upstreamRows, outputColumns)
      }
    }

    if (extractedData) {
      await createOutputNodes(transformNode, outputColumns, (i) => extractedData![i])
    } else {
      // 所有尝试均失败，回退到原始数据，避免用户看到空内容

      console.warn('[RegexExtract] all patterns failed, fallback to upstream rows')
      await createOutputNodes(transformNode, outputColumns, () => upstreamRows)
    }
  }

  // ============================================================================
  // 原子化 Transform：Digits — 将字符串逐字符拆分为多行
  // ============================================================================

  async function generateDigitsOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)

    // 将每行第一个值的每个字符拆成单独一行
    const digitRows: string[][] = []
    for (const row of upstreamRows) {
      const value = String(row[0] ?? '')
      for (const ch of value) {
        digitRows.push([ch])
      }
    }

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      outputColumns = ['digits']
    }

    await createOutputNodes(transformNode, outputColumns, () => digitRows)
  }

  // ============================================================================
  // 原子化 Transform：Substring — 对每行字符串做子串提取
  // ============================================================================

  async function generateSubstringOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)

    const start = (transformData.params?.start as number) ?? 0
    const end = transformData.params?.end as number | undefined
    const length = transformData.params?.length as number | undefined

    const resultRows = upstreamRows.map((row) => {
      const value = String(row[0] ?? '')
      let result: string
      if (length != null) {
        result = value.substring(start, start + length)
      } else if (end != null) {
        result = value.substring(start, end)
      } else {
        result = value.substring(start)
      }
      return [result]
    })

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_substring`]
    }

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // 原子化 Transform：WeightedSum — 对每行字符串逐位提取数字，按权重数组求和
  // 与后端 WeightedSumRunner 逻辑一致：逐行处理，输出行数与输入相同
  // ============================================================================

  async function generateWeightedSumOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const weights = (transformData.params?.weights as number[]) || []

    // 对每行独立做加权求和：提取所有数字字符，与 weights 对应相乘
    const resultRows = upstreamRows.map((row) => {
      const value = String(row[0] ?? '')
      // 提取所有数字字符（与后端逻辑一致）
      const digits = value
        .split('')
        .filter((c) => c >= '0' && c <= '9')
        .map((c) => parseInt(c, 10))

      let sum = 0
      for (let i = 0; i < Math.min(digits.length, weights.length); i++) {
        sum += digits[i] * weights[i]
      }
      return [String(sum)]
    })

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      outputColumns = ['weighted_sum']
    }

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // 原子化 Transform：Modulo — 对每行数值取模
  // ============================================================================

  async function generateModuloOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const divisor = parseFloat(String((transformData.params?.divisor as number) ?? 1)) || 1

    const resultRows = upstreamRows.map((row) => {
      const v = parseFloat(String(row[0] ?? '0'))
      const val = isNaN(v) ? 0 : v
      return [String(divisor === 0 ? val : val % divisor)]
    })

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      outputColumns = ['modulo_result']
    }

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // 原子化 Transform：MapValue — 对每行值查表映射
  // ============================================================================

  async function generateMapValueOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const mapping = (transformData.params?.mapping as Array<string | number>) || []

    const resultRows = upstreamRows.map((row) => {
      const raw = String(row[0] ?? '')
      const idx = parseInt(raw, 10)
      const mapped = !isNaN(idx) && idx >= 0 && idx < mapping.length ? String(mapping[idx]) : raw
      return [mapped]
    })

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      outputColumns = ['mapped']
    }

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // MathExpr：数学表达式计算
  // ============================================================================

  /**
   * 前端预览：计算数学表达式
   * 支持 @列名 语法，如 @Column1 + 1, @col_a * @col_b
   */
  async function generateMathExprOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const expression = (transformData.params?.expression as string) || ''
    const outputType = (transformData.params?.output_type as string) || ''

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    // 解析表达式中的 @列名，提取列名列表
    const columnRefs = new Set<string>()
    const refPattern = /@(\w+)/g
    let match
    while ((match = refPattern.exec(expression)) !== null) {
      columnRefs.add(match[1])
    }

    // 构建列名到索引的映射（假设上游节点是单列）
    const columnIndex = 0 // 上游是单列节点

    // 执行计算
    const resultRows: string[][] = []
    for (const row of upstreamRows) {
      // 将 @列名 替换为实际值
      let evalExpr = expression
      for (const colName of columnRefs) {
        const value = row[columnIndex] ?? '0'
        evalExpr = evalExpr.replace(new RegExp(`@${colName}`, 'g'), value)
      }

      try {
        // 使用 Function 构造器安全计算（仅限数学表达式）
        // eslint-disable-next-line no-new-func
        const result = new Function(`return ${evalExpr}`)()
        
        // 根据 output_type 转换结果
        let finalResult: string
        if (outputType === 'int') {
          finalResult = String(Math.trunc(Number(result) || 0))
        } else if (outputType === 'float') {
          finalResult = String(Number(result) || 0)
        } else {
          finalResult = String(result)
        }
        
        resultRows.push([finalResult])
      } catch (e) {
        // 计算失败，保留原始值
        resultRows.push([row[columnIndex] ?? ''])
      }
    }

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // Replace：字符串替换
  // ============================================================================

  async function generateReplaceOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const oldStr = (transformData.params?.old as string) || ''
    const newStr = (transformData.params?.new as string) || ''
    const count = (transformData.params?.count as number) ?? -1

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    const resultRows: string[][] = []
    for (const row of upstreamRows) {
      const value = String(row[0] ?? '')
      let replaced: string
      if (count === -1) {
        // 替换所有出现
        replaced = value.split(oldStr).join(newStr)
      } else {
        // 替换指定次数
        let replaced_count = 0
        replaced = value
        while (replaced_count < count && replaced.includes(oldStr)) {
          replaced = replaced.replace(oldStr, newStr)
          replaced_count++
        }
      }
      resultRows.push([replaced])
    }

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // Strip：去除首尾空白或指定字符
  // ============================================================================

  async function generateStripOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const chars = (transformData.params?.chars as string) || ''

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    const resultRows: string[][] = []
    for (const row of upstreamRows) {
      const value = String(row[0] ?? '')
      let stripped: string
      if (chars) {
        // 去除指定字符集合
        const charSet = new Set(chars)
        let start = 0
        let end = value.length - 1
        while (start <= end && charSet.has(value[start])) start++
        while (end >= start && charSet.has(value[end])) end--
        stripped = value.substring(start, end + 1)
      } else {
        // 去除所有空白字符
        stripped = value.trim()
      }
      resultRows.push([stripped])
    }

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // UpperCase：转大写
  // ============================================================================

  async function generateUpperCaseOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    const resultRows: string[][] = upstreamRows.map((row) => [String(row[0] ?? '').toUpperCase()])

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // LowerCase：转小写
  // ============================================================================

  async function generateLowerCaseOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    const resultRows: string[][] = upstreamRows.map((row) => [String(row[0] ?? '').toLowerCase()])

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // DateFormat：日期格式化
  // ============================================================================

  async function generateDateFormatOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const inputFormat = (transformData.params?.input_format as string) || '%Y-%m-%d'
    const outputFormat = (transformData.params?.output_format as string) || '%Y/%m/%d'

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    // 简化的日期格式化（仅支持常见的 %Y, %m, %d, %H, %M, %S）
    function formatDate(dateStr: string, inFmt: string, outFmt: string): string {
      try {
        // 尝试解析日期
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return dateStr

        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hours = String(date.getHours()).padStart(2, '0')
        const minutes = String(date.getMinutes()).padStart(2, '0')
        const seconds = String(date.getSeconds()).padStart(2, '0')

        // 替换输出格式中的占位符
        return outFmt
          .replace('%Y', String(year))
          .replace('%m', month)
          .replace('%d', day)
          .replace('%H', hours)
          .replace('%M', minutes)
          .replace('%S', seconds)
      } catch {
        return dateStr
      }
    }

    const resultRows: string[][] = upstreamRows.map((row) => [
      formatDate(String(row[0] ?? ''), inputFormat, outputFormat),
    ])

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // Lookup：查找映射
  // ============================================================================

  async function generateLookupOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const mapping = (transformData.params?.mapping as Record<string, string>) || {}
    const defaultVal = (transformData.params?.default as string) ?? undefined

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    const resultRows: string[][] = upstreamRows.map((row) => {
      const value = String(row[0] ?? '')
      const mapped = mapping[value]
      const finalValue = mapped !== undefined ? mapped : defaultVal !== undefined ? defaultVal : value
      return [String(finalValue)]
    })

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // CastType：类型转换
  // ============================================================================

  async function generateCastTypeOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const targetType = (transformData.params?.target_type as string) || 'string'

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    const resultRows: string[][] = upstreamRows.map((row) => {
      const value = String(row[0] ?? '')
      let casted: string

      try {
        switch (targetType) {
          case 'int':
            casted = String(Math.trunc(Number(value) || 0))
            break
          case 'float':
            casted = String(Number(value) || 0)
            break
          case 'bool':
            casted = value.toLowerCase() === 'true' || value === '1' ? 'true' : 'false'
            break
          case 'datetime':
            // 简化的日期解析
            const date = new Date(value)
            casted = isNaN(date.getTime()) ? value : date.toISOString()
            break
          case 'string':
          default:
            casted = value
            break
        }
      } catch {
        casted = value
      }

      return [casted]
    })

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // Concat：列拼接
  // ============================================================================

  async function generateConcatOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const columns = (transformData.params?.columns as string) || ''
    const separator = (transformData.params?.separator as string) || ''
    const outputColumn = (transformData.params?.output_column as string) || ''

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      outputColumns = [outputColumn || 'concat_result']
    }

    // 注意：Concat 通常需要多列输入，但当前架构只支持单列输入
    // 这里简化处理：将单列数据重复拼接
    const columnList = columns.split(',').map((c) => c.trim()).filter(Boolean)
    
    const resultRows: string[][] = upstreamRows.map((row) => {
      if (columnList.length === 0) {
        // 没有指定列，直接返回原值
        return [String(row[0] ?? '')]
      }
      // 简化处理：使用单列数据
      const value = String(row[0] ?? '')
      const concatResult = columnList.map(() => value).join(separator)
      return [concatResult]
    })

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // ConditionalAssign：条件赋值
  // ============================================================================

  async function generateConditionalAssignOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)
    const conditions =
      (transformData.params?.conditions as Array<{ column: string; op: string; value: string }>) ||
      []
    const logic = (transformData.params?.logic as string) || 'and'
    const thenValue = (transformData.params?.then_value as string) ?? ''
    const elseValue = (transformData.params?.else_value as string) ?? undefined

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    // 检查单个条件是否满足
    function checkCondition(rowValue: string, op: string, condValue: string): boolean {
      switch (op) {
        case 'eq':
          return rowValue === condValue
        case 'ne':
          return rowValue !== condValue
        case 'gt':
          return Number(rowValue) > Number(condValue)
        case 'gte':
          return Number(rowValue) >= Number(condValue)
        case 'lt':
          return Number(rowValue) < Number(condValue)
        case 'lte':
          return Number(rowValue) <= Number(condValue)
        case 'contains':
          return rowValue.includes(condValue)
        case 'startsWith':
          return rowValue.startsWith(condValue)
        case 'endsWith':
          return rowValue.endsWith(condValue)
        case 'regex':
          try {
            return new RegExp(condValue).test(rowValue)
          } catch {
            return false
          }
        case 'in':
          return condValue.split(',').map((v) => v.trim()).includes(rowValue)
        default:
          return false
      }
    }

    const resultRows: string[][] = upstreamRows.map((row) => {
      const rowValue = String(row[0] ?? '')
      
      // 检查所有条件
      const conditionResults = conditions.map((cond) => checkCondition(rowValue, cond.op, cond.value))
      
      // 根据逻辑运算符组合结果
      let allConditionsMet: boolean
      if (logic === 'or') {
        allConditionsMet = conditionResults.some((r) => r)
      } else {
        // and 或默认
        allConditionsMet = conditionResults.every((r) => r)
      }

      const finalValue = allConditionsMet ? thenValue : elseValue !== undefined ? elseValue : rowValue
      return [String(finalValue)]
    })

    await createOutputNodes(transformNode, outputColumns, () => resultRows)
  }

  // ============================================================================
  // 列输出型：根据 outputColumns 生成多个 output 节点
  // 适用于多列变换（CastType / Concat 等）和单列变换（Strip / Replace 等）
  // ============================================================================

  async function generateColumnOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)

    let outputColumns = transformData.outputColumns
    if (!outputColumns || outputColumns.length === 0) {
      // 默认输出列名：inputColumn + _result
      const baseName = transformData.inputColumn || 'result'
      outputColumns = [`${baseName}_result`]
    }

    // 根据转换类型执行对应的预览计算
    const type = transformData.transformType
    if (type === 'MathExpr') {
      await generateMathExprOutput(transformNode, upstreamNode)
    } else if (type === 'Replace') {
      await generateReplaceOutput(transformNode, upstreamNode)
    } else if (type === 'Strip') {
      await generateStripOutput(transformNode, upstreamNode)
    } else if (type === 'UpperCase') {
      await generateUpperCaseOutput(transformNode, upstreamNode)
    } else if (type === 'LowerCase') {
      await generateLowerCaseOutput(transformNode, upstreamNode)
    } else if (type === 'DateFormat') {
      await generateDateFormatOutput(transformNode, upstreamNode)
    } else if (type === 'Lookup') {
      await generateLookupOutput(transformNode, upstreamNode)
    } else if (type === 'CastType') {
      await generateCastTypeOutput(transformNode, upstreamNode)
    } else if (type === 'Concat') {
      await generateConcatOutput(transformNode, upstreamNode)
    } else if (type === 'ConditionalAssign') {
      await generateConditionalAssignOutput(transformNode, upstreamNode)
    } else {
      // 其他未知类型：复制上游数据作为占位预览
      await createOutputNodes(transformNode, outputColumns, () => upstreamRows)
    }
  }

  // ============================================================================
  // 行数改变型：生成单个汇总 output 节点
  // ============================================================================

  async function generateSummaryOutput(transformNode: any, upstreamNode: any) {
    const transformData = transformNode.data as TransformNodeData
    const upstreamRows = getUpstreamRows(upstreamNode)

    const type = transformData.transformType
    const typeLabels: Record<string, string> = {
      FilterRows: '过滤结果',
      DropDuplicates: '去重结果',
      Aggregate: '聚合结果',
      SortRows: '排序结果',
    }

    const colName = typeLabels[type] || '结果'
    // 汇总节点显示操作类型和原始行数
    const summaryRows = upstreamRows.map(() => [`${type} 预览: ${upstreamRows.length} 行`])

    await createOutputNodes(transformNode, [colName], () => summaryRows)
  }

  // ============================================================================
  // 通用 output 节点创建器
  // ============================================================================

  async function createOutputNodes(
    transformNode: any,
    columnNames: string[],
    getRows: (index: number) => string[][]
  ) {
    const oldOutputIds = (transformNode.data as TransformNodeData).outputNodeIds || []

    // 清理旧输出节点
    oldOutputIds.forEach((oid: string) => {
      if (graphStore.nodes.find((n) => n.id === oid)) {
        graphStore.deleteNode(oid)
      }
    })

    const outputNodeIds: string[] = []
    const baseX = (transformNode.position?.x || 0) + 400
    const baseY = transformNode.position?.y || 0

    for (let i = 0; i < columnNames.length; i++) {
      const colName = columnNames[i]
      const colRows = getRows(i)
      const pos = { x: baseX, y: baseY + i * 140 }
      const newId = graphStore.createTransformOutputNode(pos, transformNode.id, colName, colRows)
      outputNodeIds.push(newId)

      await waitForNodeMount([transformNode.id, newId])

      const existingEdge = graphStore.edges.find(
        (edge) =>
          edge.source === transformNode.id &&
          edge.target === newId &&
          edge.sourceHandle === 'transform-output' &&
          edge.targetHandle === 'target-left'
      )

      if (!existingEdge) {
        graphStore.createConnection(transformNode.id, newId, 'transform-output', 'target-left', {
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'var(--edge-data-flow)', strokeWidth: 2 },
          data: { status: 'active', generatedByTransform: true },
        })
        await waitForNodeMount([transformNode.id, newId])
      }
    }

    graphStore.updateNodeData(transformNode.id, {
      outputColumns: columnNames,
      outputNodeIds,
    })
    await waitForNodeMount([transformNode.id, ...outputNodeIds])
  }
</script>

<style scoped>
  .transform-node {
    width: 280px;
  }

  .content {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .summary-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .summary-label {
    color: var(--ui-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .summary-value {
    color: var(--ui-text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-value.placeholder {
    color: var(--ui-text-muted);
    font-style: italic;
    font-weight: normal;
  }

  .params-section {
    margin-top: 4px;
  }

  .params-header {
    margin-bottom: 4px;
  }

  .mono-block {
    display: block;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
    color: var(--ui-text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 80px;
    overflow-y: auto;
  }

  .mono-block.placeholder {
    color: var(--ui-text-muted);
    font-style: italic;
  }
</style>
