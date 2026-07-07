<template>
  <Teleport to="body">
    <div v-if="visible" class="sub-canvas-modal-overlay" @click.self="handleClose">
      <div class="sub-canvas-modal">
        <!-- 顶部工具栏 -->
        <div class="sub-canvas-toolbar">
          <h3 class="toolbar-title">{{ title }}</h3>
          <div class="toolbar-actions">
            <button class="toolbar-btn" @click="handleSave">
              {{ t('canvas.subCanvas.save') }}
            </button>
            <button class="toolbar-btn secondary" @click="handleClose">
              {{ t('canvas.subCanvas.close') }}
            </button>
          </div>
        </div>

        <!-- Vue Flow 子画布 -->
        <div class="sub-canvas-flow-wrapper">
          <VueFlow
            v-model:nodes="subStore.nodes.value"
            v-model:edges="subStore.edges.value"
            :node-types="subNodeTypes"
            :default-edge-options="{
              type: 'smoothstep',
              animated: true,
              style: { strokeWidth: 2 },
            }"
            :default-viewport="{ zoom: 0.9 }"
            class="theme-default"
            :selection-mode="SelectionMode.Partial"
            :select-nodes-on-drag="true"
            :min-zoom="0.2"
            :max-zoom="2"
          >
            <Background
              :variant="BackgroundVariant.Dots"
              pattern-color="var(--ui-grid-color)"
              :gap="24"
              :size="2"
            />
            <Controls />
          </VueFlow>
        </div>

        <!-- 底部约束类型快捷添加栏 -->
        <div class="sub-canvas-bottom-bar">
          <span class="bar-label">{{ t('canvas.subCanvas.addConstraint') }}:</span>
          <button
            v-for="kind in availableConstraintKinds"
            :key="kind"
            class="constraint-chip"
            @click="addConstraintNode(kind)"
          >
            {{ getConstraintDisplayName(kind) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  import { markRaw } from 'vue'
  import { VueFlow, SelectionMode, useVueFlow } from '@vue-flow/core'
  import { Background, BackgroundVariant } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import type { NodeComponent, Edge } from '@vue-flow/core'
  import { useI18n } from 'vue-i18n'
  import { useSubGraphStore } from '@/composables/canvas/useSubGraphStore'
  import { constraintNodeRegistry } from '@/services/registry/constraintNodeRegistry'
  import {
    getConstraintMetaByKind,
    getConstraintKinds,
  } from '@/services/constraints/validationRegistry'
  import type { ConstraintKind } from '@/services/constraints/types'
  import type { CustomNode } from '@/types/graph'
  import SubSchemaInputNode from '@/components/nodes/composite/SubSchemaInputNode.vue'

  const { t } = useI18n()
  const { addEdges: vfAddEdges, removeEdges: vfRemoveEdges } = useVueFlow()

  interface Props {
    visible: boolean
    title?: string
    initialNodes?: CustomNode[]
    initialEdges?: Edge[]
  }

  const props = withDefaults(defineProps<Props>(), {
    title: 'Composite Constraint',
    initialNodes: () => [],
    initialEdges: () => [],
  })

  const emit = defineEmits<{
    save: [state: { nodes: CustomNode[]; edges: Edge[] }]
    close: []
  }>()

  const subStore = useSubGraphStore(props.initialNodes, props.initialEdges, {
    addEdges: vfAddEdges,
    removeEdges: vfRemoveEdges,
  })

  const subNodeTypes: Record<string, NodeComponent> = {
    subSchemaInput: markRaw(SubSchemaInputNode) as unknown as NodeComponent,
    ...(constraintNodeRegistry.notNull?.component && {
      notNullConstraint: constraintNodeRegistry.notNull.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.unique?.component && {
      uniqueConstraint: constraintNodeRegistry.unique.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.range?.component && {
      rangeConstraint: constraintNodeRegistry.range.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.allowedValues?.component && {
      allowedValuesConstraint: constraintNodeRegistry.allowedValues
        .component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.conditional?.component && {
      conditionalConstraint: constraintNodeRegistry.conditional
        .component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.scripted?.component && {
      scriptedConstraint: constraintNodeRegistry.scripted.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.charset?.component && {
      charsetConstraint: constraintNodeRegistry.charset.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.dateLogic?.component && {
      dateLogicConstraint: constraintNodeRegistry.dateLogic.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.foreignKey?.component && {
      foreignKeyConstraint: constraintNodeRegistry.foreignKey.component as unknown as NodeComponent,
    }),
  }

  // A9/A10 修复：约束种类从 CONSTRAINT_TYPES 单一事实源派生，
  // 过去硬编码 9 种且遗漏 composite（与注册表不一致）
  const availableConstraintKinds: ConstraintKind[] = getConstraintKinds()

  function getConstraintDisplayName(kind: ConstraintKind): string {
    const meta = getConstraintMetaByKind(kind)
    const reg = constraintNodeRegistry[kind]
    return reg?.displayName || meta?.v2Type || kind
  }

  function addConstraintNode(kind: ConstraintKind) {
    const meta = getConstraintMetaByKind(kind)
    if (!meta) return
    const count = subStore.nodes.value.length
    subStore.addNode({
      id: `sub-${kind}-${Date.now()}`,
      type: meta.nodeType,
      position: { x: 250 + (count % 3) * 200, y: 100 + Math.floor(count / 3) * 150 },
      data: {
        configName: `${getConstraintDisplayName(kind)}`,
        validationStatus: 'idle',
      },
    })
  }

  function handleSave() {
    emit('save', subStore.getState() as unknown as { nodes: CustomNode[]; edges: Edge[] })
  }

  function handleClose() {
    emit('close')
  }
</script>

<style scoped>
  .sub-canvas-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sub-canvas-modal {
    width: 90vw;
    height: 85vh;
    background: var(--ui-bg-canvas);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .sub-canvas-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ui-border-subtle);
    background: var(--ui-bg-nav-primary);
  }

  .toolbar-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--ui-text-primary);
  }

  .toolbar-actions {
    display: flex;
    gap: 8px;
  }

  .toolbar-btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    background: var(--ui-accent);
    color: white;
    font-size: 13px;
    cursor: pointer;
  }

  .toolbar-btn.secondary {
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    border: 1px solid var(--ui-border-light);
  }

  .sub-canvas-flow-wrapper {
    flex: 1;
    min-height: 0;
  }

  .sub-canvas-bottom-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--ui-border-subtle);
    background: var(--ui-bg-nav-primary);
    overflow-x: auto;
  }

  .bar-label {
    font-size: 12px;
    color: var(--ui-text-muted);
    white-space: nowrap;
  }

  .constraint-chip {
    padding: 4px 10px;
    border: 1px solid var(--ui-border-light);
    border-radius: 12px;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .constraint-chip:hover {
    background: var(--ui-accent);
    color: white;
    border-color: var(--ui-accent);
  }
</style>
