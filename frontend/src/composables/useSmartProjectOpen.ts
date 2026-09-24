/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview 打开项目智能化：探测目标目录是否为 Precis 项目，缺 manifest 时引导就地新建
 *
 * 背景：「打开项目」强校验 project.precis.yaml（后端 404），新用户指向空目录
 * 只能得到报错死胡同。本组合式函数把"打开"变聪明——先探测目录，缺清单时
 * 弹确认框引导就地新建，让一个按钮覆盖"打开已有 / 就地新建"两种意图。
 *
 * 新建统一走后端 POST /projects/create 落盘脚手架（Electron/Web 同路径）。
 * 不用 Electron 内存新建：磁盘暂无 manifest 会让打开后的所有项目级 GET 404，
 * 且误触发 httpClient 的「项目路径失效」自愈清理（清 localStorage + 拆根节点），
 * 与打开流程互相打架。
 *
 * 供设置面板（ProjectInfoPanel）与项目管理弹窗（ProjectManagementModal）共用。
 */
import { isAxiosError } from 'axios'
import { useI18n } from 'vue-i18n'
import { checkProject, createProject } from '@/api/projectApi'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { getApiErrorMessage } from '@/core/services/apiErrors'
import { toastError } from '@/core/toast'
import { logger } from '@/core/utils/logger'

/**
 * 智能打开结果，调用方据此选择后续接线：
 * - 'exists'    目录已是有效项目（manifest 可读），继续常规加载流程
 * - 'created'   后端脚手架已落盘（含 manifest），继续常规加载流程（loadProjectFromV2 可成功）
 * - 'cancelled' 用户在确认框取消，调用方应原样停留（本函数无副作用）
 * - 'error'     探测或新建失败（已 toast 错误），调用方应原样停留
 */
export type SmartOpenOutcome = 'exists' | 'created' | 'cancelled' | 'error'

/** 路径末段目录名作为项目名兜底（兼容 Windows 与 Unix 分隔符） */
export function deriveProjectName(projectPath: string): string {
  const raw = (projectPath || '').replace(/[\\/]+$/, '')
  const idx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  const name = idx >= 0 ? raw.slice(idx + 1) : raw
  return name || 'Project'
}

export function useSmartProjectOpen() {
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()

  /**
   * 探测目录并按需引导新建。
   *
   * 副作用：仅在用户确认后才产生——调后端 createProject 在目标目录落盘
   * 项目脚手架（manifest + schemas/ 等标准子目录）。取消/出错时零副作用，
   * 调用方无需回滚。
   */
  async function probeAndMaybeCreate(
    configPath: string,
    projectName: string
  ): Promise<SmartOpenOutcome> {
    // Step 1: 探测目录（GET /projects/check，永不 404——浏览器控制台无红字）。
    // manifest 损坏（422）不在此拦截：探测只判项目根，损坏交给常规加载链路透出修复指引
    let isProject: boolean
    try {
      isProject = (await checkProject(configPath)).is_project
    } catch (e) {
      logger.warn('[useSmartProjectOpen] 探测项目目录失败:', e)
      toastError(getApiErrorMessage(e, t('projectManagement.loadFailed')))
      return 'error'
    }
    if (isProject) {
      return 'exists'
    }

    // Step 2: 缺 manifest → 确认就地新建
    const confirmed = await showConfirm({
      title: t('projectManagement.smartCreate.title'),
      message: t('projectManagement.smartCreate.message', { path: configPath, name: projectName }),
      confirmText: t('projectManagement.smartCreate.confirm'),
      cancelText: t('projectManagement.smartCreate.cancel'),
      type: 'info',
    })
    if (!confirmed) return 'cancelled'

    // Step 3: 后端落盘脚手架（Electron/Web 统一，本地后端始终在跑）。
    // 400 = manifest 已存在（确认期间目录被外部建成项目）→ 退化为加载既有项目
    try {
      await createProject(configPath, projectName)
      return 'created'
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 400) {
        return 'exists'
      }
      logger.warn('[useSmartProjectOpen] 新建项目失败:', e)
      toastError(getApiErrorMessage(e, t('projectManagement.loadFailed')))
      return 'error'
    }
  }

  return { probeAndMaybeCreate }
}
