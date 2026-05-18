<!--
  @file ProjectRootNodeInspector.vue
  @description 项目根节点属性检查器，用于显示项目根节点的属性信息
-->
<template>
  <div class="project-root-inspector">
    <!-- 1. 项目基本信息区块（只读） -->
    <BaseInspector
      :title="t('inspector.projectRoot.groups.basicInfo')"
      :badge="t('inspector.projectRoot.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.projectRoot.labels.projectName')"
        :model-value="data.projectName"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.projectRoot.labels.projectPath')"
        :model-value="data.projectPath"
        type="path"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.projectRoot.labels.configPath')"
        :model-value="configPath"
        type="path"
        :editable="false"
      />
      <InspectorField
        v-if="data.createdAt"
        :label="t('inspector.projectRoot.labels.lastOpenTime')"
        :model-value="formatDateTime(data.createdAt)"
        :editable="false"
      />
    </BaseInspector>

    <!-- 2. 统计指标区块（只读） -->
    <BaseInspector
      :title="t('inspector.projectRoot.groups.statistics')"
      :badge="t('inspector.projectRoot.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="stats-grid">
        <InspectorStatCard
          icon="📋"
          :value="schemaCountText"
          :label="t('inspector.projectRoot.stats.schemaCount')"
          status="default"
        />
        <InspectorStatCard
          icon="🔒"
          :value="constraintCountText"
          :label="t('inspector.projectRoot.stats.constraintCount')"
          status="default"
        />
        <InspectorStatCard
          icon="🔤"
          :value="regexCountText"
          :label="t('inspector.projectRoot.stats.regexCount')"
          status="default"
        />
      </div>
      <div class="validation-summary" v-if="validationSummary">
        <div class="summary-item">
          <label>{{ t('inspector.projectRoot.stats.passRate') }}</label>
          <div class="pass-rate-display" :class="getPassRateClass()">
            {{ getPassRateText() }}
          </div>
        </div>
        <div class="summary-item">
          <label>{{ t('inspector.projectRoot.stats.errorCount') }}</label>
          <div
            class="error-count-display"
            :class="{ 'has-errors': validationSummary.total_error_count > 0 }"
          >
            {{ validationSummary.total_error_count }}
          </div>
        </div>
      </div>
      <div class="validation-summary" v-else>
        <div class="summary-item">
          <label>{{ t('inspector.projectRoot.stats.passRate') }}</label>
          <div class="pass-rate-display no-data">-</div>
        </div>
        <div class="summary-item">
          <label>{{ t('inspector.projectRoot.stats.errorCount') }}</label>
          <div class="error-count-display">0</div>
        </div>
      </div>
    </BaseInspector>

    <!-- 3. 快捷操作区块 -->
    <BaseInspector :title="t('inspector.projectRoot.groups.quickActions')">
      <div class="actions-grid">
        <InspectorActionButton
          icon="✓"
          :text="t('inspector.projectRoot.actions.fullValidation')"
          @click="handleFullValidation"
        />
        <InspectorActionButton
          icon="📤"
          :text="t('inspector.projectRoot.actions.export')"
          @click="handleExport"
        />
        <InspectorActionButton
          icon="🤖"
          :text="t('inspector.projectRoot.actions.aiGenerate')"
          @click="handleAiGenerate"
        />
        <InspectorActionButton
          icon="🔄"
          :text="t('inspector.projectRoot.actions.reload')"
          @click="handleReload"
        />
        <InspectorActionButton
          icon="📁"
          :text="t('inspector.projectRoot.actions.projectManagement')"
          @click="handleProjectManagement"
        />
        <InspectorActionButton
          icon="✕"
          :text="t('inspector.projectRoot.actions.closeProject')"
          danger
          @click="handleCloseProject"
        />
      </div>
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import BaseInspector from './BaseInspector.vue'
  import {
    InspectorField,
    InspectorStatCard,
    InspectorActionButton,
  } from '@/components/ui/inspector'
  import type { ProjectNodeData } from '@/types/nodes'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()
  const resourceTreeStore = useResourceTreeStore()
  const settingsStore = useSettingsStore()
  const validationTaskStore = useValidationTaskStore()

  /**
   * 组件属性接口
   * 接收 ProjectNodeData 类型的数据
   */
  interface Props {
    data: ProjectNodeData
  }

  /**
   * 使用 defineProps 声明组件属性
   */
  const props = defineProps<Props>()

  /**
   * 获取配置路径
   * 从 projectStore 中获取当前项目的配置路径
   */
  const configPath = computed(() => {
    return projectStore.currentPaths?.configPath || ''
  })

  /**
   * 计算 Schema 数量
   * 使用 resourceTreeStore 保持与状态栏计数一致
   */
  const schemaCountText = computed(() => {
    const total = resourceTreeStore.schemas.length
    const manifestCount = resourceTreeStore.schemasManifestCount
    const unlisted = resourceTreeStore.schemasUnlistedCount
    return unlisted > 0 ? `${total} (M:${manifestCount}/U:${unlisted})` : String(total)
  })

  /**
   * 计算约束数量
   * 使用 resourceTreeStore 保持与状态栏计数一致
   */
  const constraintCountText = computed(() => {
    const base =
      resourceTreeStore.independentConstraintsManifestCount +
      resourceTreeStore.embeddedConstraintsManifestCount
    const extra =
      resourceTreeStore.independentConstraintsUnlistedCount +
      resourceTreeStore.embeddedConstraintsUnlistedCount
    return extra > 0 ? `${base} (+${extra})` : String(base)
  })

  /**
   * 计算正则表达式数量
   * 使用 resourceTreeStore 保持与状态栏计数一致
   */
  const regexCountText = computed(() => {
    const total = resourceTreeStore.regexNodes.length
    const manifestCount = resourceTreeStore.regexNodesManifestCount
    const unlisted = resourceTreeStore.regexNodesUnlistedCount
    return unlisted > 0 ? `${total} (M:${manifestCount}/U:${unlisted})` : String(total)
  })

  /**
   * 获取验证摘要
   * 返回最后一次全量验证的统计信息
   */
  const validationSummary = computed(() => {
    return graphStore.lastFullValidationSummary
  })

  /**
   * 获取验证详细统计
   * 返回最后一次全量验证的详细统计信息（包含通过率）
   */
  const validationStatistics = computed(() => {
    return graphStore.lastFullValidationStatistics
  })

  /**
   * 格式化日期时间字符串
   * 将日期字符串转换为本地化的日期时间格式
   *
   * @param dateString - 日期字符串
   * @returns 格式化后的日期时间字符串，如果为空则返回 '-'
   */
  function formatDateTime(dateString: string): string {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  /**
   * 获取通过率的显示文本
   *
   * @returns 通过率百分比字符串
   */
  function getPassRateText(): string {
    const statistics = validationStatistics.value
    if (!statistics) return '-'
    return `${Math.round(statistics.pass_rate)}%`
  }

  /**
   * 获取通过率的 CSS 类名
   *
   * @returns 对应的 CSS 类名
   */
  function getPassRateClass(): string {
    const statistics = validationStatistics.value
    if (!statistics) return 'no-data'
    if (statistics.pass_rate >= 100) return 'pass'
    if (statistics.pass_rate >= 60) return 'partial'
    return 'fail'
  }

  /**
   * 处理全量校验操作
   * 触发全量校验事件
   */
  function handleFullValidation() {
    validationTaskStore.openFullProject()
  }

  /**
   * 处理导出操作
   * 触发导出完整配置事件
   */
  function handleExport() {
    window.dispatchEvent(new CustomEvent('export-full-config-yaml'))
  }

  /**
   * 处理 AI 生成配置操作
   * 触发 AI 配置生成器事件
   */
  function handleAiGenerate() {
    window.dispatchEvent(new CustomEvent('open-ai-config-generator'))
  }

  /**
   * 处理重载项目操作
   * 重新加载项目数据
   */
  async function handleReload() {
    await graphStore.loadProjectFromV2()
    window.dispatchEvent(new CustomEvent('project-applied'))
  }

  /**
   * 处理项目管理操作
   * 打开设置面板的项目信息标签页
   */
  function handleProjectManagement() {
    settingsStore.open('project-info')
  }

  /**
   * 处理关闭项目操作
   * 弹出确认对话框，确认后清空项目
   */
  function handleCloseProject() {
    if (confirm(t('inspector.projectRoot.confirm.closeProject'))) {
      graphStore.clearProject()
      window.dispatchEvent(new CustomEvent('project-closed'))
    }
  }
</script>

<style scoped src="./ProjectRootNodeInspector.styles.css"></style>
