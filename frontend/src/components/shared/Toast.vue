<!--
  @file Toast.vue
  @description 全局 Toast 通知组件

  通过 Teleport 挂载到 body，显示全局通知消息。
  支持 success / error / warning / info 四种类型，
  自动消失和手动关闭。

  使用方式：
  - 通过 useToast composable 调用 toast.success / toast.error 等
  - 消息自动添加到全局 toasts 队列
-->

<template>
  <teleport to="body">
    <transition-group name="toast" tag="div" class="toast-container">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        :class="['toast', `toast--${toast.type}`]"
        @click="removeToast(toast.id)"
      >
        <div class="toast__icon">
          <svg v-if="toast.type === 'success'" class="icon-check" viewBox="0 0 20 20">
            <path
              fill="currentColor"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            />
          </svg>
          <svg v-else-if="toast.type === 'error'" class="icon-error" viewBox="0 0 20 20">
            <path
              fill="currentColor"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            />
          </svg>
          <svg v-else-if="toast.type === 'warning'" class="icon-warning" viewBox="0 0 20 20">
            <path
              fill="currentColor"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            />
          </svg>
          <svg v-else class="icon-info" viewBox="0 0 20 20">
            <path
              fill="currentColor"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            />
          </svg>
        </div>
        <div class="toast__content">
          <div class="toast__title">{{ toast.title }}</div>
          <div class="toast__message" v-if="toast.message">{{ toast.message }}</div>
        </div>
        <div class="toast__close" @click.stop="removeToast(toast.id)">
          <svg class="icon-close" viewBox="0 0 20 20">
            <path
              fill="currentColor"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            />
          </svg>
        </div>
      </div>
    </transition-group>
  </teleport>
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from 'vue'

  export interface ToastOptions {
    id?: string
    type: 'success' | 'error' | 'warning' | 'info'
    title: string
    message?: string
    duration?: number
    persistent?: boolean
  }

  export interface Toast extends ToastOptions {
    id: string
  }

  const toasts = ref<Toast[]>([])
  let toastIdCounter = 0

  function generateId(): string {
    return `toast-${++toastIdCounter}`
  }

  function addToast(options: ToastOptions): string {
    const toast: Toast = {
      id: generateId(),
      duration: 5000,
      persistent: false,
      ...options,
    }

    toasts.value.push(toast)

    // 如果不是持久化的toast，自动移除
    if (!toast.persistent && toast.duration && toast.duration > 0) {
      setTimeout(() => {
        removeToast(toast.id)
      }, toast.duration)
    }

    return toast.id
  }

  function removeToast(id: string) {
    const index = toasts.value.findIndex((toast) => toast.id === id)
    if (index > -1) {
      toasts.value.splice(index, 1)
    }
  }

  function clearAllToasts() {
    toasts.value = []
  }

  // 暴露方法给全局使用
  function showSuccess(title: string, message?: string, options?: Partial<ToastOptions>) {
    return addToast({ type: 'success', title, message, ...options })
  }

  function showError(title: string, message?: string, options?: Partial<ToastOptions>) {
    return addToast({ type: 'error', title, message, persistent: true, ...options })
  }

  function showWarning(title: string, message?: string, options?: Partial<ToastOptions>) {
    return addToast({ type: 'warning', title, message, ...options })
  }

  function showInfo(title: string, message?: string, options?: Partial<ToastOptions>) {
    return addToast({ type: 'info', title, message, ...options })
  }

  // 暴露给模板使用的方法
  defineExpose({
    addToast,
    removeToast,
    clearAllToasts,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  })

  // 提供全局方法
  onMounted(() => {
    // 将toast方法挂载到全局
    ;(window as unknown as { $toast?: unknown }).$toast = {
      success: showSuccess,
      error: showError,
      warning: showWarning,
      info: showInfo,
      clear: clearAllToasts,
      remove: removeToast,
    }
  })

  onUnmounted(() => {
    // 清理全局方法
    delete (window as unknown as { $toast?: unknown }).$toast
  })
</script>

<style scoped src="./Toast.styles.css"></style>
