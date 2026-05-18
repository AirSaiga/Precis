/**
 * @file useValidationReportExport.ts
 * @description 数据质量检测报告导出 Composable
 *
 * 使用示例:
 * // 导出 PDF 报告
 * await exportReport(validationData, 'pdf', '我的项目')
 * ```
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  exportReport as exportReportService,
  exportHtmlReport,
  exportPdfReport,
  previewHtmlReport,
  type ReportGenerateOptions,
} from '@/services/reportExportService'
import type { FullValidationResponse } from '@/api/projectValidationApi'

/**
 * 导出格式类型
 */
export type ExportFormat = 'html' | 'pdf'

/**
 * 导出状态
 */
export interface ExportState {
  /** 是否正在导出 */
  isExporting: boolean
  /** 导出错误信息 */
  error: string | null
  /** 导出成功 */
  success: boolean
}

/**
 * 使用数据质量检测报告导出功能
 *
 * @returns 导出方法和状态
 */
export function useValidationReportExport() {
  const { t } = useI18n()

  // 导出状态
  const isExporting = ref(false)
  const exportError = ref<string | null>(null)
  const exportSuccess = ref(false)

  /**
   * 导出报告
   *
   * @param data 校验结果数据
   * @param format 导出格式：'html' 或 'pdf'
   * @param projectName 项目名称
   * @returns Promise<void>
   */
  const exportReport = async (
    data: FullValidationResponse,
    format: ExportFormat,
    projectName: string
  ): Promise<void> => {
    // 重置状态
    isExporting.value = true
    exportError.value = null
    exportSuccess.value = false

    try {
      const timestamp = new Date().toLocaleString('zh-CN')
      const options: ReportGenerateOptions = {
        projectName: projectName || t('common.projectManagement.unnamed'),
        timestamp,
        t: (key: string) => t(key),
      }

      if (format === 'html') {
        exportHtmlReport(data, options)
      } else {
        await exportPdfReport(data, options)
      }

      exportSuccess.value = true
    } catch (error) {
      logger.error('报告导出失败:', error)
      exportError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      isExporting.value = false
    }
  }

  /**
   * 重置导出状态
   */
  const resetExportState = () => {
    isExporting.value = false
    exportError.value = null
    exportSuccess.value = false
  }

  /**
   * 预览 HTML 报告
   *
   * @param data 校验结果数据
   * @param projectName 项目名称
   */
  const previewReport = (data: FullValidationResponse, projectName: string): void => {
    const timestamp = new Date().toLocaleString('zh-CN')
    const options: ReportGenerateOptions = {
      projectName: projectName || t('common.projectManagement.unnamed'),
      timestamp,
      t: (key: string) => t(key),
    }

    previewHtmlReport(data, options)
  }

  return {
    // 方法
    exportReport,
    previewReport,
    resetExportState,
    // 状态
    isExporting,
    exportError,
    exportSuccess,
  }
}

// 默认导出
export default useValidationReportExport
