<!--
  @file ConflictResolutionModal.vue
  @description AI 配置生成冲突解决模态框

  功能职责：
  - 对比 AI 生成的配置与当前项目原有配置的差异
  - 提供 Schema、Constraint 等资源的增改可视化对比
  - 支持按新增/修改类型筛选冲突项
  - 提供批量处理策略（安全默认、全部保留、全部使用 AI、仅使用新增）
  - 允许用户对单个冲突项选择保留原配置或使用 AI 生成的新配置

  关键特性：
  - 左侧边栏分类展示冲突项列表，支持搜索过滤
  - 右侧详情区展示原始内容与生成内容的 diff 对比
  - 批量操作按钮快速应用统一策略
  - 冲突解决状态实时反馈（已选择策略标签）

  Props:
    - visible: boolean              控制模态框显示/隐藏
    - comparison: ConfigComparison  AI 生成与原始配置的对比结果
    - generatedManifest: ProjectManifestV2  AI 生成的项目清单
    - originalManifest: ProjectManifestV2   原始项目清单

  Emits:
    - close:   用户取消或关闭时触发
    - confirm: 用户确认解决策略后触发，携带 FullConfigV2Request 载荷
-->
<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-content conflict-modal">
        <div class="modal-header">
          <div class="header-title">
            <h3>{{ t('aiConfigGenerator.conflict.title') }}</h3>
            <span class="header-subtitle">{{ summaryText }}</span>
          </div>
          <button class="close-btn" @click="$emit('close')">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5L15 15"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <ConflictSidebar
            :schemas="filteredSchemas"
            :constraints="filteredConstraints"
            :regexNodes="filteredRegexNodes"
            :resolutions="resolutions"
            v-model:searchText="searchText"
            v-model:statusFilter="statusFilter"
            :selectedId="selectedId"
            :selectedType="selectedType"
            :totalCount="totalCount"
            :addedCount="addedCount"
            :modifiedCount="modifiedCount"
            @select-item="selectItem"
            @apply-batch="applyBatch"
          />
          <div class="main-content">
            <ConflictDiffView
              v-if="selectedItem"
              :selectedItem="selectedItem"
              :resolutions="resolutions"
              :partialResolutions="partialResolutions"
              :diffLines="diffLines"
              @set-resolution="setResolution"
              @set-line-resolution="setLineResolution"
            />
            <div v-else class="empty-selection">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect
                  x="8"
                  y="8"
                  width="48"
                  height="48"
                  rx="8"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <path
                  d="M24 32L32 40L42 28"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <p>{{ t('aiConfigGenerator.conflict.emptySelection') }}</p>
            </div>
          </div>
        </div>

        <ConflictFooter
          :generatedCount="Math.floor(generatedCount)"
          :originalCount="Math.floor(originalCount)"
          :totalCount="totalCount"
          @confirm="confirm"
          @cancel="$emit('close')"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import ConflictSidebar from './conflict-resolution/ConflictSidebar.vue'
  import ConflictDiffView from './conflict-resolution/ConflictDiffView.vue'
  import ConflictFooter from './conflict-resolution/ConflictFooter.vue'
  import { useConflictFilter } from '@/composables/conflict/useConflictFilter'
  import { useConflictDiffEngine } from '@/composables/conflict/useConflictDiffEngine'
  import { useConflictResolution } from '@/composables/conflict/useConflictResolution'
  import type { ConfigItemDiff, ConfigComparison } from '@/api/types/conflict'
  import type { FullConfigV2Request, ProjectManifestV2 } from '@/types/projectV2'

  const props = defineProps<{
    visible: boolean
    comparison: ConfigComparison
    generatedManifest: ProjectManifestV2
    originalManifest: ProjectManifestV2
  }>()

  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'confirm', payload: FullConfigV2Request): void
  }>()

  const { t } = useI18n()

  const selectedId = ref<string | null>(null)
  const selectedType = ref<'schema' | 'constraint' | 'regex' | null>(null)

  const {
    searchText,
    statusFilter,
    filteredSchemas,
    filteredConstraints,
    filteredRegexNodes,
    totalCount,
    addedCount,
    modifiedCount,
  } = useConflictFilter(props.comparison)

  const selectedItem = computed(() => {
    if (!selectedId.value || !selectedType.value) return null
    const list =
      selectedType.value === 'schema'
        ? props.comparison.schemas
        : selectedType.value === 'constraint'
          ? props.comparison.constraints
          : props.comparison.regex_nodes
    return list.find((i) => i.id === selectedId.value) || null
  })

  const { diffLines } = useConflictDiffEngine(selectedItem)

  const {
    resolutions,
    partialResolutions,
    setResolution,
    setLineResolution,
    generatedCount,
    originalCount,
    applyBatch,
    initResolutions,
    confirm,
  } = useConflictResolution(
    props.comparison,
    props.generatedManifest,
    props.originalManifest,
    (item: ConfigItemDiff<unknown>) => {
      const typeOk = statusFilter.value === 'all' ? true : item.type === statusFilter.value
      if (!typeOk) return false
      const q = (searchText.value || '').trim().toLowerCase()
      if (!q) return true
      return (
        String(item.name || '')
          .toLowerCase()
          .includes(q) ||
        String(item.id || '')
          .toLowerCase()
          .includes(q)
      )
    },
    (payload: FullConfigV2Request) => emit('confirm', payload)
  )

  const selectItem = (item: ConfigItemDiff<unknown>, type: 'schema' | 'constraint' | 'regex') => {
    selectedId.value = item.id
    selectedType.value = type
  }

  const summaryText = computed(() => {
    const gen = Math.floor(generatedCount.value)
    const orig = Math.floor(originalCount.value)
    const mixed = Object.values(resolutions.value).filter((v) => v === 'mixed').length

    if (mixed > 0) {
      return `${t('aiConfigGenerator.conflict.summary', { generated: gen, original: orig })} (+${mixed} 部分应用)`
    }
    return t('aiConfigGenerator.conflict.summary', { generated: gen, original: orig })
  })

  watch(
    () => props.visible,
    (val) => {
      if (val) {
        initResolutions()
        const firstSchema = filteredSchemas.value[0]
        const firstConstraint = filteredConstraints.value[0]
        const firstRegex = filteredRegexNodes.value[0]
        if (firstSchema) selectItem(firstSchema, 'schema')
        else if (firstConstraint) selectItem(firstConstraint, 'constraint')
        else if (firstRegex) selectItem(firstRegex, 'regex')
      }
    }
  )
</script>

<style scoped src="./ConflictResolutionModal.styles.css"></style>
