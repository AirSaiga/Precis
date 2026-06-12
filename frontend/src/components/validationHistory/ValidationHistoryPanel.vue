<template>
  <div class="validation-history-panel">
    <!-- 顶部统计卡片 -->
    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-value" :class="passRateClass">{{ latestPassRate }}%</div>
        <div class="stat-label">{{ t('validationHistory.passRate', '通过率') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ latestTotalChecks }}</div>
        <div class="stat-label">{{ t('validationHistory.totalChecks', '检查数') }}</div>
      </div>
      <div class="stat-card error">
        <div class="stat-value">{{ latestFailedCount }}</div>
        <div class="stat-label">{{ t('validationHistory.failed', '失败') }}</div>
      </div>
    </div>

    <!-- 趋势迷你图 -->
    <div v-if="stats.trend.length > 1" class="trend-section">
      <div class="section-title">{{ t('validationHistory.trend', '趋势') }}</div>
      <div class="trend-chart">
        <svg :viewBox="`0 0 ${trendWidth} ${trendHeight}`" class="trend-svg">
          <polyline
            :points="trendPoints"
            fill="none"
            stroke="var(--ui-accent)"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <circle
            v-for="(p, i) in trendDots"
            :key="i"
            :cx="p.x"
            :cy="p.y"
            r="3"
            :fill="i === trendDots.length - 1 ? 'var(--ui-accent)' : 'var(--ui-bg-base)'"
            stroke="var(--ui-accent)"
            stroke-width="1.5"
          />
        </svg>
      </div>
    </div>

    <!-- 运行历史列表 -->
    <div class="history-section">
      <div class="section-title">{{ t('validationHistory.history', '历史记录') }}</div>
      <div v-if="loading" class="loading-state">{{ t('common.loading', '加载中...') }}</div>
      <div v-else-if="runs.length === 0" class="empty-state">
        {{ t('validationHistory.empty', '暂无校验记录') }}
      </div>
      <div v-else class="history-list">
        <div
          v-for="run in runs"
          :key="run.id"
          class="history-item"
          :class="{ expanded: expandedId === run.id }"
        >
          <div class="history-row" @click="toggleExpand(run.id)">
            <div class="history-info">
              <div class="history-time">{{ formatTime(run.timestamp) }}</div>
              <div class="history-meta">
                <span class="pass-rate" :class="getPassRateClass(run.summary?.pass_rate ?? 0)">
                  {{ (run.summary?.pass_rate ?? 0).toFixed(1) }}%
                </span>
                <span class="check-count">
                  {{ run.summary?.passed_count ?? 0 }}/{{ run.summary?.total_checks ?? 0 }}
                </span>
              </div>
            </div>
            <div class="history-actions">
              <button class="action-btn delete" @click.stop="handleDelete(run.id)" title="删除">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path
                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  ></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- 展开详情 -->
          <div v-if="expandedId === run.id" class="history-detail">
            <!-- 按类型统计 -->
            <div class="detail-subtitle">{{ t('validationHistory.byType', '按类型') }}</div>
            <div class="detail-table">
              <div v-for="(val, key) in run.by_type" :key="key" class="detail-row">
                <span class="detail-name">{{ key }}</span>
                <span class="detail-bar">
                  <span
                    class="bar-fill"
                    :style="{ width: `${val.total > 0 ? (val.passed / val.total) * 100 : 0}%` }"
                  ></span>
                </span>
                <span class="detail-count">{{ val.passed }}/{{ val.total }}</span>
              </div>
            </div>

            <!-- 按表统计 -->
            <div class="detail-subtitle">{{ t('validationHistory.byTable', '按表') }}</div>
            <div class="detail-table">
              <div v-for="(val, key) in run.by_table" :key="key" class="detail-row">
                <span class="detail-name">{{ key }}</span>
                <span class="detail-bar">
                  <span
                    class="bar-fill"
                    :style="{ width: `${val.total > 0 ? (val.passed / val.total) * 100 : 0}%` }"
                  ></span>
                </span>
                <span class="detail-count">{{ val.passed }}/{{ val.total }}</span>
              </div>
            </div>

            <!-- 错误明细 -->
            <div v-if="run.errors.length > 0" class="detail-subtitle">
              {{ t('validationHistory.errors', '错误明细') }} ({{ run.errors.length }})
            </div>
            <div v-if="run.errors.length > 0" class="error-list">
              <div v-for="(err, i) in run.errors.slice(0, 20)" :key="i" class="error-item">
                <span class="error-table">{{ err.table || '-' }}</span>
                <span class="error-col">{{ err.column || '-' }}</span>
                <span class="error-msg">{{ err.message }}</span>
              </div>
              <div v-if="run.errors.length > 20" class="error-more">
                {{ t('validationHistory.moreErrors', { count: run.errors.length - 20 }) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { logger } from '@/core/utils/logger'
  import { useProjectStore } from '@/stores/projectStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import {
    fetchValidationHistory,
    fetchValidationStats,
    deleteValidationRun,
  } from '@/api/validationHistoryApi'
  import type { ValidationRunRecord, ValidationHistoryStats } from '@/types/validationHistory'

  const { t } = useI18n()
  const projectStore = useProjectStore()
  const validationTaskStore = useValidationTaskStore()

  const runs = ref<ValidationRunRecord[]>([])
  const stats = ref<ValidationHistoryStats>({
    total_runs: 0,
    trend: [],
    latest: { pass_rate: 0, total_checks: 0, passed_count: 0, failed_count: 0, timestamp: null },
  })
  const loading = ref(false)
  const expandedId = ref<string | null>(null)

  const projectPath = computed(() => projectStore.currentPaths?.configPath || '')

  const latestPassRate = computed(() => stats.value.latest.pass_rate.toFixed(1))
  const latestTotalChecks = computed(() => stats.value.latest.total_checks)
  const latestFailedCount = computed(() => stats.value.latest.failed_count)

  const passRateClass = computed(() => {
    const rate = stats.value.latest.pass_rate
    if (rate >= 95) return 'success'
    if (rate >= 80) return 'warning'
    return 'error'
  })

  const trendWidth = 200
  const trendHeight = 40

  const trendPoints = computed(() => {
    const trend = stats.value.trend
    if (trend.length < 2) return ''
    const step = trendWidth / (trend.length - 1)
    return trend
      .map((t, i) => `${i * step},${trendHeight - (t.pass_rate / 100) * trendHeight}`)
      .join(' ')
  })

  const trendDots = computed(() => {
    const trend = stats.value.trend
    if (trend.length < 2) return []
    const step = trendWidth / (trend.length - 1)
    return trend.map((t, i) => ({
      x: i * step,
      y: trendHeight - (t.pass_rate / 100) * trendHeight,
    }))
  })

  const formatTime = (timestamp: string): string => {
    const d = new Date(timestamp)
    return d.toLocaleString([], {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getPassRateClass = (rate: number): string => {
    if (rate >= 95) return 'success'
    if (rate >= 80) return 'warning'
    return 'error'
  }

  const toggleExpand = (id: string) => {
    expandedId.value = expandedId.value === id ? null : id
  }

  const loadData = async () => {
    if (!projectPath.value) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      const [historyRes, statsRes] = await Promise.all([
        fetchValidationHistory(projectPath.value, 50, 0),
        fetchValidationStats(projectPath.value, 10),
      ])
      runs.value = historyRes.items || []
      stats.value = statsRes
    } catch (e) {
      logger.error('[ValidationHistoryPanel] 加载失败:', e)
    } finally {
      loading.value = false
    }
  }

  const handleDelete = async (runId: string) => {
    if (!projectPath.value) return
    try {
      await deleteValidationRun(runId, projectPath.value)
      runs.value = runs.value.filter((r) => r.id !== runId)
      const statsRes = await fetchValidationStats(projectPath.value, 10)
      stats.value = statsRes
    } catch (e) {
      logger.error('[ValidationHistoryPanel] 删除失败:', e)
    }
  }

  onMounted(loadData)

  watch(projectPath, () => {
    if (projectPath.value) loadData()
  })

  watch(
    () => validationTaskStore.lastRunTimestamp,
    () => {
      if (projectPath.value && validationTaskStore.lastRunTimestamp > 0) {
        loadData()
      }
    }
  )
</script>

<style scoped src="./ValidationHistoryPanel.styles.css"></style>
