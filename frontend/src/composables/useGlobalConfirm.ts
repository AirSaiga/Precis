/**
 * @file useGlobalConfirm.ts
 * @description 全局确认对话框组合式函数
 *
 * 核心功能：
 * - 提供全局统一的确认对话框功能
 * - 支持 Promise 形式的异步调用
 * - 可自定义标题、消息、按钮文本和类型
 * - 基于队列管理，支持多个确认请求按顺序处理，避免竞态条件
 *
 * 使用方式：
 * const { showConfirm } = useGlobalConfirm();
 * const confirmed = await showConfirm('确定要执行此操作吗？');
 * if (confirmed) { ... }
 *
 * 接口说明：
 * - ConfirmOptions.title: 对话框标题
 * - ConfirmOptions.message: 对话框消息内容
 * - ConfirmOptions.confirmText: 确认按钮文本
 * - ConfirmOptions.cancelText: 取消按钮文本
 * - ConfirmOptions.type: 对话框类型（info/warning/error）
 */
import { ref, computed } from 'vue'
import i18n from '@/i18n'

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'info' | 'warning' | 'error'
  allowHtml?: boolean
  alternativeText?: string
}

interface ConfirmQueueItem {
  options: ConfirmOptions
  resolve: (value: boolean | 'alternative') => void
}

const defaultOptions: ConfirmOptions = {
  title: '确认',
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  alternativeText: '',
  type: 'info',
  allowHtml: false,
}

/** 确认请求队列 */
const queue = ref<ConfirmQueueItem[]>([])

/** 当前是否有确认框显示 */
const visible = computed(() => queue.value.length > 0)

/** 当前显示确认框的选项（队列头部） */
const options = computed(() => queue.value[0]?.options || defaultOptions)

/**
 * 规范化确认选项
 */
function normalizeOptions(opts: string | ConfirmOptions): ConfirmOptions {
  const t = i18n.global.t
  if (typeof opts === 'string') {
    return {
      title: t('common.confirmDialog.title'),
      message: opts,
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      type: 'info',
      allowHtml: false,
      alternativeText: '',
    }
  }
  return {
    title: opts.title || t('common.confirmDialog.title'),
    message: opts.message,
    confirmText: opts.confirmText || t('common.confirm'),
    cancelText: opts.cancelText || t('common.cancel'),
    alternativeText: opts.alternativeText || '',
    type: opts.type || 'info',
    allowHtml: opts.allowHtml === true,
  }
}

export function useGlobalConfirm() {
  const showConfirm = (opts: string | ConfirmOptions): Promise<boolean | 'alternative'> => {
    return new Promise((resolve) => {
      // [safe-push] queue 是独立的响应式数组，非 Vue Flow 节点/边
      queue.value.push({
        options: normalizeOptions(opts),
        resolve,
      })
    })
  }

  const handleConfirm = () => {
    const item = queue.value.shift()
    if (item) {
      item.resolve(true)
    }
  }

  const handleCancel = () => {
    const item = queue.value.shift()
    if (item) {
      item.resolve(false)
    }
  }

  const handleAlternative = () => {
    const item = queue.value.shift()
    if (item) {
      item.resolve('alternative')
    }
  }

  return {
    visible,
    options,
    showConfirm,
    handleConfirm,
    handleCancel,
    handleAlternative,
  }
}
