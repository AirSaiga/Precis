<template>
  <div class="template-instance-inspector">
    <div class="inspector-section">
      <label>{{ t('inspector.templateInstance.configName') }}</label>
      <input v-model="localData.configName" type="text" @change="emitUpdate" />
    </div>

    <div class="inspector-section">
      <label>{{ t('inspector.templateInstance.templateId') }}</label>
      <div v-if="availableTemplates.length > 0">
        <select
          :value="localData.templateId"
          class="template-select"
          @change="onTemplateSelect"
        >
          <option value="" disabled>{{ t('inspector.templateInstance.selectTemplate') }}</option>
          <option
            v-for="tmpl in availableTemplates"
            :key="tmpl.id"
            :value="tmpl.id"
          >
            {{ tmpl.name || tmpl.id }}
          </option>
        </select>
      </div>
      <div v-else class="readonly-field readonly-field--hint">
        {{ t('inspector.templateInstance.noTemplates') }}
      </div>
    </div>

    <div class="inspector-section">
      <label>{{ t('inspector.templateInstance.enabled') }}</label>
      <input v-model="localData.enabled" type="checkbox" @change="emitUpdate" />
    </div>

    <!-- 参数配置区 -->
    <div v-if="templateParams.length > 0" class="inspector-section">
      <label>{{ t('inspector.templateInstance.parameters') }}</label>
      <div class="params-list">
        <div v-for="param in templateParams" :key="param.id" class="param-item">
          <div class="param-label">
            {{ param.label || param.id }}
            <span v-if="param.required" class="param-required">*</span>
          </div>
          <input
            v-if="param.type === 'string'"
            v-model="localData.parameters[param.id]"
            type="text"
            :placeholder="param.default != null ? String(param.default) : ''"
            @change="emitUpdate"
          />
          <input
            v-else-if="param.type === 'integer'"
            v-model.number="localData.parameters[param.id]"
            type="number"
            step="1"
            :placeholder="param.default != null ? String(param.default) : ''"
            @change="emitUpdate"
          />
          <input
            v-else-if="param.type === 'decimal'"
            v-model.number="localData.parameters[param.id]"
            type="number"
            step="0.01"
            :placeholder="param.default != null ? String(param.default) : ''"
            @change="emitUpdate"
          />
          <label v-else-if="param.type === 'boolean'" class="checkbox-label">
            <input
              v-model="localData.parameters[param.id]"
              type="checkbox"
              @change="emitUpdate"
            />
          </label>
        </div>
      </div>
    </div>

    <!-- 展开预览 -->
    <div class="inspector-section">
      <button class="expand-btn" :disabled="expanding" @click="previewExpand">
        {{ expanding ? t('inspector.templateInstance.expanding') : t('inspector.templateInstance.previewExpand') }}
      </button>
    </div>

    <div class="inspector-section">
      <label>{{ t('inspector.templateInstance.saveState') }}</label>
      <span class="save-state">{{ localData.saveState || 'draft' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { reactive, ref, onMounted, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { TemplateInstanceNodeData } from '@/types/nodes'
  import { getV2Template, expandV2Template } from '@/api/projectV2Api'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useGraphStore } from '@/stores/graphStore'

  const { t } = useI18n()
  const graphStore = useGraphStore()

  interface Props {
    data: TemplateInstanceNodeData
    nodeId: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:data': [data: Partial<TemplateInstanceNodeData>]
  }>()

  const resourceTreeStore = useResourceTreeStore()

  const availableTemplates = computed(() =>
    resourceTreeStore.templates.map((r) => ({
      id: r.id,
      name: (r.meta as { name?: string } | undefined)?.name || r.id,
    }))
  )

  const localData = reactive({
    configName: props.data.configName || '',
    templateId: props.data.templateId || '',
    templateName: props.data.templateName || '',
    enabled: props.data.enabled !== false,
    parameters: { ...(props.data.parameters || {}) } as Record<string, unknown>,
    saveState: props.data.saveState || ('draft' as const),
  })

  interface TemplateParam {
    id: string
    type: 'string' | 'integer' | 'decimal' | 'boolean'
    label: string
    required: boolean
    default: unknown
  }

  const templateParams = ref<TemplateParam[]>([])
  const expanding = ref(false)

  async function loadTemplateParams(templateId: string): Promise<void> {
    try {
      const tmpl = await getV2Template(templateId)
      // 防御性检查：确保 parameters 是数组类型
      const params = Array.isArray(tmpl.parameters) ? tmpl.parameters : []
      templateParams.value = params.map((p: Record<string, unknown>) => ({
        id: String(p.id || ''),
        type: String(p.type || 'string') as TemplateParam['type'],
        label: String(p.label || p.id || ''),
        required: p.required !== false,
        default: p.default,
      }))

      // 对还没有绑定值的参数，应用默认值
      for (const param of templateParams.value) {
        if (localData.parameters[param.id] === undefined && param.default != null) {
          localData.parameters[param.id] = param.default
        }
      }
    } catch {
      // 模板加载失败（可能尚未创建），静默忽略
    }
  }

  onMounted(() => {
    if (!localData.templateId) return
    loadTemplateParams(localData.templateId)
  })

  function onTemplateSelect(e: Event) {
    const select = e.target as HTMLSelectElement
    const newId = select.value
    if (!newId) return

    const matched = availableTemplates.value.find((t) => t.id === newId)
    localData.templateId = newId
    localData.templateName = matched?.name || newId
    localData.parameters = {}
    templateParams.value = []

    // 清除旧模板的展开节点
    graphStore.clearExpansion(props.nodeId)

    // 加载新模板的参数定义并同步到节点
    loadTemplateParams(newId).then(() => {
      emitUpdate()
      emit('update:data', {
        templateId: newId,
        templateName: localData.templateName,
        configName: localData.templateName,
        parameters: { ...localData.parameters },
      })
    })
  }

  function emitUpdate() {
    const summaryParts: string[] = []
    for (const [key, value] of Object.entries(localData.parameters)) {
      if (value !== undefined && value !== '') {
        summaryParts.push(`${key}=${value}`)
      }
    }
    const summaryText = summaryParts.join(', ')

    emit('update:data', {
      configName: localData.configName,
      enabled: localData.enabled,
      parameters: { ...localData.parameters },
      summaryText,
    })
  }

  async function previewExpand() {
    if (!localData.templateId) return

    // 如果子节点已存在（之前展开过），直接显示而无需重新调用 API
    if (graphStore.getExpandedIds(props.nodeId).length > 0) {
      graphStore.reExpand(props.nodeId)
      return
    }

    expanding.value = true
    try {
      // 从 store 实时读取 inputFromNode（props.data 可能在连接后未更新）
      const currentNode = graphStore.nodes.find((n) => n.id === props.nodeId)
      const inputFromNode = ((currentNode?.data as Record<string, unknown>)?.inputFromNode as string) || ''
      const result = await expandV2Template(
        localData.templateId,
        props.nodeId,
        { ...localData.parameters },
        inputFromNode
      )
      // 在画布上渲染展开后的 DAG 节点
      graphStore.expandOnCanvas(props.nodeId, result)
      emit('update:data', { nodeCount: result.transforms.length + result.constraints.length + result.regex_nodes.length })
    } catch (err) {
      console.error('[TemplateInstanceInspector] 展开预览失败:', err)
    } finally {
      expanding.value = false
    }
  }
</script>

<style scoped>
  .template-instance-inspector {
    padding: 12px;
  }

  .inspector-section {
    margin-bottom: 16px;
  }

  .inspector-section label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-secondary);
    margin-bottom: 6px;
  }

  .inspector-section input[type='text'],
  .inspector-section input[type='number'] {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 13px;
  }

  .inspector-section input[type='checkbox'] {
    width: auto;
    margin-top: 4px;
  }

  .readonly-field {
    padding: 6px 10px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border-radius: 4px;
    font-size: 13px;
    color: var(--ui-text-muted);
  }

  .readonly-field--hint {
    font-style: italic;
  }

  .template-select {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 13px;
    cursor: pointer;
    appearance: auto;
  }

  .template-select:focus {
    outline: 1px solid var(--ui-accent);
    border-color: var(--ui-accent);
  }

  .params-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .param-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .param-label {
    font-size: 11px;
    color: var(--ui-text-secondary);
  }

  .param-required {
    color: #f44747;
    margin-left: 2px;
  }

  .checkbox-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .expand-btn {
    width: 100%;
    padding: 8px;
    background: var(--ui-accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .expand-btn:hover:not(:disabled) {
    background: var(--ui-accent-primary);
  }

  .expand-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .expand-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 12px;
    color: var(--ui-text-secondary);
  }

  .save-state {
    font-size: 12px;
    color: var(--ui-text-muted);
    text-transform: uppercase;
  }
</style>
