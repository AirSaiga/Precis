/** * @file SchemaNodeErrorPopover.vue * @description Schema节点错误详情气泡弹窗组件 * * 核心功能：
* - 显示Schema节点的验证错误详情 * - 气泡弹窗形式，精确定位到错误列 * - 显示错误摘要和详细信息 * *
数据流： * 验证错误 → ErrorPopover → 错误详情展示 */
<template>
  <Teleport to="body">
    <div v-if="show && errors.length > 0" class="error-detail-popover" :style="positionStyle">
      <div class="error-detail-header">
        {{ formattedErrors.summary }}
      </div>
      <div class="error-detail-content">
        {{ formattedErrors.fullMessage }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file SchemaNodeErrorPopover.vue
   * @description Schema节点错误详情悬浮面板组件
   *
   * 该组件用于显示列验证错误的详细信息：
   * 1. 显示错误摘要
   * 2. 显示完整错误信息
   */

  import { computed } from 'vue'

  /**
   * 格式化后的错误信息接口
   */
  interface FormattedErrors {
    summary: string
    fullMessage: string
  }

  /**
   * 常量：最大错误显示数量
   */
  const MAX_ERROR_DISPLAY = 10

  /**
   * 组件属性
   */
  const props = defineProps<{
    show: boolean
    errors: string[]
    position: { top: string; left: string }
  }>()

  /**
   * 位置样式计算
   */
  const positionStyle = computed(() => ({
    top: props.position.top,
    left: props.position.left,
  }))

  /**
   * 格式化错误信息
   */
  const formattedErrors = computed((): FormattedErrors => {
    if (!props.errors || props.errors.length === 0) {
      return { summary: '', fullMessage: '' }
    }

    const total = props.errors.length
    const displayErrors = props.errors.slice(0, MAX_ERROR_DISPLAY)

    const nullErrors = props.errors.filter((e) => e.includes('为空'))
    const duplicateErrors = props.errors.filter((e) => e.includes('重复'))

    const parts: string[] = []
    if (nullErrors.length > 0) parts.push(`${nullErrors.length} 个空值错误`)
    if (duplicateErrors.length > 0) parts.push(`${duplicateErrors.length} 个重复值错误`)

    let summary: string
    let fullMessage: string

    if (parts.length > 0) {
      summary = parts.join(' + ')
    } else {
      summary = `${total} 个错误`
    }

    if (total <= MAX_ERROR_DISPLAY) {
      fullMessage = props.errors.join('\n')
    } else {
      fullMessage = `${displayErrors.join('\n')}\n... 共 ${total} 个错误`
    }

    return { summary, fullMessage }
  })
</script>

<style scoped src="./SchemaNodeErrorPopover.styles.css"></style>
