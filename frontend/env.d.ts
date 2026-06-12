/// <reference types="vite/client" />
// env.d.ts

// 处理 Vue 文件
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// 处理图片
declare module '*.png' {
  const value: string
  export default value
}

// 处理 CSS/SCSS (如果是 CSS Modules)
declare module '*.module.css' {
  const classes: { [key: string]: string }
  export default classes
}
