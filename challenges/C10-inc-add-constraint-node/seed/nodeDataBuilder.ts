/**
 * 节点数据构建器注册表（C10 精简版）。
 * 每种约束注册一个 builder 函数，按 kind 索引。
 */
type BuildResult = Record<string, unknown>
interface BuildInput { kind: string; column?: string; table?: string }
const builders = new Map<string, (input: BuildInput) => BuildResult>()

export function registerBuilder(kind: string, fn: (input: BuildInput) => BuildResult): void {
  builders.set(kind, fn)
}

export function buildNodeData(kind: string, input: BuildInput): BuildResult | null {
  const fn = builders.get(kind)
  return fn ? fn(input) : null
}

// notNull 的 builder 注册
registerBuilder('notNull', (input) => ({ table: input.table ?? '', column: input.column ?? '' }))
