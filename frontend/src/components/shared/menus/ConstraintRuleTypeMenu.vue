<!--
  @file ConstraintRuleTypeMenu.vue
  @description 约束类型选择菜单

  在画布上右键点击空白区域或点击添加约束按钮时显示的菜单。
  按分类（属性约束 / 关系约束 / 逻辑约束）展示所有可用的约束类型。

  点击约束类型后在当前位置创建对应的约束节点。
-->

<template>
  <Teleport to="body">
    <div v-if="visible" class="constraint-rule-type-menu-overlay" @click="closeMenu">
      <div
        class="constraint-rule-type-menu"
        :style="{ left: position.x + 'px', top: position.y + 'px' }"
        @click.stop
      >
        <div class="menu-header">
          <div class="menu-title">{{ t('constraintRuleTypeMenu.title') }}</div>
          <div class="menu-close" @click="closeMenu"><AppIcon name="x" :size="16" /></div>
        </div>

        <div class="menu-content">
          <div class="category-section">
            <div class="category-title">{{ t('constraintRuleTypeMenu.attribute') }}</div>
            <div class="constraint-grid">
              <div
                v-for="constraintType in attributeConstraints"
                :key="constraintType.id"
                class="constraint-item"
                :class="{ 'is-disabled': isConstraintDisabled(constraintType) }"
                @click="selectConstraintType(constraintType)"
                :title="
                  isConstraintDisabled(constraintType)
                    ? getConstraintDisabledMessage(constraintType)
                    : constraintType.description
                "
              >
                <span class="constraint-icon"
                  ><AppIcon :name="constraintType.icon" :size="14"
                /></span>
                <span class="constraint-name">{{ constraintType.name }}</span>
              </div>
            </div>
          </div>

          <div class="category-section">
            <div class="category-title">{{ t('constraintRuleTypeMenu.relation') }}</div>
            <div class="constraint-grid">
              <div
                v-for="constraintType in relationConstraints"
                :key="constraintType.id"
                class="constraint-item"
                :class="{ 'is-disabled': isConstraintDisabled(constraintType) }"
                @click="selectConstraintType(constraintType)"
                :title="
                  isConstraintDisabled(constraintType)
                    ? getConstraintDisabledMessage(constraintType)
                    : constraintType.description
                "
              >
                <span class="constraint-icon"
                  ><AppIcon :name="constraintType.icon" :size="14"
                /></span>
                <span class="constraint-name">{{ constraintType.name }}</span>
              </div>
            </div>
          </div>

          <div class="category-section">
            <div class="category-title">{{ t('constraintRuleTypeMenu.logic') }}</div>
            <div class="constraint-grid">
              <div
                v-for="constraintType in logicConstraints"
                :key="constraintType.id"
                class="constraint-item"
                :class="{ 'is-disabled': isConstraintDisabled(constraintType) }"
                @click="selectConstraintType(constraintType)"
                :title="
                  isConstraintDisabled(constraintType)
                    ? getConstraintDisabledMessage(constraintType)
                    : constraintType.description
                "
              >
                <span class="constraint-icon"
                  ><AppIcon :name="constraintType.icon" :size="14"
                /></span>
                <span class="constraint-name">{{ constraintType.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from '@/stores/settingsStore'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { CONSTRAINT_ICON_NAMES } from '@/components/icons/iconRegistry'

  export interface ConstraintRuleTypeOption {
    id: string
    name: string
    description: string
    icon: string
    constraintType:
      | 'allowedValues'
      | 'foreignKey'
      | 'unique'
      | 'notNull'
      | 'conditional'
      | 'scripted'
      | 'range'
      | 'charset'
      | 'dateLogic'
      | 'composite'
    category: 'attribute' | 'relation' | 'logic'
    requireScriptEnabled?: boolean
    createNodeData: () => Record<string, unknown>
  }

  const createDefaultData = {
    foreignKey: () => ({
      sourceTable: '',
      sourceColumn: '',
      targetTable: '',
      targetColumn: '',
      constraintName: '',
    }),
    unique: () => ({ table: '', columns: [], constraintName: '' }),
    notNull: () => ({ table: '', column: '', constraintName: '' }),
    allowedValues: () => ({ table: '', column: '', allowedValues: [], constraintName: '' }),
    conditional: () => ({
      table: '',
      ifColumn: '',
      ifValue: '',
      thenColumn: '',
      thenConditionConfig: {},
      constraintName: '',
    }),
    scripted: () => ({ table: '', column: '', script: '', constraintName: '' }),
    range: () => ({
      table: '',
      column: '',
      minValue: 0,
      maxValue: 100,
      boundaryMode: 'inclusive',
      constraintName: '',
    }),
    charset: () => ({ table: '', column: '', charsetMode: 'ascii', constraintName: '' }),
    dateLogic: () => ({
      table: '',
      column: '',
      logicMode: 'compare',
      compareOp: 'gt',
      referenceDate: '',
      referenceColumn: '',
      calculationType: 'age',
      targetValue: '',
      targetColumn: '',
      constraintName: '',
    }),
    composite: () => ({
      table: '',
      column: '',
      logic: 'all',
      subGraph: { nodes: [], edges: [] },
      constraintName: '',
    }),
  }

  const ICONS = {
    notNull: CONSTRAINT_ICON_NAMES.notNull,
    unique: CONSTRAINT_ICON_NAMES.unique,
    range: CONSTRAINT_ICON_NAMES.range,
    charset: CONSTRAINT_ICON_NAMES.charset,
    allowedValues: CONSTRAINT_ICON_NAMES.allowedValues,
    foreignKey: CONSTRAINT_ICON_NAMES.foreignKey,
    conditional: CONSTRAINT_ICON_NAMES.conditional,
    scripted: CONSTRAINT_ICON_NAMES.scripted,
    dateLogic: CONSTRAINT_ICON_NAMES.dateLogic,
    composite: CONSTRAINT_ICON_NAMES.composite,
  }

  // 约束类型的静态元数据（非文案字段）。
  // name/description 不再硬编码，运行时由 constraintRuleTypes computed 从
  // i18n 的 constraintTypes.<kind>.{name,description} 命名空间解析，保证全应用一致。
  interface ConstraintTypeMeta {
    id: string
    kind: ConstraintRuleTypeOption['constraintType']
    icon: string
    category: ConstraintRuleTypeOption['category']
    requireScriptEnabled?: boolean
    createNodeData: () => Record<string, unknown>
  }
  const CONSTRAINT_TYPE_META: ConstraintTypeMeta[] = [
    {
      id: 'not-null',
      kind: 'notNull',
      icon: ICONS.notNull,
      category: 'attribute',
      createNodeData: createDefaultData.notNull,
    },
    {
      id: 'unique',
      kind: 'unique',
      icon: ICONS.unique,
      category: 'attribute',
      createNodeData: createDefaultData.unique,
    },
    {
      id: 'range',
      kind: 'range',
      icon: ICONS.range,
      category: 'attribute',
      createNodeData: createDefaultData.range,
    },
    {
      id: 'charset',
      kind: 'charset',
      icon: ICONS.charset,
      category: 'attribute',
      createNodeData: createDefaultData.charset,
    },
    {
      id: 'allowed-values',
      kind: 'allowedValues',
      icon: ICONS.allowedValues,
      category: 'relation',
      createNodeData: createDefaultData.allowedValues,
    },
    {
      id: 'foreign-key',
      kind: 'foreignKey',
      icon: ICONS.foreignKey,
      category: 'relation',
      createNodeData: createDefaultData.foreignKey,
    },
    {
      id: 'conditional',
      kind: 'conditional',
      icon: ICONS.conditional,
      category: 'logic',
      createNodeData: createDefaultData.conditional,
    },
    {
      id: 'scripted',
      kind: 'scripted',
      icon: ICONS.scripted,
      category: 'logic',
      requireScriptEnabled: true,
      createNodeData: createDefaultData.scripted,
    },
    {
      id: 'date-logic',
      kind: 'dateLogic',
      icon: ICONS.dateLogic,
      category: 'logic',
      createNodeData: createDefaultData.dateLogic,
    },
    {
      id: 'composite',
      kind: 'composite',
      icon: ICONS.composite,
      category: 'logic',
      createNodeData: createDefaultData.composite,
    },
  ]

  const DEFAULT_CONSTRAINT_RULE_TYPES = computed<ConstraintRuleTypeOption[]>(() =>
    CONSTRAINT_TYPE_META.map((meta) => ({
      id: meta.id,
      name: t(`constraintTypes.${meta.kind}.name`),
      description: t(`constraintTypes.${meta.kind}.description`),
      icon: meta.icon,
      constraintType: meta.kind,
      category: meta.category,
      ...(meta.requireScriptEnabled ? { requireScriptEnabled: true } : {}),
      createNodeData: meta.createNodeData,
    }))
  )

  const props = defineProps<{
    visible: boolean
    position: { x: number; y: number }
    constraintTypes?: ConstraintRuleTypeOption[]
  }>()

  const emit = defineEmits<{
    'select-constraint-type': [
      constraintType: ConstraintRuleTypeOption,
      nodeData: Record<string, unknown>,
    ]
    'close-menu': []
  }>()

  const { t } = useI18n()
  const settingsStore = useSettingsStore()

  const constraintRuleTypes = computed(() => {
    return props.constraintTypes && props.constraintTypes.length > 0
      ? props.constraintTypes
      : DEFAULT_CONSTRAINT_RULE_TYPES.value
  })

  const attributeConstraints = computed(() =>
    constraintRuleTypes.value.filter((type) => type.category === 'attribute')
  )
  const relationConstraints = computed(() =>
    constraintRuleTypes.value.filter((type) => type.category === 'relation')
  )
  const logicConstraints = computed(() =>
    constraintRuleTypes.value.filter((type) => type.category === 'logic')
  )

  const isScriptEnabled = computed(() => settingsStore.isScriptEnabled)

  const isConstraintDisabled = (constraintType: ConstraintRuleTypeOption): boolean => {
    return Boolean(constraintType.requireScriptEnabled) && !isScriptEnabled.value
  }

  const getConstraintDisabledMessage = (constraintType: ConstraintRuleTypeOption): string => {
    if (constraintType.requireScriptEnabled && !isScriptEnabled.value) {
      return t('settings.script.hint')
    }
    return ''
  }

  const selectConstraintType = (constraintType: ConstraintRuleTypeOption) => {
    if (isConstraintDisabled(constraintType)) return
    const nodeData = constraintType.createNodeData()
    emit('select-constraint-type', constraintType, nodeData)
    emit('close-menu')
  }

  const closeMenu = () => emit('close-menu')
</script>

<style scoped src="./ConstraintRuleTypeMenu.styles.css"></style>
