/**
 * @file conflict.ts
 * @description AI 配置生成冲突对比类型
 *
 * 定义 AI 生成配置与现有配置之间的差异对比数据结构。
 * 用于 ConflictResolutionModal 展示新增、修改、删除的项目。
 *
 * 核心类型：
 * - DiffType: 差异类型（added / modified / deleted / unchanged）
 * - PropertyDiff: 单个属性的差异
 * - ConfigItemDiff<T>: 配置项级别的差异（带原始值和生成值）
 * - ConfigComparison: 完整对比结果（schemas / constraints / regex_nodes）
 */

export type DiffType = 'added' | 'modified' | 'deleted' | 'unchanged'

export interface PropertyDiff {
  key: string
  oldValue: unknown
  newValue: unknown
  type: DiffType
}

export interface ConfigItemDiff<T> {
  id: string
  name: string
  type: DiffType
  original?: T
  generated?: T
  changes?: PropertyDiff[]
}

export interface ConfigComparison {
  schemas: ConfigItemDiff<unknown>[]
  constraints: ConfigItemDiff<unknown>[]
  regex_nodes: ConfigItemDiff<unknown>[]
}

export interface ResolutionResult {
  schemas: Record<string, unknown>
  constraints: Record<string, unknown>
  regex_nodes: Record<string, unknown>
}
