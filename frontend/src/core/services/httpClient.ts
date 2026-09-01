/**
 * @fileoverview API 客户端配置模块
 *
 * 功能概述:
 * - 创建和配置 Axios HTTP 客户端实例
 * - 动态确定后端 API 地址（支持开发/生产/桌面环境）
 * - 支持 Electron 环境下的动态端口获取
 * - 自动注入项目相关的请求头信息
 *
 * 架构设计:
 * - 单例模式: 导出一个共享的 apiClient 实例
 * - 环境感知: 根据运行环境和平台动态选择 API 地址
 * - 动态端口: Electron 环境下从主进程获取实际端口号
 * - 请求拦截: 在每个请求中注入项目上下文
 *
 * 环境适配策略:
 * 1. 开发环境 (import.meta.env.DEV): 使用相对路径(''),由 Vite 代理(dynamic-backend-proxy)
 *    转发到后端动态端口(后端 --port 0,实际端口写入 backend/.backend-port,Vite 代理自动读取)
 * 2. Electron 桌面环境: 默认相对路径,启动后由 appApi.initializeApiClient 从主进程
 *    获取实际端口并更新为 http://127.0.0.1:<动态端口>
 * 3. 其他生产环境: 回退到相对路径(由反向代理/部署环境转发)
 */

import { logger } from '@/core/utils/logger'
import { normalizeConfigDir, normalizePath } from '@/core/utils/pathNormalization'
import { eventBus } from '@/core/eventBus'
import { getApiToken, hasApiToken } from '@/core/services/apiToken'
import axios, { isAxiosError, type AxiosInstance, type AxiosError } from 'axios'

export { isAxiosError }

/**
 * 后端"项目配置路径不存在"404 的 detail 前缀（唯一抛出点：backend/app/api/dependencies.py）。
 * 表示持久化的项目路径已失效（项目被移动/删除）。后端还有约 50 处其他语义的 404
 * （如 Job not found），因此必须按 detail 前缀精确匹配，不能把所有 404 都视为项目丢失。
 */
const PROJECT_PATH_MISSING_DETAIL = '提供的项目配置路径不存在'

/**
 * 当前使用的 API 基础地址
 * 在 Electron 环境下会被动态更新
 */
let currentApiBaseUrl: string = ''

/**
 * 动态获取 API 基础地址
 *
 * 业务逻辑:
 * 根据当前的运行环境，智能选择合适的后端 API 地址
 *
 * [环境判断逻辑]
 * 1. 开发环境 (Vite): 返回空字符串(相对路径),由 Vite 代理转发到后端动态端口
 *    (后端端口由 OS 动态分配,Vite 的 dynamic-backend-proxy 插件读取 .backend-port 自动发现)
 * 2. 其他情况: 同样返回空字符串作为默认值
 *    - Electron 环境下,appApi.initializeApiClient 会从主进程获取实际端口并调
 *      updateApiBaseUrl() 更新为 http://127.0.0.1:<动态端口>
 *    - 其他生产环境由反向代理/部署环境转发相对路径请求
 *
 * @returns {string} API 服务器的基础地址(DEV/默认为空=走相对路径代理)
 */
const getBaseURL = (): string => {
  // 如果已经设置了动态地址(Electron 启动后注入),直接返回
  if (currentApiBaseUrl) {
    return currentApiBaseUrl
  }

  // 默认返回空字符串:axios baseURL 为空时请求走相对路径(如 /api/latest/...),
  // DEV 模式由 Vite 代理转发到后端动态端口,生产/Electron 由部署环境或 updateApiBaseUrl 处理
  return ''
}

/**
 * 更新 API 基础地址
 *
 * 业务用途:
 * - Electron 环境下，从主进程获取实际端口后更新地址
 * - 支持动态端口分配场景
 *
 * @param port - 后端服务器实际监听的端口号
 */
export const updateApiBaseUrl = (port: number): void => {
  currentApiBaseUrl = `http://127.0.0.1:${port}`
  // 更新 axios 实例的 baseURL
  apiClient.defaults.baseURL = `${currentApiBaseUrl}/api/latest`
  logger.debug(`[API] 已更新后端地址: ${currentApiBaseUrl}/api/latest`)
}

/**
 * 异步初始化 API 默认地址
 *
 * 业务用途:
 * - 设置默认 API 基础地址
 * - Electron 环境下实际端口由 appApi.initializeApiClient 负责更新
 *
 * @returns Promise<string> - 实际使用的 API 基础地址
 */
