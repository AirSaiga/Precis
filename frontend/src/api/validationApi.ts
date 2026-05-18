/**
 * @file validationApi.ts
 * @description 数据校验 API 服务模块 - 统一导出入口
 *
 * 本模块已拆分为子模块：
 * - ./validation/core.ts: 共享类型定义和常量
 * - ./validation/basic.ts: 基础校验函数（非空、范围、唯一性）
 * - ./validation/advanced.ts: 高级校验函数（允许值、条件、外键、脚本、字符集）
 */

export * from './validation/core'
export * from './validation/basic'
export * from './validation/advanced'
