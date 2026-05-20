<!--
  @file AIGenerationCodePreview.vue
  @description AI 配置生成结果中的 YAML 代码预览子组件

  功能职责：
  - 使用 CodeMirror 只读展示生成的 YAML 配置

  Props:
    - yamlString: string  YAML 文本内容
-->
<template>
  <div class="code-view-container">
    <codemirror
      :model-value="yamlString"
      :style="{ height: '100%', width: '100%' }"
      :autofocus="false"
      :indent-with-tab="true"
      :tab-size="2"
      :extensions="extensions"
      :disabled="true"
    />
  </div>
</template>

<script setup lang="ts">
  import { Codemirror } from 'vue-codemirror'
  import { yaml } from '@codemirror/lang-yaml'

  interface Props {
    yamlString: string
  }

  defineProps<Props>()

  const extensions = [yaml()]
</script>

<style scoped src="./CodePreview.styles.css"></style>
