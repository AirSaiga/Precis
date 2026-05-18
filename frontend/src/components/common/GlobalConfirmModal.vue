<!--
  @file GlobalConfirmModal.vue
  @description 全局确认对话框组件

  功能职责：
  - 提供应用级的统一确认/取消/警示弹窗
  - 支持纯文本或 HTML 内容的消息展示
  - 提供确认、取消及额外替代操作三种按钮
  - 通过 Teleport 挂载到 body，确保层级最高

  关键特性：
  - 全局单例模式，通过 useGlobalConfirm composable 驱动
  - 支持多种对话框类型（信息、成功、警告、错误）
  - 可配置按钮文案（confirmText / cancelText / alternativeText）
  - 点击遮罩层或关闭按钮触发取消操作
  - 模态进入/退出动画过渡效果

  无外部 Props / Emits，所有状态（visible、options、回调）由 useGlobalConfirm() 统一管理。
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="global-confirm-overlay" @click.self="handleCancel">
        <div class="global-confirm-content" :class="options.type">
          <div class="confirm-header">
            <h3 class="confirm-title">{{ options.title }}</h3>
            <button class="close-btn" @click="handleCancel">×</button>
          </div>

          <div class="confirm-body">
            <p v-if="options.allowHtml" class="confirm-message" v-html="options.message"></p>
            <p v-else class="confirm-message">{{ options.message }}</p>
          </div>

          <div class="confirm-actions">
            <button class="btn btn-cancel" @click="handleCancel">
              {{ options.cancelText }}
            </button>
            <button
              v-if="options.alternativeText"
              class="btn btn-alternative"
              @click="handleAlternative"
            >
              {{ options.alternativeText }}
            </button>
            <button class="btn btn-confirm" @click="handleConfirm">
              {{ options.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'

  const { visible, options, handleConfirm, handleCancel, handleAlternative } = useGlobalConfirm()
</script>

<style scoped src="./GlobalConfirmModal.styles.css"></style>
