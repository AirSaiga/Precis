/**
 * 校验历史记录 API
 *
 * 封装 /validation/history 端点的 CRUD 操作。
 * 对应后端 validation/history.py 路由。
 */
import apiClient from '@/core/services/httpClient'
import type {
  ValidationHistoryList,
  ValidationHistoryStats,
  ValidationRunRecord,
} from '@/types/validationHistory'

/** 分页获取校验历史记录列表 */
export async function fetchValidationHistory(
  projectPath: string,
  limit = 20,
  offset = 0
): Promise<ValidationHistoryList> {
  const { data } = await apiClient.get('/validation/history', {
    params: { project_path: projectPath, limit, offset },
  })
  return data
}

/** 获取单条校验运行记录详情 */
export async function fetchValidationRun(
  runId: string,
  projectPath: string
): Promise<ValidationRunRecord> {
  const { data } = await apiClient.get(`/validation/history/${encodeURIComponent(runId)}`, {
    params: { project_path: projectPath },
  })
  return data
}

/** 删除指定 runId 的校验运行记录 */
export async function deleteValidationRun(
  runId: string,
  projectPath: string
): Promise<void> {
  await apiClient.delete(`/validation/history/${encodeURIComponent(runId)}`, {
    params: { project_path: projectPath },
  })
}

/** 获取校验历史统计信息（趋势、最新等） */
export async function fetchValidationStats(
  projectPath: string,
  lastN = 10
): Promise<ValidationHistoryStats> {
  const { data } = await apiClient.get('/validation/history/stats', {
    params: { project_path: projectPath, last_n: lastN },
  })
  return data
}

/** 保存一次校验运行的结果记录，返回 run_id */
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
  const { data } = await apiClient.post('/validation/history', {
    project_path: projectPath,
    ...result,
  })
  return data.run_id
}
