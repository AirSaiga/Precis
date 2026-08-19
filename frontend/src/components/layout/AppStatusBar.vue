<!--
  @file AppStatusBar.vue
  @description 应用状态栏组件

  职责：
  - 显示当前项目名称（已打开）或提示未打开项目
  - 点击可切换/打开项目
-->

<template>
  <div class="status-bar">
    <button
      class="project-chip"
      type="button"
      :title="projectChipTitle"
      @click="openProjectManagement"
    >
      <span v-if="projectStore.isProjectActive" class="project-dot" />
      <span class="project-icon"
        ><AppIcon v-if="projectStore.isProjectActive" name="folder-open" :size="14" /><AppIcon
          v-else
          name="folder"
          :size="14"
      /></span>
      <span class="project-name">{{
        projectStore.isProjectActive
          ? graphStore.projectName || projectStore.currentPaths?.configPath
          : t('common.projectManagement.noProject')
      }}</span>
    </button>

    <!-- 配置自检状态徽章（无问题时自动隐藏） -->
    <InspectionStatusBadge />

    <!-- 校验全绿时刻：成功计数一次 status-pulse 后静默驻留。
         reduced-motion 下不显示（仅保留 toast 正反馈） -->
    <span
      v-if="allPassMoment"
      class="status-all-pass"
      :class="{ 'is-pulsing': allPassMoment.pulsing }"
    >
      <AppIcon name="check-circle" :size="12" />
      <span>{{ t('statusBar.allPass', { count: allPassMoment.count }) }}</span>
    </span>

    <!-- AI 状态指示（IDE/Agent 共享）：AgentStatusBar 内部 visible computed
         在无 AI 活动时返回 false 自动隐藏，不影响状态栏原有布局 -->
    <AgentStatusBar :streaming="currentStreaming" :loading="aiChatStore.loading" />
  </div>
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { eventBus } from '@/core/eventBus'
  import { useReducedMotion } from '@/composables/useReducedMotion'
  import { useGraphStore } from '@/stores/graphStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useAiChatStore } from '@/stores/aiChatStore'
  import { useCurrentStreaming } from '@/composables/ai/useCurrentStreaming'
  import InspectionStatusBadge from '@/components/inspection/InspectionStatusBadge.vue'
  import AgentStatusBar from '@/components/ai/AgentStatusBar.vue'
  import AppIcon from '@/components/icons/AppIcon.vue'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()
  const aiChatStore = useAiChatStore()
  const currentStreaming = useCurrentStreaming(() => aiChatStore.messages)

  /**
   * 校验全绿时刻（P2-3）：
   * - 全量校验完成且 0 错误 0 阻塞时，监听 full-validation-all-pass 事件，
   *   成功计数做一次 status-pulse 动画（一次性、不循环），之后静默驻留
   * - reduced-motion 下不显示（正反馈仅保留 success toast）
   * - 监听器在卸载时无条件清理，避免泄漏
   */
  const ALL_PASS_PULSE_MS = 1200
  const reducedMotion = useReducedMotion()
  const allPassMoment = ref<{ count: number; pulsing: boolean } | null>(null)
  let pulseTimer: ReturnType<typeof setTimeout> | null = null

  function handleAllPass(payload: { passedCount: number }): void {
    if (reducedMotion.value) return
    if (pulseTimer !== null) clearTimeout(pulseTimer)
    allPassMoment.value = { count: payload.passedCount, pulsing: true }
    pulseTimer = setTimeout(() => {
      if (allPassMoment.value) allPassMoment.value.pulsing = false
      pulseTimer = null
    }, ALL_PASS_PULSE_MS)
  }

  onMounted(() => eventBus.on('full-validation-all-pass', handleAllPass))
  onBeforeUnmount(() => {
    eventBus.off('full-validation-all-pass', handleAllPass)
    if (pulseTimer !== null) clearTimeout(pulseTimer)
  })

  /**
   * 项目 chip 悬停提示：项目名较长被截断（.project-name max-width: 200px）时，
   * title 提供完整项目名 + 配置文件路径
   */
  const projectChipTitle = computed(() => {
    if (!projectStore.isProjectActive) {
      return t('common.projectManagement.openProject')
    }
    const name = graphStore.projectName
    const configPath = projectStore.currentPaths?.configPath
    if (name && configPath && name !== configPath) {
      return `${name}\n${configPath}`
    }
    return name || configPath || t('common.projectManagement.noProject')
  })

  const openProjectManagement = () => {
    eventBus.emit('open-project-management')
  }
</script>
