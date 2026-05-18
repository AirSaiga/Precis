/**
 * 节点布局整理器 - 模块入口
 *
 * 功能：
 * 1. 提供节点自动整理收纳功能
 * 2. 统一使用以Schema为核心的布局策略
 * 3. 支持平滑动画过渡
 * 4. 可手动触发或自动监听触发
 *
 * 使用方式：
 * import { useNodeOrganizer } from '@/features/node-layout-organizer';
 * const { quickOrganize, organizeWithStrategy } = useNodeOrganizer();
 */

// 类型导出
export * from './types'

// 常量导出
export * from './constants'

// 核心类导出
export { LayoutCalculator } from './core/layoutCalculator'
export { PositionOptimizer } from './core/positionOptimizer'

// 策略导出
export { SchemaCentricStrategy } from './strategies/schemaCentricStrategy'

// 动画导出
export {
  animateNodeToPosition,
  animateAllNodes,
  easeInOutCubic,
} from './animations/animateToPosition'

// Vue 组合式函数导出
export { useNodeOrganizer } from './composables/useNodeOrganizer'
export { useAutoOrganize } from './composables/useAutoOrganize'

// 工具函数导出
export { NodeClassifier } from './utils/nodeClassifier'
export { BoundsCalculator } from './utils/boundsCalculator'