export const initApiBaseUrl = async (): Promise<string> => {
  // DEV 模式:使用空字符串(相对路径),由 Vite 代理转发到后端动态端口
  if (import.meta.env.DEV) {
    currentApiBaseUrl = ''
    return currentApiBaseUrl
  }

  // Electron 动态端口获取已迁移到 appApi.initializeApiClient
  // 此处默认同样返回空字符串,Electron 启动后会通过 updateApiBaseUrl 更新
  currentApiBaseUrl = ''
  return currentApiBaseUrl
}

/**
 * API 基础地址常量
 *
 * [初始化时机]
 * - 在模块加载时执行一次 getBaseURL()
 * - Electron 环境下会在应用启动后通过 appApi.initializeApiClient 更新
 *
 * [动态更新]
 * - Electron 环境下，端口可能动态分配
 * - 使用 appApi.initializeApiClient() 获取实际端口
 */
export function getApiBaseUrl(): string {
  return currentApiBaseUrl || getBaseURL()
}

export const API_BASE_URL = getApiBaseUrl()

/**
 * Axios HTTP 客户端实例
 *
 * [配置说明]
 * - baseURL: API 请求的基础路径
 * - 其他配置（如超时、拦截器）可根据需要添加
 *
 * [为什么使用 axios 而非 fetch]
 * - 自动转换 JSON
 * - 请求/响应拦截器更易用
 * - 更成熟的错误处理机制
 * - 更广泛的生态系统
 */
const apiClient: AxiosInstance = axios.create({
  // baseURL 统一以 /api/latest 为前缀（后端所有业务路由都挂在该前缀下）。
  // - Electron/生产：updateApiBaseUrl(port) 运行时会覆盖为 http://127.0.0.1:<port>/api/latest
  // - DEV/web：API_BASE_URL 为空，用相对路径 '/api/latest'，由 Vite 代理转发到后端动态端口
  //   （代理白名单 BACKEND_ROUTES 含 '/api'，可匹配 /api/latest/* 请求）
  // 历史 bug：DEV 模式下此处曾为 undefined，导致裸路径请求既不命中代理白名单、
  // 也不带 /api/latest 前缀，后端 404 返回 HTML，前端解析出 undefined 触发崩溃。
  baseURL: API_BASE_URL ? `${API_BASE_URL}/api/latest` : '/api/latest',
  timeout: 30000, // 30秒超时
})

/**
 * 从 localStorage 读取当前激活项目的配置路径
 * 供请求拦截器（注入 header）与响应拦截器（失效检测路径比对）共用
 */
function readActiveProjectPath(): string | undefined {
  try {
    const stored = localStorage.getItem('activeProjectPaths')
    if (stored) {
      const parsed = JSON.parse(stored) as { configPath?: unknown }
      return typeof parsed?.configPath === 'string' ? parsed.configPath : undefined
    }
  } catch {
    // 解析失败时静默处理，视同无激活项目
  }
  return undefined
}

/**
 * 请求拦截器
 *
 * 业务功能:
 * 在每个请求发出前，自动注入项目相关的 HTTP 头
 *
 * [注入的请求头]
 * - X-Project-Config-Path: 当前激活项目的配置文件路径
 *   用途: 后端据此定位项目配置目录
 *   来源: localStorage (activeProjectPaths，由 projectStore 写入)
 * - X-Precis-Auth: 后端 API 一次性 token（仅 Electron 打包模式有值）
 *   用途: 后端据此放行 app:// 页面（Origin: null）的跨域请求；
 *   恶意网页拿不到 token，其 null Origin 请求仍被后端 CORS 拒绝
 *   来源: 应用启动时经 appApi.getApiToken()（IPC）取得，存于 apiToken 模块
 *
 * [注入策略：显式路径优先]
 * - 仅当调用方未显式指定 X-Project-Config-Path 时才注入 localStorage 的激活路径
 * - 显式路径是调用方的权威路径（如 bootstrap 校验、项目切换）；
 *   若被 localStorage 残留的旧路径覆盖，会把对合法项目的请求污染成 404，
 *   进而触发"项目路径失效"误清理，连带清空最近项目记录（实际事故见 2026-08 修复）
 * - X-Precis-Auth 同理：调用方显式传入的同名头不被覆盖
 *
 * [条件注入]
 * - 仅当有激活项目时才注入头信息
 * - 避免在项目选择界面发出无效的 X-Project-Config-Path
 * - 仅当 token 已配置时才注入 X-Precis-Auth（Web/开发模式为空，不注入）
 */
