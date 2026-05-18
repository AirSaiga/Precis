/**
 * @file resourceSearchStore.ts
 * @description 资源搜索状态管理
 *
 * Store 职责：
 * - 管理资源树搜索关键词
 * - 提供基于关键词的过滤资源列表
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ResourceItem } from '@/types/resource'

export const useResourceSearchStore = defineStore('resourceSearch', () => {
  /** 搜索关键词 */
  const searchQuery = ref('')

  /**
   * 根据搜索词过滤资源列表
   *
   * 匹配规则：不区分大小写，按资源名称包含关键词进行过滤。
   *
   * @param source - 原始资源列表
   * @returns 过滤后的资源列表；搜索词为空时返回原列表
   */
  function filterResources(source: ResourceItem[]): ResourceItem[] {
    const query = searchQuery.value.toLowerCase().trim()
    if (!query) return source
    return source.filter((r) => r.name.toLowerCase().includes(query))
  }

  /**
   * 设置搜索关键词
   *
   * @param query - 用户输入的搜索字符串
   */
  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  /**
   * 清空搜索关键词
   *
   * 将搜索词重置为空字符串，恢复显示全部资源。
   */
  function clearSearch(): void {
    searchQuery.value = ''
  }

  return {
    searchQuery,
    filterResources,
    setSearchQuery,
    clearSearch,
  }
})
