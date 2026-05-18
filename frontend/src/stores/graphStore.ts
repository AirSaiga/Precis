/**
 * @file graphStore.ts
 * @description 图数据状态管理主 Store（God Store）
 *
 * 该 Store 是前端画布系统的核心状态管理中心，负责 orchestrate 数据流图中的
 * 所有节点、边、资产、项目状态和交互状态。
 *
 * 架构设计：
 * - 采用 Pinia Setup Store 模式
 * - 具体实现已拆分至 ./graphStore/setup.ts，通过 setupGraphStore() 注入
 * - 子模块工厂函数（createXxxModule）在 setup 中实例化
 *
 * 输入示例：
 *   const graphStore = useGraphStore()
 *   graphStore.loadProject('/path/to/project.precis.yaml')
 *
 * 输出示例：
 *   graphStore.nodes.value  // CustomNode[] — 当前画布所有节点
 *   graphStore.saveState.value // 'saved' | 'unsaved' | 'error'
 */

import { defineStore } from 'pinia'
import { setupGraphStore } from './graphStore/setup'

export const useGraphStore = defineStore('graph', () => setupGraphStore())
