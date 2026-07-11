<!--
  @file PatternToolboxNodeInspector.vue
  @description PatternToolbox 节点属性检查器，用于显示模式工具箱节点的属性信息
-->
<template>
  <div class="pattern-toolbox-inspector">
    <!-- 1. 工具箱基本信息区块（只读） -->
    <InspectorSection
      :title="t('inspector.patternToolbox.groups.basicInfo')"
      :badge="t('inspector.patternToolbox.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.patternToolbox.labels.toolboxName')"
        :model-value="data.name || '-'"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.patternToolbox.labels.toolboxType')"
        :model-value="getTypeText(data.type)"
        :editable="false"
      />
    </InspectorSection>

    <!-- 2. 模式统计区块（只读） -->
    <InspectorSection
      :title="t('inspector.patternToolbox.groups.patternStats')"
      :badge="t('inspector.patternToolbox.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.patternToolbox.labels.atomicPatternCount')"
        :model-value="`${data.registry?.atomic?.length || 0} ${t('inspector.patternToolbox.units.patterns')}`"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.patternToolbox.labels.compositePatternCount')"
        :model-value="`${data.registry?.patterns?.length || 0} ${t('inspector.patternToolbox.units.patterns')}`"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.patternToolbox.labels.totalPatternCount')"
        :model-value="`${totalPatternCount} ${t('inspector.patternToolbox.units.patterns')}`"
        :editable="false"
      />
    </InspectorSection>

    <!-- 3. 来源信息区块（只读） -->
    <InspectorSection
      :title="t('inspector.patternToolbox.groups.sourceInfo')"
      :badge="t('inspector.patternToolbox.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.patternToolbox.labels.configFilePath')"
        :model-value="data.sourceFile || '-'"
        type="path"
        :editable="false"
      />
    </InspectorSection>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import InspectorSection from './InspectorSection.vue'
  import { InspectorField } from '@/components/ui/inspector'
  const { t } = useI18n()

  /**
   * PatternToolbox节点数据类型定义
   */
  interface PatternToolboxData {
    name?: string
    type?: 'atomic' | 'patterns'
    registry?: {
      atomic?: Array<{ id: string; name: string }>
      patterns?: Array<{ id: string; name: string }>
    }
    sourceFile?: string
  }

  /**
   * 组件属性接口
   * 接收PatternToolboxData类型的数据
   */
  interface Props {
    data: PatternToolboxData
  }

  /**
   * 使用defineProps声明组件属性
   */
  const props = defineProps<Props>()

  /**
   * 计算模式总数
   * 原子模式数量 + 组合模式数量
   */
  const totalPatternCount = computed(() => {
    const atomicCount = props.data.registry?.atomic?.length || 0
    const patternsCount = props.data.registry?.patterns?.length || 0
    return atomicCount + patternsCount
  })

  /**
   * 获取类型对应的CSS类
   *
   * @param type - 工具箱类型：atomic 或 patterns
   * @returns 对应的CSS类名
   */

  /**
   * 获取类型对应的显示文本
   *
   * @param type - 工具箱类型：atomic 或 patterns
   * @returns 对应的中文文本
   */
  function getTypeText(type?: string): string {
    switch (type) {
      case 'atomic':
        return t('inspector.patternToolbox.types.atomic')
      case 'patterns':
        return t('inspector.patternToolbox.types.patterns')
      default:
        return t('inspector.patternToolbox.types.unknown')
    }
  }
</script>

<style scoped src="./PatternToolboxNodeInspector.styles.css"></style>
