/**
 * @file reportExportService.ts
 * @description 校验报告导出服务
 *
 * 功能概述：
 * - 生成 HTML 格式的数据质量检测报告
 * - 导出 PDF 报告（基于 html2canvas + jsPDF）
 * - 提供报告预览与下载触发功能
 * - 支持 i18n 国际化的报告文本渲染
 */

import { logger } from '@/core/utils/logger'
import type { FullValidationResponse } from '@/api/projectValidationApi'
import { generateHtmlReport } from './reportExport/htmlReportGenerator'

/**
 * 报告生成选项
 */
export interface ReportGenerateOptions {
  /** 项目名称 */
  projectName: string
  /** 生成时间戳 */
  timestamp: string
  /** i18n 翻译函数 */
  t: (key: string) => string
}

/**
 * 导出选项
 */
export interface ExportOptions extends ReportGenerateOptions {
  /** 导出格式 */
  format: 'html' | 'pdf'
}

/**
 * SVG 图标
 */

/**
 * 生成 HTML 报告内容
 *
 * @param data 校验结果数据
 * @param options 报告生成选项
 * @returns HTML 字符串
 */
export function exportHtmlReport(
  data: FullValidationResponse,
  options: ReportGenerateOptions
): void {
  const { projectName, t } = options

  // 生成 HTML 内容
  const htmlContent = generateHtmlReport(data, options)

  // 创建下载
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${t('common.fullValidation.export.reportFilename')}_${projectName}_${new Date().toISOString().slice(0, 10)}.html`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 导出 PDF 报告并触发下载
 *
 * @param data 校验结果数据
 * @param options 导出选项
 */
export async function exportPdfReport(
  data: FullValidationResponse,
  options: ReportGenerateOptions
): Promise<void> {
  const { projectName, t } = options

  // 动态导入 html2canvas 和 jspdf
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  // 创建临时容器
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.width = '1400px'
  container.style.background = 'white'
  document.body.appendChild(container)

  // 生成 HTML 内容
  const htmlContent = generateHtmlReport(data, options)
  // 使用 Range/DocumentFragment 插入自生成的报告 HTML，避免直接 innerHTML 赋值
  const fragment = document.createRange().createContextualFragment(htmlContent)
  container.appendChild(fragment)

  // 使用 html2canvas 转换为图片
  const canvas = await html2canvas(container, {
    scale: 2,
    useCORS: true,
    logging: false,
    width: 1400,
  })

  // 创建 PDF
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF('p', 'mm', 'a4')

  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()
  const imgWidth = canvas.width
  const imgHeight = canvas.height
  const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight)

  let position = 0
  let heightLeft = imgHeight

  // 添加第一页
  pdf.addImage(imgData, 'PNG', 0, position, imgWidth * ratio, imgHeight * ratio)
  heightLeft -= pdfHeight

  // 如果内容超过一页，添加更多页
  while (heightLeft > 0) {
    position = heightLeft - imgHeight
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth * ratio, imgHeight * ratio)
    heightLeft -= pdfHeight
  }

  // 下载 PDF
  pdf.save(
    `${t('common.fullValidation.export.reportFilename')}_${projectName}_${new Date().toISOString().slice(0, 10)}.pdf`
  )

  // 清理
  document.body.removeChild(container)
}

/**
 * 导出报告（根据格式自动选择导出方式）
 *
 * @param data 校验结果数据
 * @param options 导出选项
 */
export async function exportReport(
  data: FullValidationResponse,
  options: ExportOptions
): Promise<void> {
  if (options.format === 'html') {
    exportHtmlReport(data, options)
  } else {
    await exportPdfReport(data, options)
  }
}

/**
 * 预览 HTML 报告
 * 在浏览器环境中尝试新标签页打开，否则下载文件
 *
 * @param data 校验结果数据
 * @param options 报告生成选项
 */
export function previewHtmlReport(
  data: FullValidationResponse,
  options: ReportGenerateOptions
): void {
  const htmlContent = generateHtmlReport(data, options)

  const dataUri = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent)

  try {
    const newWindow = window.open(dataUri, '_blank')
    if (newWindow) {
      return
    }
  } catch (e) {
    logger.warn('无法打开新窗口，回退到下载方式')
  }

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${options.projectName}_report.html`
  link.click()
  URL.revokeObjectURL(url)
}
