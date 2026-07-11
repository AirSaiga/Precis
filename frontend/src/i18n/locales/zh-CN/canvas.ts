/**
 * @file canvas.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const canvas = {
  workspace: '工作区',
  newWorkspace: '新建画布工作区',
  workspaceWithIndex: '{name} {index}',
  closeWorkspaceConfirm: '工作区 "{title}" 有未保存的更改，确定要关闭吗？',
  renameWorkspacePrompt: '输入新的工作区名称:',
  tabs: {
    dirty: '●',
    close: '',
    add: '+',
  },
  controls: {
    toggleLeft: '切换左侧面板',
    toggleRight: '切换右侧面板',
  },
  // [新增] NodeCanvas相关
  nodeCanvas: {
    title: '校验工程系统',
    createProject: '新建项目',
    openProject: '打开项目',
    focusProject: '聚焦项目',
    organizeNodes: '整理节点',
    organizeNodesInProgress: '整理中...',
    deleteSelected: '删除选中',
    projectName: '项目名称:',
    projectNamePlaceholder: '例如: MyValidationProject',
    folderPath: '文件夹路径:',
    folderPathPlaceholder: '例如: /Users/AirSaiga/Projects',
    create: '新建',
    confirm: '确定',
    cancel: '取消',
    dropHint: {
      default: '释放以创建节点',
      schema: '释放以创建 Schema 节点',
      pattern: '释放以创建 Pattern 节点（也可拖到 Schema 列绑定）',
      constraint: '释放以创建 Constraint 节点（也可拖到 Schema 列添加）',
      projectConfig: '释放以创建 Project Console 节点',
      patternFolder: '释放以创建 Pattern Toolbox 节点',
      constraintFolder: '释放以创建约束看板节点',
      externalData: '释放以创建数据源预览节点',
    },
    schemaNode: '新建 Schema 节点',
    sourcePreviewNode: '新建 数据源预览',
    fieldBindingSuccess: '字段 "{fieldName}" 已成功绑定到 Schema 节点',
    fieldBindingFailed: '绑定失败：找不到源节点或目标节点',
    rightMenu: {
      createSchema: '新建 Schema 节点',
      createSourcePreview: '新建 数据源预览',
    },
    smartFill: {
      title: '智能填充',
      message:
        '检测到从 "{sourceName}" 连接到 "{schemaName}"。\n\n是否要基于数据源自动生成列定义？\n\n提示：这将覆盖当前的 {currentColumnsCount} 个列定义。',
      confirm: '生成',
    },
    smartFix: {
      title: '列定义修正',
      message:
        '数据源 "{sourceName}" 与 "{schemaName}" 的列定义不一致：\n\n{details}\n\n是否执行智能修正？',
      confirm: '智能修正',
      skip: '跳过',
      moreItems: ' 等 {count} 个',
      newInSource: '数据源有 {count} 个新列未在 Schema 中定义（{columns}）',
      staleInSchema: 'Schema 有 {count} 个非衍生列不在数据源中（{columns}）',
    },
    columnMismatch: {
      title: '列名不匹配警告',
      message:
        '当前 Schema 定义了 {schemaCount} 个列，但在数据源中未找到以下 {missingCount} 个列：\n\n{missingColumns}\n\n这可能导致后续的约束校验无法找到对应列。建议检查数据源列名是否正确，或重新生成列定义。',
      confirm: '我知道了',
    },
    constraintsDisconnected: '已断开所有下游约束连接',
    disconnectedOldSource: '已断开与之前数据源的连接，当前数据源: {sourceName}',
    // [新增] 正则连接确认对话框相关
    regexConnectionTitle: '正则表达式连接',
    regexConnectionMessage:
      '已将 "{column}" 列连接到正则校验。是否立即开始校验，还是先编辑正则表达式？',
    regexConnectionHint: '提示：编辑正则时可使用该列的真实数据进行测试',
    validateDirectly: '直接校验',
    editRegex: '编辑正则',
    regexConnectionSuccess: '已将 {column} 列连接到正则 "{regex}" 并完成首次校验',
    connectionFailed: '连接失败',
    connectionSuccess: '已成功将 "{source}" 连接到 "{target}"',
    // JSON Schema 连接相关
    jsonSourceEmpty: 'JSON 数据源为空，无法生成列定义',
    jsonSourceInvalid: 'JSON 数据源格式无效，无法生成列定义',
    jsonColumnsGeneratedSuccess: '成功生成 {count} 个 JSON 列定义！',
    jsonColumnsGenerationFailed: '自动生成 JSON 列定义失败，请手动配置',
    // 通用 Toast 提示
    sourceRefreshSuccess: '数据源已刷新',
    sourceRefreshFailed: '数据源刷新失败',
    columnsGenerated: '成功生成 {count} 个列定义！',
    columnsGenerationFailed: '自动生成列定义失败，请手动配置',
    dataSourceEmpty: '数据源为空，无法生成列定义',
    headerRowMissing: '表头行数据不存在，无法生成列定义',
    schemaNodesUpdated: '已更新 {count} 个Schema节点',
    externalDataAdded: '已新增外部数据：{name}',
    duplicateSourceTitle: '数据源冲突',
    duplicateSourceMessage:
      '数据源 "{source}" 已被其他 Schema 节点使用（{nodes}），请避免重复绑定。',
    duplicateSourceImportMessage:
      '导入的 Schema "{resourceId}" 与已有 Schema 节点使用同一数据源（{nodes}），请检查重复。',
    relatedConstraintsTitle: '发现关联的独立约束',
    relatedConstraintsMessage:
      'Schema "{schema}" 被 {count} 个独立约束引用：{constraints}。是否一并导入并自动连线？',
    relatedConstraintsImportAll: '全部导入',
    relatedConstraintsSchemaOnly: '只导 Schema',
    sheetNotFound: 'Sheet "{sheet}" 不存在于目标文件中，请在 Schema 属性面板中修正工作表名称',
    sheetNotFoundWithList:
      'Sheet "{sheet}" 不存在于目标文件中。文件拥有的工作表: {list}。请在 Schema 属性面板中修正工作表名称',
    nodeTypes: {
      schema: {
        name: '数据表Schema',
        description: '创建数据表Schema定义',
      },
      sourcePreview: {
        name: '数据源预览',
        description: '创建数据源预览卡片',
      },
    },
  },
  // 子画布（SubCanvasModal）
  subCanvas: {
    save: '保存',
    close: '关闭',
    addConstraint: '添加约束',
  },
}

const nodeTypeMenu = {
  title: '节点类型',
  columnDefinition: '列定义节点',
  tableDefinition: '表定义节点',
  schemaNode: '架构节点',
  regexSetNode: '正则表达式集节点',
  constraintRuleNode: '约束规则节点',
  coreComponents: '核心组件',
  projectRoot: '项目根节点',
}

const statusBar = {
  ready: '就绪',
  loading: '加载中...',
  saving: '保存中...',
  error: '错误',
  connected: '已连接',
  disconnected: '已断开连接',
  schema: 'Schema',
  constraint: '约束',
  regex: '正则',
  transforms: '转换节点',
  noProject: '未打开项目',
}

export { canvas }
export { nodeTypeMenu }
export { statusBar }
