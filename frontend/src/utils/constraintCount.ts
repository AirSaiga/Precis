/**
 * @file constraintCount.ts
 * @description 约束数量统计工具函数
 *
 * 背景：
 * - 系统中有两种约束存储方式：独立约束文件（.constraint.yaml）和内嵌约束（Schema 文件中的 constraints 数组）
 * - 本文件提供统一的约束数量计算逻辑，确保不同位置显示的约束数量保持一致
 */
import type { TableSchemaFileV2 } from '@/types/projectV2'

/**
 * 约束统计结果
 */
export interface ConstraintStats {
  /** 独立约束文件数量 */
  standalone: number
  /** 内嵌约束数量 */
  inline: number
  /** 总约束数量 */
  total: number
}

/**
 * 计算约束数量统计
 *
 * 本函数同时统计独立约束文件和内嵌约束的数量，用于在项目信息、AI生成预览等位置
 * 显示一致的约束数量统计信息
 *
 * @param schemas - Schema 对象字典，键为 schema ID，值为 TableSchemaFileV2
 * @param constraints - 独立约束对象字典（可选）
 * @returns ConstraintStats 包含 standalone、inline、total 三个数量
 *
 * 计算逻辑：
 * 1. standalone: 直接返回 constraints 字典的键数量（即独立约束文件数量）
 * 2. inline: 遍历所有 schema，统计每个 schema.constraints 数组的长度
 * 3. total: standalone + inline
 *
 * 使用场景：
 * - AIConfigGenerateModal 生成预览统计
 * - ProjectRootNode 项目统计显示
 * - ProjectInfoPanel 项目信息面板
 */
export function calculateConstraintStats(
  schemas: Record<string, TableSchemaFileV2> | undefined,
  constraints: Record<string, unknown> | undefined
): ConstraintStats {
  const standalone = constraints ? Object.keys(constraints).length : 0

  let inline = 0
  if (schemas) {
    for (const schema of Object.values(schemas)) {
      if (schema.constraints && Array.isArray(schema.constraints)) {
        inline += schema.constraints.length
      }
    }
  }

  return {
    standalone,
    inline,
    total: standalone + inline,
  }
}

/**
 * 从 manifest 和 schemas 数据计算约束统计
 *
 * 这是一个便捷函数，适用于已知 manifest 和 schemas 的场景
 *
 * @param manifest - 项目的 manifest 对象，需包含 constraints 数组
 * @param schemas - Schema 对象字典
 * @returns ConstraintStats
 */
export function calculateConstraintStatsFromManifest(
  manifest: { constraints?: { id: string }[] },
  schemas: Record<string, TableSchemaFileV2>
): ConstraintStats {
  const standalone = manifest.constraints?.length ?? 0
  let inline = 0

  for (const schema of Object.values(schemas)) {
    if (schema.constraints && Array.isArray(schema.constraints)) {
      inline += schema.constraints.length
    }
  }

  return {
    standalone,
    inline,
    total: standalone + inline,
  }
}
