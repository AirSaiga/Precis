/**
 * 校验历史记录 API
 *
 * 封装 /validation/history 端点的 CRUD 操作。
 * 对应后端 validation/history.py 路由。
 *
 * 安全约定：项目路径由 httpClient 全局拦截器通过 X-Project-Config-Path header
 * 自动注入（项目加载后），API 函数不再显式传递 project_path。
 */
import apiClient from '@/core/services/httpClient'
import type {
  ValidationHistoryList,
  ValidationHistoryStats,
  ValidationRunRecord,
} from '@/types/validationHistory'

/** 分页获取校验历史记录列表 */
export async function fetchValidationHistory(
  limit = 20,
  offset = 0
): Promise<ValidationHistoryList> {
  const { data } = await apiClient.get('/validation/history', {
    params: { limit, offset },
  })
  return data
}

/** 获取单条校验运行记录详情 */
export async function fetchValidationRun(runId: string): Promise<ValidationRunRecord> {
  const { data } = await apiClient.get(`/validation/history/${encodeURIComponent(runId)}`)
  return data
}

/** 删除指定 runId 的校验运行记录 */
export async function deleteValidationRun(runId: string): Promise<void> {
  await apiClient.delete(`/validation/history/${encodeURIComponent(runId)}`)
}

/** 获取校验历史统计信息（趋势、最新等） */
export async function fetchValidationStats(lastN = 10): Promise<ValidationHistoryStats> {
  const { data } = await apiClient.get('/validation/history/stats', {
    params: { last_n: lastN },
  })
  return data
}

/** 保存一次校验运行的结果记录，返回 run_id */
export async function saveValidationRun(result: {
  duration_ms: number
  summary: Record<string, unknown>
  by_type?: Record<string, Record<string, number>>
  by_table?: Record<string, Record<string, number>>
  errors?: Array<Record<string, unknown>>
  warnings?: string[]
}): Promise<string> {
  const { data } = await apiClient.post('/validation/history', result)
  return data.run_id
}
