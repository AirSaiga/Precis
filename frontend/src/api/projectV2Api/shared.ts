/**
 * @file shared.ts
 * @description V2 API 共享工具与类型
 *
 * 跨多个 API 领域使用的辅助类型与错误类型。
 */

import { isAxiosError } from 'axios'
import type { ProjectManifestV2 } from '@/types/projectV2'

/**
 * 项目未找到错误（404）
 * 用于区分"项目路径不存在"与"服务器错误"，便于调用方选择是否静默处理
 */
export class ProjectNotFoundError extends Error {
  constructor(public readonly configPath?: string) {
    super(configPath ? `项目未找到: ${configPath}` : '项目未找到')
    this.name = 'ProjectNotFoundError'
  }
}

/**
 * 构造 X-Project-Config-Path header 配置（当 configPath 非空时）
 */
export const withConfigPathHeader = (configPath?: string) =>
  configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined

/**
 * 判断是否是 404 项目未找到错误
 */
export const isProjectNotFound = (e: unknown): boolean =>
  isAxiosError(e) && e.response?.status === 404

export type { ProjectManifestV2 }
