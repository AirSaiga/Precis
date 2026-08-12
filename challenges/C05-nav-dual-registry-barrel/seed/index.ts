/**
 * Barrel 入口（C05 精简版）。
 * 通过 side-effect import 触发各模块的自注册，并对外再导出 registry 的查询接口，
 * 让消费方统一从 barrel 取 API（不直接摸 registry 模块）。
 *
 * 当前状态：notNullBuilder 已注册，但 notNullHandler 的 import 被注释掉了，
 * 导致 handlers 注册表里没有 notNull。这是 bug。
 */
import './registry'
import './notNullBuilder'
// import './notNullHandler'   ← 被注释掉了，handler 没注册！

// 对外 API 面（消费方从 barrel 拿查询接口）
export { listBuilders } from './registry'
