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
          <div class="menu-close" @click="closeMenu">×</div>
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

  const DEFAULT_CONSTRAINT_RULE_TYPES: ConstraintRuleTypeOption[] = [
    {
      id: 'not-null',
      name: '非空约束',
      description: '确保列不能包含空值',
      icon: ICONS.notNull,
      constraintType: 'notNull',
      category: 'attribute',
      createNodeData: createDefaultData.notNull,
    },
    {
      id: 'unique',
      name: '唯一约束',
      description: '确保列或列组合的值在表中唯一',
      icon: ICONS.unique,
      constraintType: 'unique',
      category: 'attribute',
      createNodeData: createDefaultData.unique,
    },
    {
      id: 'range',
      name: '区间约束',
      description: '限制列的值必须在指定数值范围内',
      icon: ICONS.range,
      constraintType: 'range',
      category: 'attribute',
      createNodeData: createDefaultData.range,
    },
    {
      id: 'charset',
      name: '字符集约束',
      description: '校验ASCII或中文字符',
      icon: ICONS.charset,
      constraintType: 'charset',
      category: 'attribute',
      createNodeData: createDefaultData.charset,
    },
    {
      id: 'allowed-values',
      name: '允许值约束',
      description: '限制列只能包含指定的值',
      icon: ICONS.allowedValues,
      constraintType: 'allowedValues',
      category: 'relation',
      createNodeData: createDefaultData.allowedValues,
    },
    {
      id: 'foreign-key',
      name: '外键约束',
      description: '建立表之间的外键关联关系',
      icon: ICONS.foreignKey,
      constraintType: 'foreignKey',
      category: 'relation',
      createNodeData: createDefaultData.foreignKey,
    },
    {
      id: 'conditional',
      name: '条件约束',
      description: '基于条件逻辑的动态约束规则',
      icon: ICONS.conditional,
      constraintType: 'conditional',
      category: 'logic',
      createNodeData: createDefaultData.conditional,
    },
    {
      id: 'scripted',
      name: '脚本约束',
      description: '使用自定义脚本定义的约束规则',
      icon: ICONS.scripted,
      constraintType: 'scripted',
      category: 'logic',
      requireScriptEnabled: true,
      createNodeData: createDefaultData.scripted,
    },
    {
      id: 'date-logic',
      name: '日期逻辑约束',
      description: '日期比较和计算校验',
      icon: ICONS.dateLogic,
      constraintType: 'dateLogic',
      category: 'logic',
      createNodeData: createDefaultData.dateLogic,
    },
    {
      id: 'composite',
      name: '复合约束',
      description: '将多个子约束按逻辑策略组合校验',
      icon: ICONS.composite,
      constraintType: 'composite',
      category: 'logic',
      createNodeData: createDefaultData.composite,
    },
  ]

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
      : DEFAULT_CONSTRAINT_RULE_TYPES
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
