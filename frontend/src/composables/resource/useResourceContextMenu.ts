/**
 * @file useResourceContextMenu.ts
 * @description 资源右键菜单组合式函数
 *
 * 功能职责：
 * - 提供右键菜单的状态管理
 * - 封装右键菜单的交互逻辑
 * - 与ResourceTreeStore和resourceService配合使用
 */

import { logger } from '@/core/utils/logger'
import { reactive, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import yaml from 'js-yaml'
import { useResourceTreeStore } from '@/stores/resourceTreeStore'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useToast } from '@/composables/shared'
import { resourceService } from '@/services/resourceService'
import type {
  ResourceItem,
  ResourceContextMenuState,
  RenameDialogState,
  PreviewModalState,
  ContextMenuAction,
  RenameValidationResult,
} from '@/types/resource'
export function useResourceContextMenu() {
  const { t } = useI18n()

  // Stores
  const treeStore = useResourceTreeStore()
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()
  const { showConfirm } = useGlobalConfirm()
  const { error } = useToast()

  // === 右键菜单状态 ===

  const contextMenu = reactive<ResourceContextMenuState>({
    visible: false,
    position: { x: 0, y: 0 },
    resourceKind: null,
    resourceItem: null,
    availableActions: [],
  })

  /**
   * 右键菜单可用操作
   */
  const contextMenuActions: ContextMenuAction[] = [
    { type: 'preview', labelKey: 'assetLibraryExtended.projectView.resourceContext.preview' },
    {
      type: 'addToCanvas',
      labelKey: 'assetLibraryExtended.projectView.resourceContext.addToCanvas',
    },
    {
      type: 'locateOnCanvas',
      labelKey: 'assetLibraryExtended.projectView.resourceContext.locateOnCanvas',
    },
    { type: 'separator', labelKey: '' },
    { type: 'rename', labelKey: 'assetLibraryExtended.projectView.resourceContext.rename' },
    {
      type: 'delete',
      labelKey: 'assetLibraryExtended.projectView.resourceContext.delete',
      isDanger: true,
    },
    { type: 'separator', labelKey: '' },
    { type: 'refresh', labelKey: 'assetLibraryExtended.projectView.resourceContext.refresh' },
  ]

  /**
   * 获取资源可用的操作列表
   */
  const getAvailableActions = (resourceKind: string | null): ContextMenuAction[] => {
    if (!resourceKind) return []

    return contextMenuActions.filter((action) => {
      // 某些操作可能对特定资源类型不可用
      return true // 目前所有操作对所有资源类型都可用
    })
  }

  /**
   * 打开右键菜单
   */
  const openContextMenu = (
    event: MouseEvent,
    resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node',
    resource: ResourceItem
  ): void => {
    contextMenu.visible = true
    contextMenu.position = { x: event.clientX, y: event.clientY }
    contextMenu.resourceKind = resourceKind
    contextMenu.resourceItem = resource
    contextMenu.availableActions = getAvailableActions(resourceKind)
  }

  /**
   * 关闭右键菜单
   */
  const closeContextMenu = (): void => {
    contextMenu.visible = false
    contextMenu.resourceKind = null
    contextMenu.resourceItem = null
  }

  // === 预览模态框状态 ===

  const previewModal = reactive<PreviewModalState>({
    visible: false,
    title: '',
    content: '',
  })

  /**
   * 打开预览模态框
   */
  const openPreviewModal = (title: string, content: string): void => {
    previewModal.visible = true
    previewModal.title = title
    previewModal.content = content
  }

  /**
   * 关闭预览模态框
   */
  const closePreviewModal = (): void => {
    previewModal.visible = false
    previewModal.title = ''
    previewModal.content = ''
  }

  // === 重命名对话框状态 ===

  const renameDialog = reactive<RenameDialogState>({
    visible: false,
    resourceId: '',
    resourceKind: null,
    currentName: '',
    inputValue: '',
  })

  /**
   * 打开重命名对话框
   */
  const openRenameDialog = (resource: ResourceItem): void => {
    renameDialog.visible = true
    renameDialog.resourceId = resource.id
    renameDialog.resourceKind = resource.kind as 'schema' | 'pattern' | 'constraint'
    renameDialog.currentName = resource.name
    renameDialog.inputValue = resource.name
  }

  /**
   * 关闭重命名对话框
   */
  const closeRenameDialog = (): void => {
    renameDialog.visible = false
    renameDialog.resourceId = ''
    renameDialog.resourceKind = null
    renameDialog.currentName = ''
    renameDialog.inputValue = ''
  }

  /**
   * 验证重命名输入
   */
  const validateRenameInput = (input: string): RenameValidationResult => {
    const trimmed = input.trim()
    if (!trimmed) {
      return {
        valid: false,
        message: t('assetLibraryExtended.projectView.resourceContext.renameEmptyError'),
      }
    }
    if (trimmed.length > 100) {
      return {
        valid: false,
        message: t('assetLibraryExtended.projectView.resourceContext.renameTooLongError'),
      }
    }
    return { valid: true, sanitizedName: trimmed }
  }

  // === 操作处理 ===

  /**
   * 预览资源
   */
  const handleActionPreview = async (): Promise<void> => {
    const kind = contextMenu.resourceKind
    const resource = contextMenu.resourceItem as ResourceItem
    closeContextMenu()

    if (!kind || !resource) return

    try {
      const path = projectStore.currentPaths?.configPath
      if (!path) return

      const data = await resourceService.previewResource(kind, resource.id, path)

      if (data) {
        openPreviewModal(
          `${t('assetLibraryExtended.projectView.resourceContext.preview')}: ${resource.name}`,
          yaml.dump(data)
        )
      }
    } catch (err) {
      logger.error('[useResourceContextMenu] 预览失败:', err)
      error(err instanceof Error ? err.message : String(err), t('common.error'))
    }
  }

  /**
   * 添加到画布
   */
  const handleActionAddToCanvas = async (): Promise<void> => {
    const resource = contextMenu.resourceItem as ResourceItem
    closeContextMenu()

    if (!resource) return

    const position = { x: 240, y: 120 }
    // B30 修复：补齐 regex_node 类型，过去被窄化为 schema/pattern/constraint 导致添加到画布失效
    const kind = resource.kind as 'schema' | 'pattern' | 'constraint' | 'regex_node'
    await graphStore.importV2ResourceToCanvas(kind, resource.id, position, {
      includeDeps: true,
      moveIfExists: true,
    })
  }

  /**
   * 定位到画布
   */
  const handleActionLocateOnCanvas = async (): Promise<void> => {
    const resource = contextMenu.resourceItem as ResourceItem
    closeContextMenu()

    if (!resource) return

    // 检查是否已在画布上
    const existingNode = graphStore.nodes.find((n) => n.id === resource.id)
    if (existingNode) {
      graphStore.setSelectedNode(existingNode.id)
      return
    }

    // 不在画布上，则加载
    const position = { x: 240, y: 120 }
    const kind = resource.kind as 'schema' | 'pattern' | 'constraint' | 'regex_node'
    await graphStore.importV2ResourceToCanvas(kind, resource.id, position, {
      includeDeps: true,
      moveIfExists: true,
    })
  }

  /**
   * 重命名
   */
  const handleActionRename = (): void => {
    const resource = contextMenu.resourceItem as ResourceItem
    closeContextMenu()

    if (!resource) return

    openRenameDialog(resource)
  }

  /**
   * 删除资源
   */
  const handleActionDelete = async (): Promise<void> => {
    const kind = contextMenu.resourceKind
    const resource = contextMenu.resourceItem as ResourceItem
    closeContextMenu()

    if (!kind || !resource) return

    // 确认删除
    const ok = await showConfirm({
      title: t('common.confirmDialog.title'),
      message: t('assetLibraryExtended.projectView.resourceContext.deleteConfirm', {
        name: resource.name || resource.id,
      }),
      type: 'warning',
    })

    if (!ok) return

    const path = projectStore.currentPaths?.configPath
    if (!path) return

    try {
      // 删除资源
      switch (kind) {
        case 'schema':
          await resourceService.deleteSchema(resource.id, path)
          break
        case 'pattern':
          await resourceService.deletePattern(resource.id, path)
          break
        case 'constraint':
          await resourceService.deleteConstraint(resource.id, path)
          break
        // B30 修复：regex_node 右键删除过去静默 no-op，补齐调用 deleteRegexNode
        case 'regex_node':
          await resourceService.deleteRegexNode(resource.id, path)
          break
      }

      // 从画布移除节点
      const node = graphStore.nodes.find((n) => n.id === resource.id)
      if (node) {
        graphStore.deleteNode(node.id)
      }

      // 刷新资源树
      await treeStore.refreshResources()
    } catch (err) {
      logger.error('[useResourceContextMenu] 删除失败:', err)
      error(
        err instanceof Error ? err.message : t('common.unknownError'),
        t('assetLibraryExtended.projectView.resourceContext.deleteFailedTitle')
      )
    }
  }

  /**
   * 刷新资源树
   */
  const handleActionRefresh = async (): Promise<void> => {
    closeContextMenu()
    await treeStore.refreshResources()
  }

  /**
   * 提交重命名
   */
  const submitRename = async (): Promise<void> => {
    const { resourceId, resourceKind, inputValue } = renameDialog
    const path = projectStore.currentPaths?.configPath

    if (!resourceKind || !path) return

    const validation = validateRenameInput(inputValue)
    if (!validation.valid) {
      error(
        validation.message || '',
        t('assetLibraryExtended.projectView.resourceContext.renameFailedTitle')
      )
      return
    }

    const name = validation.sanitizedName || inputValue.trim()

    try {
      switch (resourceKind) {
        case 'schema':
          await resourceService.renameSchema(resourceId, name, path)
          break
        case 'pattern':
          await resourceService.renamePattern(resourceId, name, path)
          break
        case 'constraint':
          await resourceService.renameConstraint(resourceId, name, path)
          break
        // B30：regex_node 暂不支持重命名（后端无 renameRegexNode API），
        // 显式提示而非静默 no-op
        case 'regex_node':
          error(
            t('assetLibraryExtended.projectView.resourceContext.renameFailedTitle'),
            '正则节点暂不支持重命名'
          )
          return
      }

      // 更新画布节点
      const node = graphStore.nodes.find((n) => n.id === resourceId)
      if (node) {
        if (resourceKind === 'schema') {
          graphStore.updateNodeData(node.id, {
            ...(node.data as Record<string, unknown>),
            tableName: name,
            configName: `Schema_${name}`,
            saveState: 'draft',
          })
        } else {
          graphStore.updateNodeData(node.id, {
            ...(node.data as Record<string, unknown>),
            configName: name,
            saveState: 'draft',
          })
        }
      }

      // 刷新资源树
      await treeStore.refreshResources()
      closeRenameDialog()
    } catch (err) {
      logger.error('[useResourceContextMenu] 重命名失败:', err)
      error(
        err instanceof Error ? err.message : t('common.unknownError'),
        t('assetLibraryExtended.projectView.resourceContext.renameFailedTitle')
      )
    }
  }

  // === 键盘事件处理 ===

  /**
   * 处理键盘事件
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    // ESC 关闭菜单
    if (event.key === 'Escape') {
      closeContextMenu()
      closePreviewModal()
      closeRenameDialog()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })

  // === 点击外部关闭 ===

  /**
   * 点击外部处理
   */
  const handleClickOutside = (event: MouseEvent): void => {
    const target = event.target as HTMLElement
    if (!target.closest('.resource-context-menu')) {
      closeContextMenu()
    }
  }

  onMounted(() => {
    document.addEventListener('click', handleClickOutside)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
  })

  // === 暴露接口 ===

  return {
    // 右键菜单状态
    contextMenu,

    // 预览模态框状态
    previewModal,

    // 重命名对话框状态
    renameDialog,

    // 右键菜单操作
    openContextMenu,
    closeContextMenu,

    // 预览模态框操作
    openPreviewModal,
    closePreviewModal,

    // 重命名对话框操作
    openRenameDialog,
    closeRenameDialog,
    validateRenameInput,
    submitRename,

    // 操作处理
    handleActionPreview,
    handleActionAddToCanvas,
    handleActionLocateOnCanvas,
    handleActionRename,
    handleActionDelete,
    handleActionRefresh,
  }
}