apiClient.interceptors.request.use(
  (config) => {
    // 规范化路径格式后注入请求头，供后端定位项目配置目录
    const normalized = normalizeConfigDir(readActiveProjectPath())
    const hasExplicitHeader =
      typeof config.headers?.get === 'function'
        ? config.headers.get('X-Project-Config-Path') != null
        : (config.headers as Record<string, unknown> | undefined)?.['X-Project-Config-Path'] != null
    if (normalized && !hasExplicitHeader) {
      config.headers['X-Project-Config-Path'] = normalized
    }

    // 注入后端 API 一次性 token（打包模式 CORS 放行凭据；显式头不覆盖）
    if (hasApiToken()) {
      const hasExplicitAuth =
        typeof config.headers?.get === 'function'
          ? config.headers.get('X-Precis-Auth') != null
          : (config.headers as Record<string, unknown> | undefined)?.['X-Precis-Auth'] != null
      if (!hasExplicitAuth) {
        config.headers['X-Precis-Auth'] = getApiToken()
      }
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

/**
 * 响应拦截器 - 添加重试逻辑
 *
 * 业务场景:
 * - 处理后端未就绪时的连接拒绝错误
 * - 自动重试 GET 请求（幂等操作）
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config

    if (!config) {
      return Promise.reject(error)
    }

    // 项目路径失效检测：请求命中的项目路径在后端磁盘上不存在（项目被移动/删除）。
    // 清除 localStorage 残留路径并广播 project-path-invalid，由 App 层清理运行时状态、
    // 回到项目选择页；否则应用会带着死路径对后续所有项目级请求持续 404 且无法自愈。
    // 守卫：仅当失败路径与 localStorage 当前激活项目一致时才清理——并发在飞的
    // 旧路径 404、或调用方显式请求其他路径的 404，都不能误杀仍有效的激活项目。
    // 后端回显格式：`${PROJECT_PATH_MISSING_DETAIL}: <abspath>`（Windows 反斜杠），
    // 与 localStorage 路径经 normalizePath（斜杠/大小写归一）后比较。
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
    if (
      error.response?.status === 404 &&
      typeof detail === 'string' &&
      detail.startsWith(PROJECT_PATH_MISSING_DETAIL)
    ) {
      const failedPath = detail
        .slice(PROJECT_PATH_MISSING_DETAIL.length)
        .replace(/^:\s*/, '')
        .trim()
      const activePath = readActiveProjectPath()
      if (activePath && normalizePath(activePath) === normalizePath(failedPath)) {
        localStorage.removeItem('activeProjectPaths')
        logger.warn('[API] 项目路径已失效（后端返回路径不存在），已清除本地项目路径')
        eventBus.emit('project-path-invalid')
      }
    }

    // 初始化重试计数（从 config 对象上读取自定义属性）
    const retryCount = (config as { retryCount?: number }).retryCount || 0
    const maxRetries = 3

    // 仅幂等的 GET 允许自动重试：!error.response 表示无响应（连接拒绝/超时），
    // 此时非幂等请求（POST/PUT/DELETE）服务端可能已实际执行，重发会造成
    // 重复创建/提交等副作用，不能仅凭"无响应"就重试
    const isIdempotentGet = (config.method || '').toLowerCase() === 'get'

    // 判断是否应该重试：仅对无响应的 GET 网络错误进行重试，且不超过最大次数
    const shouldRetry = isIdempotentGet && !error.response && retryCount < maxRetries

    if (shouldRetry) {
      // 记录重试次数到 config 对象，供下次拦截器读取
      ;(config as { retryCount?: number }).retryCount = retryCount + 1
      const delay = 1000 * Math.pow(2, retryCount) // 指数退避: 1s, 2s, 4s

      logger.debug(`[API] 连接失败，${delay}ms 后重试 (${retryCount + 1}/${maxRetries})...`)

      await new Promise((resolve) => setTimeout(resolve, delay))
      return apiClient.request(config)
    }

    return Promise.reject(error)
  }
)

/**
 * 导出配置好的 Axios 实例
 *
 * 使用示例:
 * ```typescript
 * import apiClient from '@/core/services/httpClient';
 *
 * // 发起 GET 请求
 * const response = await apiClient.get('/workspace');
 *
 * // 发起 POST 请求
 * const response = await apiClient.post('/validation', data);
 * ```
 */
export default apiClient

/**
 * Agent 模式执行元数据（aiChatStore 消息轨迹使用）
 */
export interface AgentMeta {
  /** 实际迭代轮数 */
  iterations: number
  /** 工具调用轨迹，每步含 tool 名、人类可读 label、turn 轮次 */
  tool_steps: Array<{
    tool: string
    label: string
    turn: number
    action_count?: number
    /** 步骤执行状态（前端流式期间保留，历史消息可读取） */
    status?: 'running' | 'success' | 'failed'
    /** 失败时的错误信息 */
    error?: string
  }>
}

/**
 * 聊天历史消息项（供 aiChatStore 构建历史上下文使用）
 */
export interface ChatHistoryMessage {
  /** 消息角色 */
  role: 'user' | 'assistant'
  /** 消息内容 */
  content: string
}
