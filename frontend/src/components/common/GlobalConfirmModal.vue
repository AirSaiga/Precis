<!--
  @file GlobalConfirmModal.vue
  @description 全局确认对话框组件

  功能职责：
  - 提供应用级的统一确认/取消/警示弹窗
  - 默认纯文本消息展示（防止 XSS）；当 options.allowHtml 为 true 时渲染 HTML
  - 提供确认、取消及额外替代操作三种按钮
  - 通过 Teleport 挂载到 body，确保层级最高

  关键特性：
  - 全局单例模式，通过 useGlobalConfirm composable 驱动
  - 支持多种对话框类型（信息、成功、警告、错误）
  - 可配置按钮文案（confirmText / cancelText / alternativeText）
  - 点击遮罩层或关闭按钮触发取消操作
  - 模态进入/退出动画过渡效果

  安全提示：
  - allowHtml 仅应在消息内容来自可信来源（如项目内置 i18n）时使用，不要用于渲染用户输入。

  无外部 Props / Emits，所有状态（visible、options、回调）由 useGlobalConfirm() 统一管理。
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="global-confirm-overlay" @click.self="handleCancel">
        <div class="global-confirm-content" :class="options.type">
          <div class="confirm-header">
            <h3 class="confirm-title">{{ options.title }}</h3>
            <button class="close-btn" @click="handleCancel"><AppIcon name="x" :size="16" /></button>
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
  import AppIcon from '@/components/icons/AppIcon.vue'

  const { visible, options, handleConfirm, handleCancel, handleAlternative } = useGlobalConfirm()
</script>

<style scoped src="./GlobalConfirmModal.styles.css"></style>
