/**
 * @file aiApi.ts
 * @description AI/LLM 相关 API 封装
 *
 * 说明：
 * - 前端通过后端 /ai/* 访问 Ollama 与配置生成能力
 * - 统一使用 X-Project-Config-Path 头传递项目配置路径
 * - AI Provider 配置完全由用户本地 ai_providers.json 控制，前端只读展示
 */

import apiClient from '@/core/services/httpClient'
import type {
  AiGenerateV2ConfigJobCreateResponse,
  AiGenerateV2ConfigJobStatus,
  AiGenerateV2ConfigRequest,
  AiGenerateV2ConfigResponse,
  AiHardwareDiagnoseResponse,
  AiModelModes,
  CloudAIProviderResponse,
  CloudAIProviderTestResponse,
  CreateProviderRequest,
  ProviderPreset,
  UpdateProviderRequest,
} from '@/types/ai'

/**
 * 获取 Ollama 服务健康状态
 *
 * @returns 健康检查响应数据
 */
export async function getOllamaHealth() {
  const { data } = await apiClient.get('/ai/ollama/health')
  return data
}

/**
 * 获取 Ollama 本地可用模型列表
 *
 * @returns 模型列表数据
 */
export async function getOllamaModels() {
  const { data } = await apiClient.get('/ai/ollama/models')
  return data
}

/**
 * 获取 AI 模型模式配置（basic / advanced / super）
 *
 * @returns 模型模式配置对象
 */
export async function getAiModelModes(): Promise<AiModelModes> {
  const { data } = await apiClient.get<AiModelModes>('/ai/ollama/model-modes')
  return data
}

/**
 * 获取 AI 硬件诊断报告
 *
 * 根据选择的模型模式检测本地硬件是否满足运行要求。
 *
 * @param modelMode - 模型模式（basic / advanced / super）
 * @param provider - 指定 Provider（可选）
 * @returns 硬件诊断结果
 */
export async function getAiHardwareDiagnose(
  modelMode: string,
  provider?: string
): Promise<AiHardwareDiagnoseResponse> {
  const params: Record<string, string> = { model_mode: modelMode }
  if (provider) {
    params.provider = provider
  }
  const { data } = await apiClient.get<AiHardwareDiagnoseResponse>('/ai/hardware/diagnose', {
    params,
  })
  return data
}

/**
 * 同步生成 V2 项目配置
 *
 * 调用 AI 服务根据数据文件生成 Schema、Constraint、Regex 配置。
 *
 * @param payload - 生成请求参数
 * @param configPath - 项目配置文件路径（可选）
 * @returns 生成的配置结果
 */
