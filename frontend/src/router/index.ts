/**
 * @file index.ts
 * @description Vue Router 配置
 *
 * 定义应用路由表。
 * 当前应用为单页面模式，由 App.vue 直接渲染，不依赖 router-view。
 */

import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [],
})

export default router
