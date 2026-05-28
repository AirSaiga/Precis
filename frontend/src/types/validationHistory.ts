export interface ValidationRunSummary {
  total_checks: number
  passed_count: number
  failed_count: number
  pass_rate: number
  tables_loaded: number
  total_error_count: number
}

export interface ValidationRunRecord {
  id: string
  timestamp: string
  duration_ms: number
  scope: string
  summary: ValidationRunSummary
  by_type: Record<string, { total: number; passed: number; failed: number }>
  by_table: Record<string, { total: number; passed: number; failed: number }>
  errors: Array<{
    stage: string
    error_type: string
    check_type: string
    message: string
    table?: string
    column?: string
    row_index?: number
    value?: string
  }>
  warnings: string[]
}

export interface ValidationHistoryList {
  total: number
  limit: number
  offset: number
  items: ValidationRunRecord[]
}

export interface ValidationHistoryStats {
  total_runs: number
  trend: Array<{
    id: string
    timestamp: string
    pass_rate: number
    total_checks: number
    failed_count: number
  }>
  latest: {
    pass_rate: number
    total_checks: number
    passed_count: number
    failed_count: number
    timestamp: string | null
  }
}
