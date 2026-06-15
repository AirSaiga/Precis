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
  // 原子化操作（补全：此前会 fallback 显示英文 PascalCase）
  Digits: 'customNodes.transformNode.types.digits',
  WeightedSum: 'customNodes.transformNode.types.weightedSum',
  Modulo: 'customNodes.transformNode.types.modulo',
  MapValue: 'customNodes.transformNode.types.mapValue',
}

/**
 * 获取参数区域的显示文本（节点卡片摘要）。
 *
 * @param t vue-i18n 的翻译函数，由调用方从 useI18n() 传入。
 *   所有文案走 i18n，key 前缀为 inspector.transformNode.paramsDisplay。
 */
export function getParamsDisplay(
  transformType: string,
  params: Record<string, unknown> | undefined,
  t: (key: string, named?: Record<string, unknown>) => string
): string {
  const p = params || {}
  const k = (sub: string) => `inspector.transformNode.paramsDisplay.${sub}`

  switch (transformType) {
    case 'StringSplit': {
      const delimiter = (p.delimiter as string) || ','
      const maxsplit = (p.maxsplit as number) ?? -1
      return t(k('delimiter'), {
        delimiter,
        maxsplit: maxsplit === -1 ? t(k('unlimited')) : maxsplit,
      })
    }
    case 'MathExpr': {
      const expression = (p.expression as string) || ''
      return expression ? t(k('expression'), { expr: expression }) : ''
    }
    case 'RegexExtract': {
      const pattern = (p.pattern as string) || ''
      return pattern ? t(k('pattern'), { pattern }) : ''
    }
    case 'DateFormat': {
      const inputFormat = (p.input_format as string) || '%Y-%m-%d'
      const outputFormat = (p.output_format as string) || '%Y/%m/%d'
      return `${inputFormat} → ${outputFormat}`
    }
    case 'Lookup': {
      const mapping = (p.mapping as Record<string, string>) || {}
      const keys = Object.keys(mapping)
      return keys.length ? t(k('mapping'), { count: keys.length }) : ''
    }
    case 'Strip': {
      const chars = (p.chars as string) || ''
      return chars ? t(k('stripChars'), { chars }) : t(k('stripDefault'))
    }
    case 'UpperCase':
      return t(k('toUpper'))
    case 'LowerCase':
      return t(k('toLower'))
    case 'Replace': {
      const oldStr = (p.old as string) || ''
      const newStr = (p.new as string) || ''
      return oldStr ? t(k('replace'), { old: oldStr, new: newStr }) : ''
    }
    case 'FilterRows': {
      const conds = (p.conditions as Array<{ column: string; op: string; value: string }>) || []
      return conds.length ? t(k('filterCount'), { count: conds.length }) : ''
    }
    case 'FillNA': {
      const strategy = (p.strategy as string) || 'value'
      return t(k(`fillStrategy.${strategy}`))
    }
    case 'DropDuplicates': {
      const keep = String((p.keep as string) ?? 'first')
      return t(k(`keepStrategy.${keep}`))
    }
    case 'CastType': {
      const targetType = (p.target_type as string) || 'string'
      return t(k('castTo'), { type: targetType })
    }
    case 'Concat': {
      const colsRaw = p.columns
      const cols = Array.isArray(colsRaw) ? colsRaw.join(',') : (colsRaw as string) || ''
      const sep = (p.separator as string) || ''
      return cols ? t(k('concat'), { cols }) + (sep ? t(k('concatSep'), { sep }) : '') : ''
    }
    case 'Substring': {
      const start = (p.start as number) ?? 0
      const end = p.end as number | undefined
      const length = p.length as number | undefined
      if (length != null) return t(k('substringFromLength'), { start, length })
      if (end != null) return t(k('substringFromEnd'), { start, end })
      return t(k('substringFrom'), { start })
    }
    case 'Aggregate': {
      const aggs = (p.aggregations as Array<{ column: string; func: string }>) || []
      return aggs.length ? t(k('aggregateCount'), { count: aggs.length }) : ''
    }
    case 'ConditionalAssign': {
      const conds = (p.conditions as Array<{ column: string; op: string; value: string }>) || []
      return conds.length ? t(k('conditionCount'), { count: conds.length }) : ''
    }
    case 'SortRows': {
      const sorts = (p.sort_by as Array<{ column: string; order: string }>) || []
      return sorts.length ? t(k('sortCount'), { count: sorts.length }) : ''
    }
    case 'WeightedSum': {
      const weights = (p.weights as number[]) || []
      return weights.length ? t(k('weightCount'), { count: weights.length }) : ''
    }
    case 'Modulo': {
      const divisor = (p.divisor as number) ?? 1
      return t(k('divisor'), { divisor })
    }
    case 'MapValue': {
      const mapping = (p.mapping as Array<string | number>) || []
      return mapping.length ? t(k('mapping'), { count: mapping.length }) : ''
    }
    default:
      return ''
  }
}
