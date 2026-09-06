<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<!--
  @file FallbackInspector.vue
  @description 当节点类型没有对应的专门 Inspector 时显示的通用面板
-->
<template>
  <div class="fallback-inspector">
    <InspectorSection
      :title="t('fallbackInspector.nodeInfo')"
      :badge="t('fallbackInspector.readOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('fallbackInspector.nodeType')"
        :model-value="displayNodeType"
        :editable="false"
      />
      <InspectorField
        :label="t('fallbackInspector.nodeId')"
        :model-value="displayNodeId"
        :editable="false"
      />
    </InspectorSection>

    <InspectorSection
      :title="t('fallbackInspector.nodeData')"
      :badge="t('fallbackInspector.json')"
      badge-class="read-only"
    >
      <div class="json-preview">
        <pre>{{ formattedJson }}</pre>
      </div>
    </InspectorSection>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import InspectorSection from './InspectorSection.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { CustomNodeData } from '@/types/nodes'

  interface Props {
    data: CustomNodeData
    nodeType?: string
    nodeId?: string
  }

  const props = defineProps<Props>()

  const { t } = useI18n()

  const displayNodeType = computed(() => {
    return props.nodeType || 'unknown'
  })

  const displayNodeId = computed(() => {
    return props.nodeId || '-'
  })

  const formattedJson = computed(() => {
    try {
      const json = props.data || {}
      return JSON.stringify(json, null, 2)
    } catch {
      return '{}'
    }
  })
</script>

<style scoped src="./FallbackInspector.styles.css"></style>