export async function postAiGenerateV2Config(
  payload: AiGenerateV2ConfigRequest,
  configPath?: string
): Promise<AiGenerateV2ConfigResponse> {
  const { data } = await apiClient.post<AiGenerateV2ConfigResponse>(
    '/ai/config/generate',
    payload,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 创建异步 V2 配置生成任务
 *
 * 适用于大数据量场景，返回任务 ID 用于轮询进度。
 *
 * @param payload - 生成请求参数
 * @param configPath - 项目配置文件路径（可选）
 * @returns 任务创建响应（含 job_id）
 */
export async function postAiGenerateV2ConfigJob(
  payload: AiGenerateV2ConfigRequest,
  configPath?: string
): Promise<AiGenerateV2ConfigJobCreateResponse> {
  const { data } = await apiClient.post<AiGenerateV2ConfigJobCreateResponse>(
    '/ai/config/generate/jobs',
    payload,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 查询异步配置生成任务状态
 *
 * @param jobId - 任务 ID
 * @param configPath - 项目配置文件路径（可选）
 * @returns 任务状态及结果
 */
export async function getAiGenerateV2ConfigJob(
  jobId: string,
  configPath?: string
): Promise<AiGenerateV2ConfigJobStatus> {
  const { data } = await apiClient.get<AiGenerateV2ConfigJobStatus>(
    `/ai/config/generate/jobs/${encodeURIComponent(jobId)}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 取消异步配置生成任务
 *
 * @param jobId - 任务 ID
 * @param configPath - 项目配置文件路径（可选）
 * @returns 任务取消后的状态
 */
export async function postCancelAiGenerateV2ConfigJob(
  jobId: string,
  configPath?: string
): Promise<AiGenerateV2ConfigJobStatus> {
  const { data } = await apiClient.post<AiGenerateV2ConfigJobStatus>(
    `/ai/config/generate/jobs/${encodeURIComponent(jobId)}/cancel`,
    undefined,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 批量展开路径（支持通配符和环境变量）
 *
 * @param paths - 原始路径数组
 * @param configPath - 项目配置文件路径（可选）
 * @returns 展开后的绝对路径数组
 */
export async function postExpandPaths(paths: string[], configPath?: string): Promise<string[]> {
  const { data } = await apiClient.post<string[]>(
    '/ai/utils/expand-paths',
    paths,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 获取已配置的 AI Provider 列表（只读，来自用户本地 ai_providers.json）
 */
export async function getCloudAIProviders(): Promise<CloudAIProviderResponse[]> {
  const { data } = await apiClient.get<CloudAIProviderResponse[]>('/ai/providers')
  return data
}

/**
 * 获取当前活动的 AI Provider（只读）
 */
export async function getActiveCloudAIProvider(): Promise<CloudAIProviderResponse | null> {
  const { data } = await apiClient.get<CloudAIProviderResponse | null>('/ai/providers/active')
  return data
}

/**
 * 获取云端 AI Provider 配置信息（路径、模板等）
 */
export async function getCloudAIProviderConfigInfo(): Promise<{
  path: string | null
  default_path: string
  template: string
  exists: boolean
}> {
  const { data } = await apiClient.get('/ai/providers/config-info')
  return data
}

/**
 * 测试 AI Provider 连接
 *
 * 执行健康检查并获取可用模型列表。
 *
 * @param providerId - Provider ID
 * @returns 测试结果（含健康状态和可用模型列表）
 */
export async function testCloudAIProvider(
  providerId: string
): Promise<{
  provider_id: string
  health: { status: string; latency_ms?: number; error?: string }
  available_models: string[]
}> {
  const { data } = await apiClient.post(`/ai/providers/${encodeURIComponent(providerId)}/test`)
  return data
}

/**
 * 激活 AI Provider（设为默认 chat provider）
 *
 * @param providerId - Provider ID
 * @returns 激活后的 Provider 信息
 */
export async function activateCloudAIProvider(
  providerId: string
): Promise<CloudAIProviderResponse> {
  const { data } = await apiClient.post<CloudAIProviderResponse>(
    `/ai/providers/${encodeURIComponent(providerId)}/activate`
  )
  return data
}

/**
 * 获取内置服务商预设列表
 */
export async function getProviderPresets(): Promise<ProviderPreset[]> {
  const { data } = await apiClient.get<ProviderPreset[]>('/ai/providers/presets')
  return data
}

/**
 * 创建新的 AI Provider
 */
export async function createCloudAIProvider(
  req: CreateProviderRequest
): Promise<CloudAIProviderResponse> {
  const { data } = await apiClient.post<CloudAIProviderResponse>('/ai/providers', req)
  return data
}

/**
 * 更新已有 AI Provider
 */
export async function updateCloudAIProvider(
  providerId: string,
  req: UpdateProviderRequest
): Promise<CloudAIProviderResponse> {
  const { data } = await apiClient.put<CloudAIProviderResponse>(
    `/ai/providers/${encodeURIComponent(providerId)}`,
    req
  )
  return data
}

/**
 * 删除 AI Provider
 */
export async function deleteCloudAIProvider(providerId: string): Promise<void> {
  await apiClient.delete(`/ai/providers/${encodeURIComponent(providerId)}`)
}
