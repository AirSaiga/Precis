/**
 * 双注册表（C05 精简版）。
 * Precis 的约束系统有两个并行的自注册注册表：
 *   - builders：构建节点数据
 *   - handlers：执行校验
 * 两者都通过 barrel（index.ts）的 side-effect import 触发自注册。
 */
type BuildFn = (input: { table?: string; column?: string }) => Record<string, unknown>
interface ValidationHandler {
  kind: string
  validate: (ctx: { value: unknown }) => { passed: boolean }
}

const builders = new Map<string, BuildFn>()
const handlers = new Map<string, ValidationHandler>()

export function registerBuilder(kind: string, fn: BuildFn): void {
  builders.set(kind, fn)
}

export function register(handler: ValidationHandler): void {
  handlers.set(handler.kind, handler)
}

// 查询：返回已注册的 kind 列表
export function listBuilders(): string[] {
  return Array.from(builders.keys()).sort()
}
export function listHandlers(): string[] {
  return Array.from(handlers.keys()).sort()
}
