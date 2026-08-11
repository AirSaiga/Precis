/**
 * 校验处理器注册表（C10 精简版）。
 * 每种约束注册一个 handler，按 kind 索引。
 */
interface ValidationContext { table: string; column: string; value: unknown }
interface ValidationResult { passed: boolean; message?: string }
interface ConstraintHandler {
  kind: string
  validate: (ctx: ValidationContext) => ValidationResult | Promise<ValidationResult>
}
const handlers = new Map<string, ConstraintHandler>()

export function register(handler: ConstraintHandler): void {
  handlers.set(handler.kind, handler)
}

export function getHandler(kind: string): ConstraintHandler | undefined {
  return handlers.get(kind)
}

// notNull 的 handler 注册
register({
  kind: 'notNull',
  validate: (ctx) => {
    if (ctx.value === null || ctx.value === undefined) {
      return { passed: false, message: `${ctx.column} 不能为空` }
    }
    return { passed: true }
  },
})
