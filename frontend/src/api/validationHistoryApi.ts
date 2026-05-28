import apiClient from '@/core/services/httpClient'
import type {
  ValidationHistoryList,
  ValidationHistoryStats,
  ValidationRunRecord,
} from '@/types/validationHistory'

export async function fetchValidationHistory(
  projectPath: string,
  limit = 20,
  offset = 0
): Promise<ValidationHistoryList> {
  const { data } = await apiClient.get('/v2/validation/history', {
    params: { project_path: projectPath, limit, offset },
  })
  return data
}

export async function fetchValidationRun(
  runId: string,
  projectPath: string
): Promise<ValidationRunRecord> {
  const { data } = await apiClient.get(`/v2/validation/history/${runId}`, {
    params: { project_path: projectPath },
  })
  return data
}

export async function deleteValidationRun(
  runId: string,
  projectPath: string
): Promise<void> {
  await apiClient.delete(`/v2/validation/history/${runId}`, {
    params: { project_path: projectPath },
  })
}

export async function fetchValidationStats(
  projectPath: string,
  lastN = 10
): Promise<ValidationHistoryStats> {
  const { data } = await apiClient.get('/v2/validation/history/stats', {
    params: { project_path: projectPath, last_n: lastN },
  })
  return data
}

export async function saveValidationRun(
  projectPath: string,
  result: {
    duration_ms: number
    summary: Record<string, unknown>
    by_type?: Record<string, Record<string, number>>
    by_table?: Record<string, Record<string, number>>
    errors?: Array<Record<string, unknown>>
    warnings?: string[]
  }
): Promise<string> {
  const { data } = await apiClient.post('/v2/validation/history', {
    project_path: projectPath,
    ...result,
  })
  return data.run_id
}
