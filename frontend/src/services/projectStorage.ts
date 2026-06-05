/**
 * @file projectStorage.ts
 * @description 项目历史存储服务
 *
 * 服务职责：
 * - 管理最近打开项目的历史记录
 * - 提供项目信息的持久化存储
 * - 与 useProjectStore 保持兼容性
 */

import { logger } from '@/core/utils/logger'

/**
 * 项目信息接口
 * 用于存储项目的基本信息和打开时间
 */
export interface ProjectInfo {
  /** 项目名称 */
  name: string
  /** 项目路径 */
  path: string
  /** 最后打开时间戳 */
  lastOpened: number
  /** 创建时间戳（可选） */
  createdAt?: number
}

/**
 * 项目历史存储键名
 */
const STORAGE_KEY = 'recentProjects'

/**
 * 最大最近项目数量
 */
const MAX_RECENT_PROJECTS = 10

/**
 * 项目存储服务类
 * 负责管理项目历史的增删改查和持久化
 */
class ProjectStorageService {
  /**
   * 获取最近项目列表
   * 从 localStorage 读取并返回排序后的项目列表
   *
   * @returns 最近项目信息数组（按最后打开时间倒序）
   */
  public getRecentProjects(): ProjectInfo[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) {
        return []
      }

      const projects = JSON.parse(stored) as ProjectInfo[]

      if (!Array.isArray(projects)) {
        logger.warn('[ProjectStorageService] 数据格式错误，清除存储')
        localStorage.removeItem(STORAGE_KEY)
        return []
      }

      return projects
        .filter((p): p is ProjectInfo => this.isValidProject(p))
        .sort((a, b) => b.lastOpened - a.lastOpened)
    } catch (error) {
      logger.error('[ProjectStorageService] 读取最近项目失败:', error)
      localStorage.removeItem(STORAGE_KEY)
      return []
    }
  }

  /**
   * 添加最近项目
   * 如果项目已存在则更新时间戳，否则添加到列表顶部
   *
   * @param project 项目信息
   */
  public addRecentProject(project: ProjectInfo): void {
    const projects = this.getRecentProjects()

    const existingIndex = projects.findIndex((p) => p.path === project.path)

    if (existingIndex !== -1) {
      const existing = projects[existingIndex]
      if (existing) {
        existing.lastOpened = project.lastOpened
        existing.name = project.name
      }
    } else {
      const newProject: ProjectInfo = {
        name: project.name,
        path: project.path,
        lastOpened: project.lastOpened,
        createdAt: project.createdAt ?? Date.now(),
      }
      projects.unshift(newProject)
    }

    const sortedProjects = projects
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .slice(0, MAX_RECENT_PROJECTS)

    this.saveToStorage(sortedProjects)
  }

  /**
   * 删除最近项目
   * 根据项目路径移除指定项目
   *
   * @param path 项目路径
   */
  public removeRecentProject(path: string): void {
    const projects = this.getRecentProjects()
    const filteredProjects = projects.filter((p) => p.path !== path)
    this.saveToStorage(filteredProjects)
  }

  /**
   * 清除所有最近项目
   * 清空 localStorage 中的项目历史记录
   */
  public clearRecentProjects(): void {
    localStorage.removeItem(STORAGE_KEY)
  }

  /**
   * 根据项目路径获取项目信息
   *
   * @param path 项目路径
   * @returns 项目信息，如果不存在则返回 undefined
   */
  public getProjectByPath(path: string): ProjectInfo | undefined {
    const projects = this.getRecentProjects()
    return projects.find((p) => p.path === path)
  }

  /**
   * 更新项目信息
   *
   * @param path 项目路径
   * @param updates 要更新的字段
   * @returns 是否更新成功
   */
  public updateProject(path: string, updates: Partial<ProjectInfo>): boolean {
    const projects = this.getRecentProjects()
    const index = projects.findIndex((p) => p.path === path)

    if (index === -1) {
      return false
    }

    const existing = projects[index]
    if (!existing) return false
    projects[index] = { ...existing, ...updates }
    this.saveToStorage(projects)
    return true
  }

  /**
   * 验证项目信息是否有效
   *
   * @param project 待验证的对象
   * @returns 是否有效
   */
  private isValidProject(project: unknown): project is ProjectInfo {
    if (!project || typeof project !== 'object') {
      return false
    }

    const p = project as Record<string, unknown>

    return (
      typeof p.name === 'string' &&
      typeof p.path === 'string' &&
      typeof p.lastOpened === 'number' &&
      p.name.trim() !== '' &&
      p.path.trim() !== ''
    )
  }

  /**
   * 保存到 localStorage
   *
   * @param projects 项目列表
   */
  private saveToStorage(projects: ProjectInfo[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
    } catch (error) {
      logger.error('[ProjectStorageService] 保存项目失败:', error)
    }
  }
}

/**
 * 项目存储服务单例
 */
export const projectStorageService = new ProjectStorageService()

/**
 * 便捷函数：获取最近项目
 */
export const getRecentProjects = () => projectStorageService.getRecentProjects()

/**
 * 便捷函数：添加最近项目
 */
export const addRecentProject = (project: ProjectInfo) =>
  projectStorageService.addRecentProject(project)

/**
 * 便捷函数：删除最近项目
 */
export const removeRecentProject = (path: string) => projectStorageService.removeRecentProject(path)

/**
 * 便捷函数：清除所有最近项目
 */
export const clearRecentProjects = () => projectStorageService.clearRecentProjects()
