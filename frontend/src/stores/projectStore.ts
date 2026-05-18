/**
 * @file 项目路径状态管理存储
 * @description 负责管理当前激活项目的路径信息，包括配置文件目录和数据文件目录。
 *              使用 Pinia + Composition API 模式实现状态管理，状态持久化到 localStorage。
 *
 * @核心功能
 * - 存储和管理当前项目的配置文件路径和数据文件路径
 * - 提供项目激活/解除激活的状态查询
 * - 自动将路径信息持久化到浏览器 localStorage，实现页面刷新后状态保持
 *
 * @数据流向
 * - 初始化时从 localStorage 恢复项目路径（如有）
 * - 用户打开项目时调用 setProjectPaths 更新路径
 * - 用户关闭/切换项目时调用 clearProject 清除路径
 *
 * @业务逻辑说明
 * - 项目路径信息用于定位项目的配置文件和数据文件，是数据验证和规则加载的前置条件
 * - isProjectActive 用于判断是否存在已激活的项目，UI 层据此显示项目操作入口
 * - localStorage 键名为 'activeProjectPaths'，存储 JSON 格式的 ProjectPaths 对象
 */
import { logger } from '@/core/utils/logger'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

function isAbsolutePath(input: string): boolean {
  if (!input) return false
  return /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('/')
}

/**
 * @interface ProjectPaths
 * @description 项目路径信息接口，定义项目相关的文件目录结构
 *
 * @property {string} configPath - 项目配置文件(.json)所在的目录绝对路径
 *                                用于加载数据质量规则、验证配置等
 * @property {string} dataPath - 数据文件(CSV/Excel等)所在的目录绝对路径
 *                              用于定位待验证的数据源文件
 */
export interface ProjectPaths {
  configPath: string // 项目配置文件所在目录
  dataPath: string // 数据文件所在目录
}

export const useProjectStore = defineStore('project', () => {
  /**
   * @state currentPaths
   * @description 当前项目的路径信息，null 表示没有激活的项目
   * @type {Ref<ProjectPaths | null>}
   * @副作用 状态变化时会同步写入 localStorage，实现持久化
   */
  // 1. 从 localStorage 读取初始值，如果没有则为 null
  // 【强制绝对路径策略】项目路径必须是绝对路径，相对路径会导致后端无法定位文件
  let initialPaths: ProjectPaths | null = null
  try {
    const storedPaths = localStorage.getItem('activeProjectPaths')
    if (storedPaths) {
      const parsed = JSON.parse(storedPaths)
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.configPath === 'string' &&
        typeof parsed.dataPath === 'string' &&
        isAbsolutePath(parsed.configPath) &&
        isAbsolutePath(parsed.dataPath)
      ) {
        initialPaths = {
          configPath: parsed.configPath,
          dataPath: parsed.dataPath,
        }
      } else {
        logger.warn('[ProjectStore] localStorage 中的项目路径为相对路径或格式无效，已清除:', parsed)
        localStorage.removeItem('activeProjectPaths')
      }
    }
  } catch (e) {
    logger.error('Failed to parse project paths from localStorage:', e)
    localStorage.removeItem('activeProjectPaths')
  }
  const currentPaths = ref<ProjectPaths | null>(initialPaths)

  /**
   * @computed isProjectActive
   * @description 判断当前是否有项目被激活
   *              只有当 currentPaths 不为 null 且 configPath 非空时才认为项目已激活
   *              这样设计是为了兼容部分场景下可能只有 dataPath 的情况
   * @type {ComputedRef<boolean>}
   */
  // 2. 计算属性，方便判断当前是否有项目被激活
  const isProjectActive = computed(
    () => currentPaths.value !== null && currentPaths.value.configPath !== ''
  )

  /**
   * @function setProjectPaths
   * @description 设置/更新当前项目的路径信息
   *              调用此方法表示用户打开了某个项目，需要加载其配置和数据
   * @param {ProjectPaths} newPaths - 新的项目路径对象，包含 configPath 和 dataPath
   * @副作用
   * - 更新 currentPaths 状态
   * - 将新路径同步写入 localStorage，保持刷新后状态一致
   */
  // 3. Action: 用于设置/更新项目路径，并存入 localStorage
  function setProjectPaths(newPaths: ProjectPaths) {
    // 【强制绝对路径策略】拒绝存储相对路径，防止下游模块解析失败
    if (!isAbsolutePath(newPaths.configPath) || !isAbsolutePath(newPaths.dataPath)) {
      logger.error(
        '[ProjectStore] 拒绝设置相对路径为项目路径。configPath:',
        newPaths.configPath,
        'dataPath:',
        newPaths.dataPath
      )
      // 如果 Electron 主进程传了相对路径，说明主进程有 bug，记录错误但不存储
      return
    }
    currentPaths.value = newPaths
    localStorage.setItem('activeProjectPaths', JSON.stringify(newPaths))
  }

  /**
   * @function clearProject
   * @description 清除当前项目路径信息
   *              调用此方法表示用户关闭了当前项目或切换到其他项目
   * @副作用
   * - 将 currentPaths 重置为 null
   * - 清除 localStorage 中存储的项目路径数据
   * - 可能触发依赖此状态的其他组件重新渲染（如关闭项目详情页）
   */
  // 4. Action: 用于清除项目路径（例如，用户想切换项目）
  function clearProject() {
    currentPaths.value = null
    localStorage.removeItem('activeProjectPaths')
  }

  return {
    currentPaths,
    isProjectActive,
    setProjectPaths,
    clearProject,
  }
})
