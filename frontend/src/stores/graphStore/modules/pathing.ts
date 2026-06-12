/**
 * @file pathing.ts
 * @description 项目路径处理模块 - 管理配置路径的标准化和解析
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. normalizeConfigDir: 标准化配置目录路径
 * 2. isCrossPlatformInvalidPath: 检测跨平台无效路径
 * 3. resolveProjectRelativePath: 解析项目相对路径为绝对路径
 * 4. getEffectiveProjectConfigPath: 获取有效的项目配置路径
 *
 * ====================================================================
 * normalizeConfigDir
 * ====================================================================
 * - 移除路径末尾的斜杠/反斜杠
 * - 如果路径指向文件（.csv/.xlsx/.yaml），自动提取目录部分
 * - 用于确保路径格式一致性
 *
 * ====================================================================
 * isCrossPlatformInvalidPath
 * ====================================================================
 * 跨平台路径检测逻辑：
 * - Windows 路径不应以 '/' 开头
 * - Unix 路径不应以 'C:/' 这样的盘符开头
 * - 用于防止路径格式错误
 *
 * ====================================================================
 * resolveProjectRelativePath
 * ====================================================================
 * - 将相对路径转换为基于 configDir 的绝对路径
 * - 自动适配操作系统（处理 '/' 和 '\' 的差异）
 * - 如果路径已是绝对路径，直接返回
 *
 * ====================================================================
 * getEffectiveProjectConfigPath（核心方法）
 * ====================================================================
 * 优先级顺序：
 * 1. projectStore.currentPaths.configPath（最高优先级）
 * 2. 当前 projectPath.value
 * 3. 从 Schema 节点推断路径（schemaData.localPath/sourceFilePath/filePath）
 *
 * 第三优先级会同时更新：
 * - projectPath.value
 * - projectStore.setProjectPaths（持久化到 localStorage）
 *
 * ====================================================================
 * 项目路径推断逻辑
 * ====================================================================
 * 当无法从 store 获取路径时：
 * - 查找画布中的第一个 Schema 节点
 * - 从节点数据中提取文件路径
 * - 标准化后作为项目配置路径
 *
 * ====================================================================
 * 平台检测
 * ====================================================================
 * - 使用 platformDetector 判断当前操作系统
 * - 用于路径分隔符的选择和跨平台路径检测
 *
 * ====================================================================
 * 依赖说明
 * ====================================================================
 * - 依赖 projectStore 获取持久化的项目路径
 * - 依赖 nodes 获取 Schema 节点推断路径
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - getEffectiveProjectConfigPath 可能更新 projectPath.value
 * - getEffectiveProjectConfigPath 可能调用 projectStore.setProjectPaths
 *
 * @module graphStore/modules
 */

import type { Ref } from 'vue'
import type { CustomNode, SchemaNodeData } from '@/types/graph'
import type { ProjectStoreLike } from '@/types/storeInterfaces'
import { platformDetector } from '@/features/keyboard/platform'
import { isAbsolutePath, normalizeConfigDir } from '@/core/utils/pathNormalization'

export function createPathingModule(params: {
  nodes: Ref<CustomNode[]>
  projectStore: ProjectStoreLike
}) {
  const { nodes, projectStore } = params

  function isCrossPlatformInvalidPath(inputPath: string): boolean {
    const p = (inputPath || '').trim()
    if (!p) return false
    const isWindows = platformDetector.isWindows()
    if (isWindows && p.startsWith('/')) return true
    if (!isWindows && /^[a-zA-Z]:[\\/]/.test(p)) return true
    return false
  }

  function resolveProjectRelativePath(
    configDir: string | undefined,
    relPath: string | undefined
  ): string | undefined {
    const base = (configDir || '').trim()
    const rel = (relPath || '').trim()
    if (!base || !rel) return undefined
    if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) return rel

    const sep = platformDetector.isWindows() ? '\\' : '/'
    const normalizedRel = sep === '\\' ? rel.replace(/\//g, '\\') : rel.replace(/\\/g, '/')
    // 去除开头的 ./ 或 .\ 前缀，防止拼接后路径包含 . 导致匹配失败
    const cleanRel = normalizedRel.replace(/^[.\\/]+/, '').replace(/^[\\/]+/, '')
    return `${base.replace(/[\\/]+$/, '')}${sep}${cleanRel}`
  }

  function getEffectiveProjectConfigPath(): string | undefined {
    const storePath = projectStore.currentPaths?.configPath
    if (storePath && isAbsolutePath(storePath)) {
      return normalizeConfigDir(storePath)
    }

    // 第二优先级：从 schema 节点推断（仅用于恢复场景，不写入 projectStore）
    const schemaNode = nodes.value.find((n) => n.type === 'schema')
    const schemaData = schemaNode?.data as SchemaNodeData | undefined
    const hinted = normalizeConfigDir(schemaData?.localPath || schemaData?.sourceFilePath || '')

    if (hinted && isAbsolutePath(hinted) && !isCrossPlatformInvalidPath(hinted)) {
      return hinted
    }

    return undefined
  }

  return {
    normalizeConfigDir,
    isCrossPlatformInvalidPath,
    resolveProjectRelativePath,
    getEffectiveProjectConfigPath,
  }
}
