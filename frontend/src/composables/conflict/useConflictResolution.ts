/**
 * @file useConflictResolution.ts
 * @description 冲突解决状态管理与确认逻辑组合式函数
 *
 * 功能概述:
 * - 管理每个冲突项的整体解决策略（original / generated / mixed）
 * - 支持逐行（keyPath 级别）的细粒度解决策略
 * - 提供批量操作策略（安全默认、全部保留、全部使用 AI、仅使用新增）
 * - 构建最终配置对象并触发 confirm 事件
 *
 * 架构设计:
 * - resolutions: 记录每个冲突项的全局策略
 * - partialResolutions: 记录 mixed 模式下逐行的选择
 * - confirm 中的 process 函数负责合并 original 与 generated 配置
 * - 提供路径级别的 get/set/remove 工具函数用于对象合并
 *
 * 输入示例:
 *   const { setResolution, applyBatch, confirm, generatedCount } = useConflictResolution(
 *     comparison, generatedManifest, originalManifest, matchesFilter, emitConfirm
 *   )
 *
 * 输出示例:
 *   confirm() -> 构建 FullConfigV2Request 并调用 onConfirm 回调
 */

import { ref, computed } from 'vue'
import type { ConfigComparison, ConfigItemDiff } from '@/api/types/conflict'
import type { FullConfigV2Request, ProjectManifestV2 } from '@/types/projectV2'

export type BatchMode = 'safeDefault' | 'keepAll' | 'useAll' | 'useAddedOnly'

/**
 * 根据点分路径从对象中获取值
 *
 * 支持嵌套对象和数组索引路径，如 'schemas.0.name'。
 * 路径中任一环节为 null/undefined 时提前返回 undefined。
 *
 * @param obj - 目标对象
 * @param path - 点分路径字符串
 * @returns 路径对应的值，未找到时返回 undefined
 */
export const getValueByPath = (obj: any, path: string) => {
  if (!obj) return undefined
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }
  return current
}

/**
 * 根据点分路径向对象设置值
 *
 * 自动创建路径中缺失的中间对象或数组（根据下一级键名是否为纯数字判断）。
 * 用于 mixed 模式下将 generated 的值合并到 original 配置中。
 *
 * @param obj - 目标对象
 * @param path - 点分路径字符串
 * @param value - 要设置的值
 */
export const setValueByPath = (obj: any, path: string, value: any) => {
  if (!obj) return
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || current[part] === null) {
      const nextPart = parts[i + 1]
      current[part] = /^\d+$/.test(nextPart) ? [] : {}
    }
    current = current[part]
  }
  current[parts[parts.length - 1]] = value
}

/**
 * 根据点分路径从对象中删除值
 *
 * 如果目标为数组，使用 splice 删除；否则使用 delete 操作符。
 * 路径中任一环节缺失时静默返回，不抛出异常。
 *
 * @param obj - 目标对象
 * @param path - 点分路径字符串
 */
export const removeValueByPath = (obj: any, path: string) => {
  if (!obj) return
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || current[part] === null) return
    current = current[part]
  }
  const lastKey = parts[parts.length - 1]
  if (Array.isArray(current)) {
    current.splice(Number(lastKey), 1)
  } else {
    delete current[lastKey]
  }
}

