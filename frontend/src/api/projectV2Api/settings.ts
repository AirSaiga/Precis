/**
 * @file settings.ts
 * @description V2 项目设置（项目级/校验/文件处理/脚本安全）读写 API
 */

import apiClient from '@/core/services/httpClient'
import type {
  ProjectSettings,
  ValidationSettings,
  FileProcessingSettings,
  ScriptSecuritySettings,
} from '@/types/projectV2'

/**
 * 获取项目设置（从 project.precis.yaml 的 settings 字段）
 */
export async function getProjectSettings(): Promise<ProjectSettings> {
  const { data } = await apiClient.get<ProjectSettings>('/project/config/settings')
  return data
}

export async function updateProjectSettings(settings: ProjectSettings): Promise<void> {
  await apiClient.put('/project/config/settings', settings)
}

export async function getValidationSettings(): Promise<ValidationSettings> {
  const { data } = await apiClient.get<ValidationSettings>('/project/config/validation')
  return data
}

export async function updateValidationSettings(settings: ValidationSettings): Promise<void> {
  await apiClient.put('/project/config/validation', settings)
}

export async function getFileProcessingSettings(): Promise<FileProcessingSettings> {
  const { data } = await apiClient.get<FileProcessingSettings>('/project/config/file-processing')
  return data
}

export async function updateFileProcessingSettings(
  settings: FileProcessingSettings
): Promise<void> {
  await apiClient.put('/project/config/file-processing', settings)
}

export async function getScriptSecuritySettings(): Promise<ScriptSecuritySettings> {
  const { data } = await apiClient.get<ScriptSecuritySettings>('/project/config/script-security')
  return data
}

export async function updateScriptSecuritySettings(
  settings: ScriptSecuritySettings
): Promise<void> {
  await apiClient.put('/project/config/script-security', settings)
}
