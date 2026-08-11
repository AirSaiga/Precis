import { register } from './registry'

// 模块级别自注册：被 index.ts 的 side-effect import 触发
register({
  kind: 'notNull',
  validate: (ctx) => ({ passed: ctx.value !== null && ctx.value !== undefined }),
})