export function useConflictResolution(
  comparison: ConfigComparison,
  generatedManifest: ProjectManifestV2,
  originalManifest: ProjectManifestV2,
  matchesFilter: (item: ConfigItemDiff<unknown>) => boolean,
  onConfirm: (payload: FullConfigV2Request) => void
) {
  const resolutions = ref<Record<string, 'original' | 'generated' | 'mixed'>>({})
  const partialResolutions = ref<Record<string, Record<string, 'original' | 'generated'>>>({})

  const setResolution = (id: string, res: 'original' | 'generated' | 'mixed') => {
    resolutions.value[id] = res
    if (res !== 'mixed') {
      if (partialResolutions.value[id]) {
        delete partialResolutions.value[id]
      }
    }
  }

  const setLineResolution = (id: string, keyPath: string, target: 'original' | 'generated') => {
    if (!partialResolutions.value[id]) {
      partialResolutions.value[id] = {}
    }
    partialResolutions.value[id][keyPath] = target
    resolutions.value[id] = 'mixed'
  }

  const isLineSelected = (
    id: string,
    keyPath: string | undefined,
    side: 'original' | 'generated'
  ) => {
    if (!keyPath) return false

    const mainRes = resolutions.value[id]

    if (mainRes !== 'mixed') {
      return mainRes === side
    }

    const lineRes = partialResolutions.value[id]?.[keyPath]

    if (lineRes) {
      return lineRes === side
    }

    return side === 'original'
  }

  const generatedCount = computed(() => {
    let count = 0
    Object.values(resolutions.value).forEach((v) => {
      if (v === 'generated') count++
      else if (v === 'mixed') count += 0.5
    })
    return count
  })

  const originalCount = computed(() => {
    let count = 0
    Object.values(resolutions.value).forEach((v) => {
      if (v === 'original') count++
      else if (v === 'mixed') count += 0.5
    })
    return count
  })

  const applyBatch = (mode: BatchMode) => {
    const next: Record<string, 'original' | 'generated' | 'mixed'> = { ...resolutions.value }
    const all = [...comparison.schemas, ...comparison.constraints, ...comparison.regex_nodes]

    for (const item of all) {
      if (!matchesFilter(item)) continue

      if (partialResolutions.value[item.id]) {
        delete partialResolutions.value[item.id]
      }

      if (mode === 'keepAll') {
        next[item.id] = 'original'
        continue
      }
      if (mode === 'useAll') {
        next[item.id] = 'generated'
        continue
      }
      if (mode === 'useAddedOnly') {
        if (item.type === 'added') next[item.id] = 'generated'
        else next[item.id] = 'original'
        continue
      }
      // safeDefault
      if (item.type === 'added') next[item.id] = 'generated'
      else if (item.type === 'modified') next[item.id] = 'generated'
      else next[item.id] = 'original'
    }

    resolutions.value = next
  }

  const initResolutions = () => {
    const newResolutions: Record<string, 'original' | 'generated'> = {}

    const initList = (list: ConfigItemDiff<unknown>[]) => {
      for (const item of list) {
        if (item.type === 'added') newResolutions[item.id] = 'generated'
        else if (item.type === 'modified') newResolutions[item.id] = 'generated'
        else newResolutions[item.id] = 'original'
      }
    }

    initList(comparison.schemas)
    initList(comparison.constraints)
    initList(comparison.regex_nodes)

    resolutions.value = newResolutions
    partialResolutions.value = {}
  }

  const confirm = () => {
    const finalConfig: FullConfigV2Request = {
      manifest: JSON.parse(JSON.stringify(generatedManifest)),
      schemas: {},
      constraints: {},
      regex_nodes: {},
      transforms: {},
    }

    finalConfig.manifest.schemas = finalConfig.manifest.schemas || []
    finalConfig.manifest.constraints = finalConfig.manifest.constraints || []
    finalConfig.manifest.regex_nodes = finalConfig.manifest.regex_nodes || []

    const process = <T>(
      list: ConfigItemDiff<T>[],
      targetDict: Record<string, T>,
      manifestList: { id: string; path: string }[],
      originalManifestList: { id: string; path: string }[],
      generatedManifestList: { id: string; path: string }[]
    ) => {
      const safeOriginalList = originalManifestList || []
      const getGeneratedRef = (id: string) => generatedManifestList.find((x: any) => x.id === id)

      for (const item of list) {
        const choice =
          resolutions.value[item.id] ||
          (item.type === 'added' || item.type === 'modified' ? 'generated' : 'original')

        if (choice === 'generated') {
          if (item.generated) {
            targetDict[item.id] = item.generated
            if (manifestList.findIndex((x) => x.id === item.id) === -1) {
              const originalRef = safeOriginalList.find((x) => x.id === item.id)
              if (originalRef) {
                manifestList.push(originalRef)
              } else {
                const generatedRef = getGeneratedRef(item.id)
                if (generatedRef) manifestList.push(generatedRef)
              }
            }
          } else {
            const idx = manifestList.findIndex((x) => x.id === item.id)
            if (idx !== -1) manifestList.splice(idx, 1)
          }
        } else {
          if (item.original) {
            if (choice === 'mixed') {
              const base = JSON.parse(JSON.stringify(item.original || {}))
              const gen = item.generated || {}
              const overrides = partialResolutions.value[item.id] || {}

              Object.entries(overrides).forEach(([path, source]) => {
                if (source === 'generated') {
                  const val = getValueByPath(gen, path)
                  if (val === undefined) {
                    removeValueByPath(base, path)
                  } else {
                    setValueByPath(base, path, val)
                  }
                }
              })

              targetDict[item.id] = base

              const originalEntry = originalManifestList.find((x) => x.id === item.id)
              const existingIdx = manifestList.findIndex((x) => x.id === item.id)

              if (originalEntry) {
                if (existingIdx !== -1) manifestList[existingIdx] = originalEntry
                else manifestList.push(originalEntry)
              }
            } else {
              targetDict[item.id] = item.original
              const originalEntry = originalManifestList.find((x) => x.id === item.id)
              const existingIdx = manifestList.findIndex((x) => x.id === item.id)

              if (originalEntry) {
                if (existingIdx !== -1) manifestList[existingIdx] = originalEntry
                else manifestList.push(originalEntry)
              }
            }
          } else {
            const idx = manifestList.findIndex((x) => x.id === item.id)
            if (idx !== -1) manifestList.splice(idx, 1)
          }
        }
      }
    }

    process(
      comparison.schemas as ConfigItemDiff<FullConfigV2Request['schemas'][string]>[],
      finalConfig.schemas,
      finalConfig.manifest.schemas,
      originalManifest.schemas,
      (generatedManifest.schemas || []).filter(Boolean)
    )

    process(
      comparison.constraints as ConfigItemDiff<FullConfigV2Request['constraints'][string]>[],
      finalConfig.constraints,
      finalConfig.manifest.constraints,
      originalManifest.constraints,
      (generatedManifest.constraints || []).filter(Boolean)
    )

    process(
      comparison.regex_nodes as ConfigItemDiff<FullConfigV2Request['regex_nodes'][string]>[],
      finalConfig.regex_nodes,
      finalConfig.manifest.regex_nodes,
      originalManifest.regex_nodes,
      (generatedManifest.regex_nodes || []).filter(Boolean)
    )

    onConfirm(finalConfig)
  }

  return {
    resolutions,
    partialResolutions,
    setResolution,
    setLineResolution,
    isLineSelected,
    generatedCount,
    originalCount,
    applyBatch,
    initResolutions,
    confirm,
  }
}
