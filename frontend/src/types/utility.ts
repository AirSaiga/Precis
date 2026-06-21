/**
 * @file utility.ts
 * @description 项目级通用类型工具
 *
 * 用于在 A2 any 清理专项中减少 any 使用，提供语义化的通用类型别名。
 */

/** 可空类型：显式包含 null 与 undefined */
export type Nullable<T> = T | null | undefined

/** 键为 string、值为 unknown 的记录类型；替代 Record<string, any> */
export type AnyRecord = Record<string, unknown>

/** 任意数组；仅在确实需要接受任意元素类型时使用，优先考虑 unknown[] */
export type AnyArray = unknown[]
