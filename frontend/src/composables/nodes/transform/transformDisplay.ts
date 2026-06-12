/**
 * @fileoverview Transform 显示辅助函数
 *
 * 将 TransformNode.vue 中的 typeDisplay 和 paramsDisplay 逻辑
 * 提取为纯函数，方便组件和 Inspector 共用。
 */

/**
 * 获取 TransformType 的显示名称 i18n key
 * 返回的是 i18n key，而非已翻译的文本，以便在 computed 中配合 useI18n 使用。
 */
export const TRANSFORM_TYPE_I18N_KEYS: Record<string, string> = {
  StringSplit: 'customNodes.transformNode.types.stringSplit',
  RegexExtract: 'customNodes.transformNode.types.regexExtract',
  MathExpr: 'customNodes.transformNode.types.mathExpr',
  DateFormat: 'customNodes.transformNode.types.dateFormat',
  Lookup: 'customNodes.transformNode.types.lookup',
  Strip: 'customNodes.transformNode.types.strip',
  UpperCase: 'customNodes.transformNode.types.upperCase',
  LowerCase: 'customNodes.transformNode.types.lowerCase',
  Replace: 'customNodes.transformNode.types.replace',
  FilterRows: 'customNodes.transformNode.types.filterRows',
  FillNA: 'customNodes.transformNode.types.fillNA',
  DropDuplicates: 'customNodes.transformNode.types.dropDuplicates',
  CastType: 'customNodes.transformNode.types.castType',
  Concat: 'customNodes.transformNode.types.concat',
  Substring: 'customNodes.transformNode.types.substring',
  Aggregate: 'customNodes.transformNode.types.aggregate',
  ConditionalAssign: 'customNodes.transformNode.types.conditionalAssign',
  SortRows: 'customNodes.transformNode.types.sortRows',
}

/**
 * 获取参数区域的显示文本
 *
 * 注意：此函数返回硬编码的中文文本，与原组件保持一致。
 * 后续可改为返回 i18n key 对象，由调用方翻译。
 */
export function getParamsDisplay(
  transformType: string,
  params: Record<string, unknown> | undefined
): string {
  const p = params || {}

  switch (transformType) {
    case 'StringSplit': {
      const delimiter = (p.delimiter as string) || ','
      const maxsplit = (p.maxsplit as number) ?? -1
      return `分隔符: "${delimiter}" | 最大分割: ${maxsplit === -1 ? '不限' : maxsplit}`
    }
    case 'MathExpr': {
      const expression = (p.expression as string) || ''
      return expression ? `表达式: ${expression}` : ''
    }
    case 'RegexExtract': {
      const pattern = (p.pattern as string) || ''
      return pattern ? `模式: ${pattern}` : ''
    }
    case 'DateFormat': {
      const inputFormat = (p.input_format as string) || '%Y-%m-%d'
      const outputFormat = (p.output_format as string) || '%Y/%m/%d'
      return `${inputFormat} → ${outputFormat}`
    }
    case 'Lookup': {
      const mapping = (p.mapping as Record<string, string>) || {}
      const keys = Object.keys(mapping)
      return keys.length ? `映射: ${keys.length} 项` : ''
    }
    case 'Strip': {
      const chars = (p.chars as string) || ''
      return chars ? `去除: "${chars}"` : '去除首尾空白'
    }
    case 'UpperCase':
      return '转换为大写'
    case 'LowerCase':
      return '转换为小写'
    case 'Replace': {
      const oldStr = (p.old as string) || ''
      const newStr = (p.new as string) || ''
      return oldStr ? `"${oldStr}" → "${newStr}"` : ''
    }
    case 'FilterRows': {
      const conds = (p.conditions as Array<{ column: string; op: string; value: string }>) || []
      return conds.length ? `${conds.length} 个过滤条件` : ''
    }
    case 'FillNA': {
      const strategy = (p.strategy as string) || 'value'
      const strategyMap: Record<string, string> = {
        value: '指定值',
        ffill: '前向填充',
        bfill: '后向填充',
        mean: '均值',
        median: '中位数',
      }
      return strategyMap[strategy] || strategy
    }
    case 'DropDuplicates': {
      const keep = String((p.keep as string) ?? 'first')
      const keepMap: Record<string, string> = {
        first: '保留第一条',
        last: '保留最后一条',
        false: '全部删除',
      }
      return keepMap[keep] || keep
    }
    case 'CastType': {
      const targetType = (p.target_type as string) || 'string'
      return `转为 ${targetType}`
    }
    case 'Concat': {
      const cols = (p.columns as string) || ''
      const sep = (p.separator as string) || ''
      return cols ? `拼接 ${cols}${sep ? ` (分隔: "${sep}")` : ''}` : ''
    }
    case 'Substring': {
      const start = (p.start as number) ?? 0
      const end = p.end as number | undefined
      const length = p.length as number | undefined
      if (length != null) return `从 ${start} 开始，长度 ${length}`
      if (end != null) return `从 ${start} 到 ${end}`
      return `从 ${start} 开始`
    }
    case 'Aggregate': {
      const aggs = (p.aggregations as Array<{ column: string; func: string }>) || []
      return aggs.length ? `${aggs.length} 项聚合` : ''
    }
    case 'ConditionalAssign': {
      const conds = (p.conditions as Array<{ column: string; op: string; value: string }>) || []
      return conds.length ? `${conds.length} 个条件 → 赋值` : ''
    }
    case 'SortRows': {
      const sorts = (p.sort_by as Array<{ column: string; order: string }>) || []
      return sorts.length ? `${sorts.length} 个排序列` : ''
    }
    case 'WeightedSum': {
      const weights = (p.weights as number[]) || []
      return weights.length ? `${weights.length} 个权重` : ''
    }
    case 'Modulo': {
      const divisor = (p.divisor as number) ?? 1
      return `除数: ${divisor}`
    }
    case 'MapValue': {
      const mapping = (p.mapping as Array<string | number>) || []
      return mapping.length ? `映射: ${mapping.length} 项` : ''
    }
    default:
      return ''
  }
}
