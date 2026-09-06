/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
    // 将搜索词统一转为小写并去除首尾空白，实现不区分大小写的匹配
    const query = searchQuery.value.toLowerCase().trim()
    // 搜索词为空时直接返回原列表，避免不必要的遍历
    if (!query) return source
    // 按资源名称包含搜索词进行过滤
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
