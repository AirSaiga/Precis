/**
 * @fileoverview Schema Conflict Resolver
 *
 * 将 Schema 保存时的冲突检测逻辑从 store 中独立出来，
 * 使 SaveOrchestrator 也能复用该能力。
 *
 * 冲突检测流程：
 * 1. 调用 checkSchemaConflict 检查后端状态
 * 2. 分析冲突类型（ID 重复 / 配置差异 / 文件已存在）
 * 3. 必要时弹出确认对话框
 * 4. 返回确定的 saveMode 和文件路径
 */

import { logger } from '@/core/utils/logger'
import type { SchemaSaveMode, TableSchemaFileV2 } from '@/types/projectV2'
import { checkSchemaConflict } from '@/api/projectV2Api'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { i18n } from '@/i18n'

export interface ConflictResolution {
  /** 确定的保存模式 */
  saveMode: SchemaSaveMode
  /** 实际文件路径（冲突检测返回的） */
  filePath: string
  /** 是否用户取消 */
  cancelled: boolean
  /** 检测到的冲突信息 */
  conflictInfo?: {
    exists: boolean
    has_conflict: boolean
    file_path: string
    existing_schema?: unknown
  }
}

export interface ResolveConflictOptions {
  schemaId: string
  schemaFile: TableSchemaFileV2
  tableName: string
  configPath: string | undefined
}

/**
 * Schema 冲突解析器
 *
 * 纯逻辑层，不操作 store 状态，只负责：
 * - 检测冲突
 * - 交互确认
 * - 返回保存策略
 */
export class SchemaConflictResolver {
  private t = i18n.global.t
  private showConfirm: ReturnType<typeof useGlobalConfirm>['showConfirm'] | undefined
  private _showConfirmCached: ReturnType<typeof useGlobalConfirm>['showConfirm'] | undefined

  constructor(showConfirm?: ReturnType<typeof useGlobalConfirm>['showConfirm']) {
    this.showConfirm = showConfirm
  }

  private getResolvedShowConfirm(): ReturnType<typeof useGlobalConfirm>['showConfirm'] {
    if (this.showConfirm) return this.showConfirm
    if (!this._showConfirmCached) {
      this._showConfirmCached = useGlobalConfirm().showConfirm
    }
    return this._showConfirmCached
  }

  /**
   * 解析 Schema 保存冲突
   *
   * @returns ConflictResolution，cancelled=true 表示用户取消
   */
  async resolve(options: ResolveConflictOptions): Promise<ConflictResolution> {
    const { schemaId, schemaFile, tableName, configPath } = options

    let saveMode: SchemaSaveMode = 'create'
    let existingFilePath: string | undefined
    let conflictInfo: ConflictResolution['conflictInfo']

    try {
      const info = await checkSchemaConflict(schemaId, schemaFile, configPath)
      conflictInfo = info

      if (info.exists) {
        existingFilePath = info.file_path
        const existingId = info.existing_schema?.id as string | undefined

        if (existingId && existingId !== schemaId) {
          // ID 重复：完全不同的 schema 占用了相同文件路径
          const existingTableName = (info.existing_schema?.name as string) || existingId
          const confirmed = await this.getResolvedShowConfirm()({
            title: this.t('common.confirmDialog.schemaConflict.idDuplicateTitle'),
            message: this.t('common.confirmDialog.schemaConflict.idDuplicateMessage', {
              filePath: info.file_path,
              existingTableName,
              tableName,
            }),
            confirmText: this.t('common.confirmDialog.schemaConflict.overwrite'),
            cancelText: this.t('common.cancel'),
            type: 'warning',
            allowHtml: true,
          })
          if (!confirmed) {
            return { saveMode: 'create', filePath: '', cancelled: true, conflictInfo }
          }
          saveMode = 'overwrite'
        } else if (info.has_conflict) {
          // 配置有差异
          const result = await this.getResolvedShowConfirm()({
            title: this.t('common.confirmDialog.schemaConflict.configDiffTitle'),
            message: this.t('common.confirmDialog.schemaConflict.configDiffMessage', {
              filePath: info.file_path,
              diff: info.conflict_fields.join(', '),
            }),
            confirmText: this.t('common.confirmDialog.schemaConflict.overwrite'),
            alternativeText: this.t('common.confirmDialog.schemaConflict.merge'),
            cancelText: this.t('common.cancel'),
            type: 'warning',
            allowHtml: true,
          })

          if (result === true) saveMode = 'overwrite'
          else if (result === 'alternative') saveMode = 'merge'
          else return { saveMode: 'create', filePath: '', cancelled: true, conflictInfo }
        } else {
          // 文件已存在但无冲突
          const result = await this.getResolvedShowConfirm()({
            title: this.t('common.confirmDialog.schemaConflict.existsTitle'),
            message: this.t('common.confirmDialog.schemaConflict.existsMessage', {
              filePath: info.file_path,
              tableName,
            }),
            confirmText: this.t('common.confirmDialog.schemaConflict.overwrite'),
            alternativeText: this.t('common.confirmDialog.schemaConflict.merge'),
            cancelText: this.t('common.cancel'),
            type: 'warning',
            allowHtml: true,
          })

          if (result === true) saveMode = 'overwrite'
          else if (result === 'alternative') saveMode = 'merge'
          else return { saveMode: 'create', filePath: '', cancelled: true, conflictInfo }
        }
      } else {
        saveMode = 'create'
      }
    } catch (checkError) {
      logger.warn('检查冲突失败，将直接保存:', checkError)
      saveMode = 'create'
    }

    const filePath = existingFilePath || `schemas/${schemaFile.name}.schema.yaml`
    return { saveMode, filePath, cancelled: false, conflictInfo }
  }

  /**
   * 处理保存时的 409 冲突错误
   *
   * 当后端返回 409 时，提示用户选择覆盖或合并
   */
  async handle409Conflict(
    filePath: string,
    tableName: string
  ): Promise<SchemaSaveMode | 'cancelled'> {
    const result = await this.getResolvedShowConfirm()({
      title: this.t('common.confirmDialog.schemaConflict.existsTitle'),
      message: this.t('common.confirmDialog.schemaConflict.existsMessage', {
        filePath,
        tableName,
      }),
      confirmText: this.t('common.confirmDialog.schemaConflict.overwrite'),
      alternativeText: this.t('common.confirmDialog.schemaConflict.merge'),
      cancelText: this.t('common.cancel'),
      type: 'warning',
      allowHtml: true,
    })

    if (result === true) return 'overwrite'
    if (result === 'alternative') return 'merge'
    return 'cancelled'
  }
}
