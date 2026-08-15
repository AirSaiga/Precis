/**
 * @file useProjectReload.ts
 * @description 项目重载/切换守卫——操作前处理画布上的草稿节点
 *
 * 行为契约：
 * - 无草稿节点：直接放行（与既有行为一致）
 * - 有草稿节点：三选一确认（文案按场景区分"重载"与"切换项目"）
 *   - 保存后继续：先 saveProject() 持久化草稿；保存失败则中止（错误提示由
 *     保存流程自行 toast），用户可修复后再次操作
 *   - 丢弃并继续：
 *     - 重载（reloadProject）：画布恢复为 manifest 状态，并把重载后的画布快照
 *       写回当前工作区并同步磁盘——否则切回工作区 Tab 时旧快照（含草稿）会整体
 *       盖回画布（canvasTabStore.setActiveTab 的全量恢复语义）
 *     - 切换项目（ProjectManagementModal）：画布与工作区被新项目状态替换；
 *       旧项目的工作区快照保留草稿（回到旧项目时仍在），不额外清理
 *   - 取消：不做任何事
 */

import { useGraphStore } from '@/stores/graphStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import i18n from '@/i18n'
import { eventBus } from '@/core/eventBus'
import { logger } from '@/core/utils/logger'

/** 判定"草稿节点"：data.saveState === 'draft'（schema/jsonSchema/transform/
 * manualData/template 展开子节点等持久化类型均有该字段，统一以它为准） */
export function findDraftNodes(nodes: { id: string; type?: string; data?: unknown }[]) {
  return nodes.filter((n) => {
    const data = (n.data || {}) as { saveState?: string }
    return data.saveState === 'draft'
  })
}

function draftNodeLabel(node: { id: string; data?: unknown }): string {
  const data = (node.data || {}) as Record<string, unknown>
  const label =
    (data.configName as string) ||
    (data.tableName as string) ||
    (data.columnName as string) ||
    (data.name as string) ||
    ''
  return typeof label === 'string' && label ? label : node.id
}

export function useProjectReload() {
  const graphStore = useGraphStore()
  const canvasStore = useCanvasStore()
  const { showConfirm } = useGlobalConfirm()
  // 本组合式函数会在事件处理器上下文被调用（ProjectManagementModal.loadProject、
  // ActionButtonRenderer.handleReload），此时 getCurrentInstance() 为 null，
  // useI18n() 会抛 MUST_BE_CALL_SETUP_TOP——必须用全局实例（同 useGlobalConfirm）
  const { t } = i18n.global

  /**
   * 草稿守卫：在重载/切换项目前处理画布草稿节点
   * @param mode 文案场景：'reload' 重载当前项目 / 'load' 切换项目
   * @returns 'proceed' 可继续；'cancelled' 用户取消或保存失败
   */
  async function confirmDraftsBeforeLoad(
    mode: 'reload' | 'load' = 'reload'
  ): Promise<'proceed' | 'cancelled'> {
    const drafts = findDraftNodes(graphStore.nodes)
    if (drafts.length === 0) return 'proceed'

    const i18nKeys =
      mode === 'load'
        ? {
            title: 'common.projectReload.loadTitle',
            message: 'common.projectReload.loadMessage',
            confirm: 'common.projectReload.saveAndLoad',
            alternative: 'common.projectReload.discardAndLoad',
          }
        : {
            title: 'common.projectReload.draftTitle',
            message: 'common.projectReload.draftMessage',
            confirm: 'common.projectReload.saveAndReload',
            alternative: 'common.projectReload.discardAndReload',
          }
    const names = drafts.slice(0, 5).map(draftNodeLabel).join('、')
    const more = drafts.length > 5 ? ` 等 ${drafts.length} 个` : ''
    const choice = await showConfirm({
      title: t(i18nKeys.title),
      message: t(i18nKeys.message, { count: drafts.length, names: names + more }),
      confirmText: t(i18nKeys.confirm),
      alternativeText: t(i18nKeys.alternative),
      cancelText: t('common.projectReload.cancel'),
      type: 'warning',
    })

    if (choice === false) {
      // 取消（含关闭弹窗）
      return 'cancelled'
    }

    if (choice === true) {
      // 保存后继续：保存失败则中止（错误 toast 由保存流程展示）
      const saved = await graphStore.saveProject()
      if (!saved) {
        logger.warn('[useProjectReload] 草稿保存失败，中止操作')
        return 'cancelled'
      }
    }
    // choice === 'alternative'（丢弃）或已保存成功 → 放行
    return 'proceed'
  }

  /**
   * 执行重载（带草稿守卫）
   * @returns 是否真正执行了重载（取消/保存失败返回 false）
   */
  async function reloadProject(): Promise<boolean> {
    if ((await confirmDraftsBeforeLoad('reload')) === 'cancelled') {
      return false
    }

    const ok = await graphStore.loadProjectFromV2()

    // 重载成功后把重载结果写回当前工作区快照并同步磁盘：
    // 丢弃分支需要冲掉旧快照中的草稿节点；保存分支快照内容与画布一致，回写无害且保持一致
    if (ok) {
      canvasStore.saveCurrentCanvasData(graphStore.nodes, graphStore.edges)
      canvasStore.syncWorkspacesToBackend()
      eventBus.emit('project-applied')
    }
    return ok
  }

  return { reloadProject, confirmDraftsBeforeLoad, findDraftNodes }
}
