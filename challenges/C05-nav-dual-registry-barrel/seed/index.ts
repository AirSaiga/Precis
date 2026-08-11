/**
 * Barrel 入口（C05 精简版）。
 * 通过 side-effect import 触发各模块的自注册。
 *
 * 当前状态：notNullBuilder 已注册，但 notNullHandler 的 import 被注释掉了，
 * 导致 handlers 注册表里没有 notNull。这是 bug。
 */
import './registry'
import './notNullBuilder'
// import './notNullHandler'   ← 被注释掉了，handler 没注册！
