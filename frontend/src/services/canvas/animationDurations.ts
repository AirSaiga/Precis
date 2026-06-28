/**
 * @file animationDurations.ts
 * @description 画布动画时长 JS 常量
 *
 * 这些值与设计令牌（tokens/primitive.css 的 --dur-*）保持同源。
 * JS 侧（setTimeout 清理动画 class）需要数值毫秒，而 CSS 用令牌字符串，
 * 故在此以常量形式镜像关键时长，并在两者间加注释指明对应关系。
 *
 * 修改此处时务必同步更新 primitive.css 对应的 --dur-* 令牌，反之亦然。
 */

/** 节点入场动画时长（对应 CSS --dur-enter） */
export const NODE_ENTER_DURATION_MS = 300

/** 边绘制渐入动画时长（对应 CSS --dur-edge-draw） */
export const EDGE_DRAW_DURATION_MS = 200

/** fitView 过渡时长（对应 CSS --dur-fitview） */
export const FITVIEW_DURATION_MS = 400

/** 节点入场动画标记 class */
export const NODE_ENTERING_CLASS = 'node-entering'

/** 边绘制动画标记 class */
export const EDGE_DRAWING_CLASS = 'edge-drawing'
