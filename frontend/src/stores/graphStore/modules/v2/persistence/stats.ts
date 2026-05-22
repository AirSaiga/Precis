/**
 * @file stats.ts
 * @description V2 项目统计信息模块
 *
 * 负责从后端加载项目配置并计算统计指标（schema 数量、constraint 数量、
 * regex 数量等），用于项目信息面板和根节点徽章展示。
 *
 * 功能概述：
 * - createV2StatsOps: 工厂函数，创建统计操作器
 * - loadProjectStats: 加载项目配置并计算统计指标
 * - 统计指标包括：schemaCount、constraintCount（独立+内嵌）、regexCount
 *
 * 架构设计：
 * - 作为 graphStore 子模块，通过工厂函数实例化
 * - 接收 projectConfigStats / projectConfigStatsLoaded 等状态引用
 * - 通过 getV2FullConfig 从后端获取完整配置
 * - 使用 calculateConstraintStatsFromManifest 计算约束统计
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import { getV2FullConfig } from '@/api/projectV2Api'
import { calculateConstraintStatsFromManifest } from '@/utils/constraintCount'

export function createV2StatsOps(params: {
  projectConfigStats: Ref<{
    schemaCount: number
    constraintCount: number
    constraintStandaloneCount: number
    constraintInlineCount: number
    regexCount: number
    transformCount: number
    templateCount: number
  }>
  projectConfigStatsLoaded: Ref<boolean>
  projectConfigStatsConfigPath: Ref<string>
  normalizeConfigDir: (inputPath: string) => string
  getEffectiveProjectConfigPath: () => string | undefined
}) {
  const {
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    normalizeConfigDir,
    getEffectiveProjectConfigPath,
  } = params

  async function refreshProjectConfigStats(configPath?: string): Promise<boolean> {
    const effective = normalizeConfigDir(configPath || getEffectiveProjectConfigPath() || '')
    if (!effective) return false

    if (
      projectConfigStatsLoaded.value &&
      normalizeConfigDir(projectConfigStatsConfigPath.value) === effective
    ) {
      return true
    }

    try {
      const config = await getV2FullConfig(effective)

      const totalSchemas = config.manifest.schemas.length
      const constraintStats = calculateConstraintStatsFromManifest(config.manifest, config.schemas)
      const totalRegex = config.manifest.regex_nodes?.length || 0
      const totalTransforms = config.manifest.transforms?.length || 0
      const totalTemplates = config.manifest.templates?.length || 0

      projectConfigStats.value = {
        schemaCount: totalSchemas,
        constraintCount: constraintStats.total,
        constraintStandaloneCount: constraintStats.standalone,
        constraintInlineCount: constraintStats.inline,
        regexCount: totalRegex,
        transformCount: totalTransforms,
        templateCount: totalTemplates,
      }
      projectConfigStatsLoaded.value = true
      projectConfigStatsConfigPath.value = effective
      return true
    } catch (error) {
      logger.warn('[refreshProjectConfigStats] Failed to load stats:', error)
      projectConfigStatsLoaded.value = false
      projectConfigStatsConfigPath.value = effective
      return false
    }
  }

  return { refreshProjectConfigStats }
}
