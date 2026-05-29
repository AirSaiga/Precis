/**
 * 节点布局整理器 - 模块入口
 *
 * 功能：
 * 1. 提供节点自动整理收纳功能
 * 2. 以 Schema 为核心的布局策略
 * 3. 支持平滑动画过渡
 * 4. 可手动触发或自动监听触发
 *
 * 使用方式：
 * import { useNodeOrganizer } from '@/features/node-layout-organizer';
 * const { quickOrganize } = useNodeOrganizer();
 */

// 类型导出
export * from './types'

// 常量导出
export * from './constants'

// Vue 组合式函数导出
export { useNodeOrganizer } from './composables/useNodeOrganizer'
export { useAutoOrganize } from './composables/useAutoOrganize'
