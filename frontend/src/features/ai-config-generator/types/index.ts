/**
 * @file AI 配置生成器 Feature 类型导出
 *
 * Re-export 自共享 types/ai.ts 中的生成器相关类型，
 * 方便 feature 内部引用。
 */
export type {
  AiGenerateV2ConfigOptions,
  AiGenerateV2ConfigRequest,
  AiGenerateV2ConfigResponse,
  AiGenerateV2ConfigJobCreateResponse,
  AiGenerateV2ConfigJobStatusValue,
  AiGenerateV2ConfigJobStatus,
  CloudAIProviderResponse,
  CloudAIProviderRequest,
  CloudAIProviderTestResponse,
} from '@/types/ai'
