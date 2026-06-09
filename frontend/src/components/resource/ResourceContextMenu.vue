<!--
  @file ResourceContextMenu.vue
  @description 资源右键上下文菜单

  在资源浏览器中右键点击资源项时显示的上下文菜单。
  支持的操作包括：导入到画布、预览、删除、重命名等。

  同时提供资源预览模态框，用于快速查看资源内容。
-->

<template>
  <Teleport to="body">
    <div v-if="contextMenu.visible" class="resource-context-overlay" @click="handleOverlayClick">
      <div
        class="resource-context-menu"
        :style="{ left: contextMenu.position.x + 'px', top: contextMenu.position.y + 'px' }"
        @click.stop
      >
        <template v-for="(action, index) in contextMenu.availableActions" :key="index">
          <div v-if="action.type === 'separator'" class="resource-context-sep"></div>
          <button
            v-else
            class="resource-context-item"
            :class="{ danger: action.isDanger }"
            type="button"
            @click="handleContextAction(action.type)"
          >
            {{ t(action.labelKey) }}
          </button>
        </template>
      </div>
    </div>

    <div v-if="previewModal.visible" class="modal-overlay" @click="closePreviewModal">
      <div class="modal-content preview-modal" @click.stop>
        <div class="modal-header">
          <h3>{{ previewModal.title }}</h3>
          <button class="close-btn" type="button" @click="closePreviewModal">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <Codemirror
            :model-value="previewModal.content"
            :read-only="true"
            :autofocus="false"
            :indent-with-tab="false"
            :tab-size="2"
            :extensions="extensions"
          />
        </div>
      </div>
    </div>

    <div v-if="renameDialog.visible" class="modal-overlay" @click.self="closeRenameDialog">
      <div class="modal-content rename-modal">
        <div class="modal-header">
          <h3>{{ t('assetLibraryExtended.projectView.resourceContext.renameTitle') }}</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('assetLibraryExtended.projectView.resourceContext.renameLabel') }}:</label>
            <input
              v-model="renameDialog.inputValue"
              type="text"
              @keydown.enter="submitRename"
              @keydown.escape="closeRenameDialog"
            />
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" @click="closeRenameDialog">
            {{ t('common.cancel') }}
          </button>
          <button
            class="btn-primary"
            type="button"
            :disabled="!renameDialog.inputValue.trim()"
            @click="submitRename"
          >
            {{ t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  /**
   * @file ResourceContextMenu.vue
   * @description 资源右键菜单组件
   *
   * 功能职责：
   * - 提供资源条目的右键菜单操作
   * - 支持预览、添加到画布、定位、重命名、删除、刷新等操作
   * - 使用 Teleport 渲染到 body，避免 z-index 冲突
   *
   * 事件监听：
   * - open-resource-context-menu: 打开右键菜单
   */

  import { useI18n } from 'vue-i18n'
  import { Codemirror } from 'vue-codemirror'
  import { yaml } from '@codemirror/lang-yaml'
  import yamlJs from 'js-yaml'
  import { reactive, onMounted, onUnmounted } from 'vue'
  import type { ResourceItem, ContextMenuAction } from '@/types/resource'
  import { resourceService } from '@/services/resourceService'
  import { useProjectStore } from '@/stores/projectStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useToast } from '@/composables/shared'
  import { eventBus } from '@/core/eventBus'
  import { updateV2ManifestSchemaRef } from '@/api/projectV2Api/manifest'

  const { t } = useI18n()
  const { error } = useToast()
  const projectStore = useProjectStore()
  const graphStore = useGraphStore()
  const treeStore = useResourceTreeStore()
  const { showConfirm } = useGlobalConfirm()

  const extensions = [yaml()]

  /**
   * 右键菜单状态
   */
  const contextMenu = reactive<{
    visible: boolean
    position: { x: number; y: number }
    resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template' | null
    resourceItem: ResourceItem | null
    availableActions: ContextMenuAction[]
  }>({
    visible: false,
    position: { x: 0, y: 0 },
    resourceKind: null,
    resourceItem: null,
    availableActions: [],
  })

  /**
   * 菜单操作配置
   */
  const addToManifestAction: ContextMenuAction = {
    type: 'addToManifest',
    labelKey: 'assetLibraryExtended.projectView.resourceContext.addToManifest',
  }

  function buildBaseContextMenuActions(item: ResourceItem): ContextMenuAction[] {
    const isUnlisted = item.meta?.listedInManifest === false
    const actions: ContextMenuAction[] = [
      { type: 'preview', labelKey: 'assetLibraryExtended.projectView.resourceContext.preview' },
      {
        type: 'addToCanvas',
        labelKey: 'assetLibraryExtended.projectView.resourceContext.addToCanvas',
      },
      {
        type: 'locateOnCanvas',
        labelKey: 'assetLibraryExtended.projectView.resourceContext.locateOnCanvas',
      },
    ]
    if (isUnlisted) {
      actions.push(addToManifestAction)
    }
    actions.push(
      { type: 'separator', labelKey: '' },
      { type: 'rename', labelKey: 'assetLibraryExtended.projectView.resourceContext.rename' },
      {
        type: 'delete',
        labelKey: 'assetLibraryExtended.projectView.resourceContext.delete',
        isDanger: true,
      },
      { type: 'separator', labelKey: '' },
      { type: 'refresh', labelKey: 'assetLibraryExtended.projectView.resourceContext.refresh' },
    )
    return actions
  }

  const templateContextMenuActions: ContextMenuAction[] = [
    { type: 'preview', labelKey: 'assetLibraryExtended.projectView.resourceContext.preview' },
    {
      type: 'addToCanvas',
      labelKey: 'assetLibraryExtended.projectView.resourceContext.addToCanvas',
    },
    { type: 'separator', labelKey: '' },
    {
      type: 'delete',
      labelKey: 'assetLibraryExtended.projectView.resourceContext.delete',
      isDanger: true,
    },
    { type: 'separator', labelKey: '' },
    { type: 'refresh', labelKey: 'assetLibraryExtended.projectView.resourceContext.refresh' },
  ]

  /**
   * 预览模态框状态
   */
  const previewModal = reactive<{
    visible: boolean
    title: string
    content: string
  }>({
    visible: false,
    title: '',
    content: '',
  })

  /**
   * 重命名对话框状态
   */
  const renameDialog = reactive<{
    visible: boolean
    resourceId: string
    resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template' | null
    currentName: string
    inputValue: string
  }>({
    visible: false,
    resourceId: '',
    resourceKind: null,
    currentName: '',
    inputValue: '',
  })

  /**
   * 处理打开右键菜单事件
   */
  const handleOpenResourceContextMenu = (payload: {
    visible: boolean
    position: { x: number; y: number }
    kind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template'
    item: ResourceItem
  }): void => {
    const { position, kind, item } = payload
    contextMenu.visible = true
    contextMenu.position = position
    contextMenu.resourceKind = kind
    contextMenu.resourceItem = item
    contextMenu.availableActions =
      kind === 'template' ? templateContextMenuActions : buildBaseContextMenuActions(item)
  }

  /**
   * 处理菜单操作点击
   */
  const handleContextAction = (actionType: string): void => {
    switch (actionType) {
      case 'preview':
        handlePreviewAction()
        break
      case 'addToCanvas':
        handleAddToCanvasAction()
        break
      case 'locateOnCanvas':
        handleLocateOnCanvasAction()
        break
      case 'rename':
        handleRenameAction()
        break
      case 'delete':
        handleDeleteAction()
        break
      case 'refresh':
        handleRefreshAction()
        break
      case 'addToManifest':
        handleAddToManifestAction()
        break
      default:
        break
    }
  }

  /**
   * 处理遮罩层点击
   */
  const handleOverlayClick = (): void => {
    contextMenu.visible = false
  }

  /**
   * 关闭预览模态框
   */
  const closePreviewModal = (): void => {
    previewModal.visible = false
    previewModal.title = ''
    previewModal.content = ''
  }

  /**
   * 关闭重命名对话框
   */
  const closeRenameDialog = (): void => {
    renameDialog.visible = false
  }

  /**
   * 处理键盘事件
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      contextMenu.visible = false
      previewModal.visible = false
      renameDialog.visible = false
    }
  }

  /**
   * 处理点击外部关闭
   */
  const handleClickOutside = (event: MouseEvent): void => {
    const target = event.target as HTMLElement
    if (!target.closest('.resource-context-menu')) {
      contextMenu.visible = false
    }
  }

  /**
   * 处理预览操作
   */
  const handlePreviewAction = async (): Promise<void> => {
    const kind = contextMenu.resourceKind
    const resource = contextMenu.resourceItem
    contextMenu.visible = false

    if (!kind || !resource) return

    try {
      const path = projectStore.currentPaths?.configPath
      if (!path) {
        logger.warn('[ResourceContextMenu] 未设置项目路径')
        return
      }

      logger.debug('[ResourceContextMenu] 预览资源:', { kind, id: resource.id, path })

      const data = await resourceService.previewResource(kind, resource.id, path)

      logger.debug('[ResourceContextMenu] 预览数据:', data)

      if (data) {
        previewModal.title = `${t('assetLibraryExtended.projectView.resourceContext.preview')}: ${resource.name}`
        previewModal.content = yamlJs.dump(data)
        previewModal.visible = true
      } else {
        previewModal.title = `${t('assetLibraryExtended.projectView.resourceContext.preview')}: ${resource.name}`
        previewModal.content = `# ${resource.name}\n\nNo data available`
        previewModal.visible = true
      }
    } catch (err) {
      logger.error('[ResourceContextMenu] 预览失败:', err)
      error(err instanceof Error ? err.message : String(err), t('common.error'))
    }
  }

  /**
   * 处理添加到画布操作
   */
  const handleAddToCanvasAction = async (): Promise<void> => {
    const resource = contextMenu.resourceItem
    contextMenu.visible = false

    if (!resource) return

    // 模板类型：创建模板实例节点
    if (resource.kind === 'template') {
      const position = { x: 300, y: 200 }
      graphStore.createTemplateInstanceNode(position, resource.id, resource.name)
      return
    }

    const kind = resource.kind as 'schema' | 'pattern' | 'constraint' | 'regex_node'
    const position = { x: 240, y: 120 }
    await graphStore.importV2ResourceToCanvas(kind, resource.id, position, {
      includeDeps: true,
      moveIfExists: true,
    })
  }

  /**
   * 处理定位到画布操作
   */
  const handleLocateOnCanvasAction = async (): Promise<void> => {
    const resource = contextMenu.resourceItem
    contextMenu.visible = false

    if (!resource) return

    // 模板类型：创建模板实例节点
    if (resource.kind === 'template') {
      const position = { x: 300, y: 200 }
      graphStore.createTemplateInstanceNode(position, resource.id, resource.name)
      return
    }

    const existingNode = graphStore.nodes.find((n) => n.id === resource.id)
    if (existingNode) {
      graphStore.setSelectedNode(existingNode.id)
      return
    }

    const kind = resource.kind as 'schema' | 'pattern' | 'constraint' | 'regex_node'
    const position = { x: 240, y: 120 }
    await graphStore.importV2ResourceToCanvas(kind, resource.id, position, {
      includeDeps: true,
      moveIfExists: true,
    })
  }

  /**
   * 处理重命名操作
   */
  const handleRenameAction = (): void => {
    contextMenu.visible = false
    renameDialog.visible = true
    renameDialog.resourceId = contextMenu.resourceItem?.id || ''
    renameDialog.resourceKind = contextMenu.resourceKind
    renameDialog.currentName = contextMenu.resourceItem?.name || ''
    renameDialog.inputValue = contextMenu.resourceItem?.name || ''
  }

  /**
   * 处理删除操作
   */
  const handleDeleteAction = async (): Promise<void> => {
    const kind = contextMenu.resourceKind
    const resource = contextMenu.resourceItem
    contextMenu.visible = false

    if (!kind || !resource) return

    const ok = await showConfirm({
      title: t('common.confirmDialog.title'),
      message: t('assetLibraryExtended.projectView.resourceContext.deleteConfirm', {
        name: resource.name || resource.id,
      }),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      type: 'warning',
    })

    if (!ok) return

    const path = projectStore.currentPaths?.configPath
    if (!path) return

    try {
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
        case 'template':
          await graphStore.deleteV2Template(resource.id, path)
          break
      }

      const node = graphStore.nodes.find((n) => n.id === resource.id)
      if (node) {
        graphStore.deleteNode(node.id)
      }

      await treeStore.refreshResources()
    } catch (err) {
      logger.error('[ResourceContextMenu] 删除失败:', err)
      error(
        err instanceof Error ? err.message : t('common.unknownError'),
        t('assetLibraryExtended.projectView.resourceContext.deleteFailedTitle')
      )
    }
  }

  /**
   * 处理刷新操作
   */
  const handleRefreshAction = async (): Promise<void> => {
    contextMenu.visible = false
    await treeStore.refreshResources()
  }

  /**
   * 处理加入清单操作
   */
  const handleAddToManifestAction = async (): Promise<void> => {
    const item = contextMenu.resourceItem
    const configPath = projectStore.currentPaths?.configPath
    if (!item || !configPath) return

    contextMenu.visible = false

    try {
      await updateV2ManifestSchemaRef(
        { id: item.id, path: item.path || `schemas/${item.id}.schema.yaml` },
        configPath
      )
      await treeStore.refreshResources()
      eventBus.emit('project-applied')
    } catch (err) {
      logger.error('[ResourceContextMenu] 加入清单失败:', err)
      error(
        err instanceof Error ? err.message : t('common.unknownError'),
        t('assetLibraryExtended.projectView.resourceContext.addToManifestFailedTitle')
      )
    }
  }

  /**
   * 提交重命名
   */
  const submitRename = async (): Promise<void> => {
    const { resourceId, resourceKind, inputValue } = renameDialog
    const path = projectStore.currentPaths?.configPath

    if (!resourceKind || !path) return

    const name = inputValue.trim()
    if (!name) {
      error(
        t('assetLibraryExtended.projectView.resourceContext.renameEmptyError'),
        t('assetLibraryExtended.projectView.resourceContext.renameFailedTitle')
      )
      return
    }

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
      }

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

      await treeStore.refreshResources()
      renameDialog.visible = false
    } catch (err) {
      logger.error('[ResourceContextMenu] 重命名失败:', err)
      error(
        err instanceof Error ? err.message : t('common.unknownError'),
        t('assetLibraryExtended.projectView.resourceContext.renameFailedTitle')
      )
    }
  }

  /**
   * 组件挂载时添加事件监听
   */
  onMounted(() => {
    eventBus.on('open-resource-context-menu', handleOpenResourceContextMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('click', handleClickOutside)
  })

  /**
   * 组件卸载时移除事件监听
   */
  onUnmounted(() => {
    eventBus.off('open-resource-context-menu', handleOpenResourceContextMenu)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('click', handleClickOutside)
  })
</script>

<style scoped src="./ResourceContextMenu.styles.css" />
