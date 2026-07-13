<!--
  @file CanvasContextMenu.vue
  @description 画布节点右键上下文菜单组件

  在画布节点上右键点击时显示的上下文菜单。
  支持的操作：添加到 AI Chat、保存为模板（仅 eligible 类型）。

  架构：Teleport to body + v-if 控制显示 + overlay 外部点击关闭。
  状态由 useCanvasContextMenu composable 驱动（响应式 menuState）。
  复用全局 .canvas-context-menu / .context-menu-item CSS（定义在 ui.css）。
-->

<template>
  <Teleport to="body">
    <div v-if="menuState.visible" class="canvas-context-overlay" @click="controller.close()">
      <div
        class="canvas-context-menu"
        :style="{ left: menuState.position.x + 'px', top: menuState.position.y + 'px' }"
        @click.stop
      >
        <button class="context-menu-item" type="button" @click="addToChat">
          ✨ {{ t('aiChat.addToChat') }}
        </button>
        <template v-if="menuState.showSaveAsTemplate">
          <div class="context-menu-separator"></div>
          <button class="context-menu-item" type="button" @click="saveAsTemplate">
            📦 {{ t('template.saveAsTemplate') }}
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * CanvasContextMenu 画布右键菜单组件
   *
   * 职责：纯渲染 + 触发 action。状态管理（visible/position/node）和
   * 事件监听（Vue Flow onNodeContextMenu）在 useCanvasContextMenu composable 中。
   *
   * 通过 menuState（reactive）驱动显示，通过 action 回调触发业务逻辑。
   */
  import { onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type {
    CanvasContextMenuState,
    CanvasContextMenuController,
  } from '@/composables/canvas/useCanvasContextMenu'

  const { t } = useI18n()

  const { controller } = defineProps<{
    /** 菜单响应式状态（由 composable 提供） */
    menuState: CanvasContextMenuState
    /** 控制器（注册事件 + 关闭 + action 回调） */
    controller: CanvasContextMenuController
  }>()

  const addToChat = () => {
    controller.handleAddToChat()
    controller.close()
  }

  const saveAsTemplate = () => {
    controller.handleSaveAsTemplate()
    controller.close()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      controller.close()
    }
  }

  onMounted(() => {
    controller.setup()
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    controller.teardown()
    window.removeEventListener('keydown', handleKeyDown)
  })
</script>
