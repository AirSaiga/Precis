/**
 * E2E 测试全局配置
 *
 * 集中管理后端和前端 URL，避免每个 spec 文件重复定义。
 */

export const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:18000'
export const FRONTEND_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'
export const API_PREFIX = '/api/latest'
