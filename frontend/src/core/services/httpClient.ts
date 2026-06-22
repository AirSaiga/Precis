// src/services/api.ts
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
 * 1. 开发环境 (import.meta.env.DEV): 使用 localhost:18000
 * 2. Electron 桌面环境: 默认 127.0.0.1:18000，启动后由 appApi.initializeApiClient 更新为实际端口
 * 3. 其他生产环境: 回退到 127.0.0.1:18000
 */

import { logger } from '@/core/utils/logger'
import { normalizeConfigDir } from '@/core/utils/pathNormalization'
import axios, { isAxiosError, type AxiosInstance, type AxiosError } from 'axios'

export { isAxiosError }

/**
 * 默认后端端口
 * 可通过环境变量 VITE_BACKEND_PORT 覆盖
 */
const DEFAULT_BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || '18000'

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
 * 1. 开发环境 (Vite): 使用 localhost:{VITE_BACKEND_PORT}，便于热重载调试
 * 2. 其他情况: 默认使用 127.0.0.1:{VITE_BACKEND_PORT}
 *    - Electron 实际端口会在应用启动后由 appApi.initializeApiClient 更新
 *    - 为什么不用 localhost?
 *    - 某些系统配置下 localhost 解析可能有问题
 *    - 127.0.0.1 是更底层的 IP 地址，更可靠
 *
 * @returns {string} API 服务器的基础地址
 */
const getBaseURL = (): string => {
  // 如果已经设置了动态地址，直接返回
  if (currentApiBaseUrl) {
    return currentApiBaseUrl
  }

  // 开发环境：Vite 开发服务器
  // [Vite] import.meta.env.DEV 是 Vite 注入的环境变量
  if (import.meta.env.DEV) {
    return `http://localhost:${DEFAULT_BACKEND_PORT}`
  }

  // 其他情况：默认使用 127.0.0.1
  // Electron 环境下实际端口会在应用启动后通过 appApi.initializeApiClient 更新
  return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`
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
  // 开发环境直接使用默认地址
  if (import.meta.env.DEV) {
    currentApiBaseUrl = `http://localhost:${DEFAULT_BACKEND_PORT}`
    return currentApiBaseUrl
  }

  // Electron 动态端口获取已迁移到 appApi.initializeApiClient
  // 此处仅做默认回退
  currentApiBaseUrl = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`
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
  baseURL: API_BASE_URL ? `${API_BASE_URL}/api/latest` : undefined,
  timeout: 30000, // 30秒超时
})

/**
 * 请求拦截器
 *
 * 业务功能:
 * 在每个请求发出前，自动注入项目相关的 HTTP 头
 *
 * [注入的请求头]
 * - X-Project-Config-Path: 当前激活项目的配置文件路径
 *   用途: 后端据此定位项目配置目录
 *   来源: Pinia store (useProjectStore)
 *
 * [设计决策]
 * - 使用拦截器而非在每个调用处手动添加
 *   1. 代码更 DRY（Don't Repeat Yourself）
 *   2. 统一管理，易于维护
 *   3. 减少遗漏的可能性
 *
 * [条件注入]
 * - 仅当有激活项目时才注入头信息
 * - 避免在项目选择界面发出无效的 X-Project-Config-Path
 */
apiClient.interceptors.request.use(
  (config) => {
    let configPath: string | undefined
    try {
      // 从 localStorage 读取当前激活项目的配置路径
      const stored = localStorage.getItem('activeProjectPaths')
      if (stored) {
        const parsed = JSON.parse(stored)
        configPath = parsed?.configPath
      }
    } catch {
      // 解析失败时静默处理，不注入项目路径头
      configPath = undefined
    }
    // 规范化路径格式后注入请求头，供后端定位项目配置目录
    const normalized = normalizeConfigDir(configPath)
    if (normalized) {
      config.headers['X-Project-Config-Path'] = normalized
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

    // 初始化重试计数（从 config 对象上读取自定义属性）
    const retryCount = (config as { retryCount?: number }).retryCount || 0
    const maxRetries = 3

    // 判断是否应该重试：仅对无响应的网络错误进行重试，且不超过最大次数
    const shouldRetry = !error.response && retryCount < maxRetries

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
 * AI Chat 接口
 *
 * 提供与后端 /ai/chat 端点通信的类型定义和发送函数。
 */

/** AI 聊天请求体 */
export interface AiChatRequest {
  /** 用户输入的消息内容 */
  message: string
  /** 上下文信息（包含选中节点状态） */
  context: {
    hasContext: boolean
    selectedNodes: Array<{
      id: string
      type: string
      data: Record<string, unknown>
      label?: string
    }>
  }
  /** 历史消息记录（可选） */
  history?: ChatHistoryMessage[]
  /** 是否启用 Agent 深度模式 */
  agent_mode?: boolean
}

/** Agent 模式执行元数据（仅 agent_mode=true 时后端填充） */
export interface AgentMeta {
  /** 实际迭代轮数 */
  iterations: number
  /** 工具调用轨迹，每步含 tool 名、人类可读 label、turn 轮次 */
  tool_steps: Array<{
    tool: string
    label: string
    turn: number
    action_count?: number
  }>
}

/** AI 聊天响应体 */
export interface AiChatResponse {
  /** 响应状态 */
  status: string
  /** AI 回复文本 */
  reply: string
  /** 后端建议的操作列表 */
  actions: unknown[]
  /** 前端渲染指令列表 */
  frontend_instructions: unknown[]
  /** Agent 模式执行元数据（非 agent 模式为 null） */
  agent_meta?: AgentMeta | null
  /** 错误信息（如有） */
  error?: string
}

/** 聊天历史消息项 */
export interface ChatHistoryMessage {
  /** 消息角色 */
  role: 'user' | 'assistant'
  /** 消息内容 */
  content: string
}

/**
 * 发送 AI 聊天消息
 *
 * @param message - 用户输入的消息
 * @param context - 当前上下文（含选中节点）
 * @param history - 历史消息记录（可选）
 * @returns AI 响应结果
 */
export const sendAiChatMessage = async (
  message: string,
  context: {
    hasContext: boolean
    selectedNodes: Array<{
      id: string
      type: string
      data: Record<string, unknown>
    }>
  },
  history?: ChatHistoryMessage[],
  agentMode: boolean = true
): Promise<AiChatResponse> => {
  const request: AiChatRequest = {
    message,
    context,
    history: history || [],
    agent_mode: agentMode,
  }
  const response = await apiClient.post<AiChatResponse>('/ai/chat', request)
  return response.data
}
