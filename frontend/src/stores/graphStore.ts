/**
 * @file graphStore.ts
 * @description 图数据状态管理主 Store（God Store）
 *
 * 该 Store 是前端画布系统的核心状态管理中心，负责 orchestrate 数据流图中的
 * 所有节点、边、资产、项目状态和交互状态。
 *
 * 架构设计：
 * - 采用 Pinia Setup Store 模式
 * - 具体实现已拆分至 ./graphStore/setup/ 目录，入口为 setupGraphStore()（见 setup/assembly.ts）
 * - 子模块工厂函数（createXxxModule）在 setup 中实例化
 *
 * 输入示例：
 *   const graphStore = useGraphStore()
 *   graphStore.loadProjectFromV2()
 *
 * 输出示例：
 *   graphStore.nodes  // CustomNode[] — 当前画布所有节点
 *   graphStore.saveState() // 保存当前画布快照到撤销栈（见 modules/history.ts）
 */

import { defineStore } from 'pinia'
import { setupGraphStore } from './graphStore/setup'

export const useGraphStore = defineStore('graph', () => setupGraphStore())
