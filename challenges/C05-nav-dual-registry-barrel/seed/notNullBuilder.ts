import { registerBuilder } from './registry'

// 模块级别自注册：被 index.ts 的 side-effect import 触发
registerBuilder('notNull', (input) => ({
  table: input.table ?? '',
  column: input.column ?? '',
}))
