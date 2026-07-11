/**
 * @file regex.ts
 * @description 正则节点类型判断工具
 */

const REGEX_NODE_TYPE_VALUES = ['regex', 'regexExtract'] as const

export type RegexNodeType = (typeof REGEX_NODE_TYPE_VALUES)[number]

export const REGEX_NODE_TYPES = Object.freeze(new Set(REGEX_NODE_TYPE_VALUES))

export function isRegexNodeType(type: string | undefined): type is RegexNodeType {
  return !!type && REGEX_NODE_TYPES.has(type as RegexNodeType)
}
