/**
 * @file shortcuts.ts
 * @description 快捷键国际化 - 中文
 */

const shortcuts = {
  // 分类标题
  category: {
    editor: '编辑',
    canvas: '画布',
    node: '节点',
    connection: '连接',
    history: '历史',
    project: '项目',
    help: '帮助',
  },

  // 命令名称
  commands: {
    // 编辑器命令
    save: '保存',
    undo: '撤销',
    redo: '重做',
    copy: '复制',
    cut: '剪切',
    paste: '粘贴',
    selectAll: '全选',
    find: '查找',
    delete: '删除',
    duplicate: '复制节点',

    // 画布命令
    zoomIn: '放大',
    zoomOut: '缩小',
    zoomReset: '重置缩放',
    fitView: '适应视图',
    toggleMinimap: '切换小地图',
    centerView: '居中视图',
    focusProject: '聚焦项目',
    generateSchema: '生成 Schema',
    bindDataSource: '绑定数据源',
    validateNode: '校验节点',

    // 项目命令
    openProjectManagement: '打开项目管理中心',

    // 节点命令
    moveUp: '上移',
    moveDown: '下移',
    moveLeft: '左移',
    moveRight: '右移',
    selectParent: '选择父节点',
    selectChild: '选择子节点',

    // 连接命令
    createConnection: '创建连接',
    deleteConnection: '删除连接',

    // 历史命令
    showHistory: '显示历史',

    // 帮助命令
    showShortcuts: '显示快捷键',
    showHelp: '显示帮助',
  },

  // 操作反馈消息
  feedback: {
    saved: '已保存',
    undone: '已撤销',
    redone: '已重做',
    copied: '已复制',
    cut: '已剪切',
    pasted: '已粘贴',
    deleted: '已删除',
    selected: '已选择',
    moved: '已移动',
    zoomedIn: '已放大',
    zoomedOut: '已缩小',
    zoomReset: '缩放已重置',
    fitView: '视图已适应',
    minimapToggled: '小地图已切换',
    centered: '视图已居中',
    focusProject: '已聚焦到项目起始点',
    notSelected: '请先选择节点',
    notFound: '未找到节点',
    cannotDeleteProjectRoot: '无法删除项目起始点',
    failed: '操作失败',
    nothingToUndo: '没有可撤销的操作',
    nothingToRedo: '没有可重做的操作',
    saveFailed: '保存失败',
    sourceOnly: '仅支持数据源预览节点',
    alreadyConnected: '该数据源已关联 Schema',
    schemaGenerated: '已生成 Schema',
    bindDataSourceSuccess: '已绑定数据源',
    dataSourceNotImported: '该数据源还未导入',
    dataSourceNotConfigured: 'Schema 未配置数据源路径',
    schemaOnly: '仅支持 Schema 节点',
    noColumnsToValidate: '当前 Schema 没有列定义',
    validationNoConstraints: '没有连接的约束',
    validationAllPassed: '校验全部通过',
    validationCompleted: '校验完成',
    validationFailed: '校验失败',
  },

  // 提示信息
  tips: {
    title: '快捷键提示',
    subtitle: '按下快捷键执行相应操作',
    disabled: '快捷键已禁用',
    notAvailable: '当前操作不可用',
    conflict: '快捷键冲突',
    custom: '自定义',
    default: '默认',
    reset: '重置快捷键',
    customize: '自定义快捷键',
  },

  // 设置相关
  settings: {
    title: '快捷键设置',
    description: '自定义键盘快捷键、启用/禁用特定命令，以及管理快捷键冲突。',
    globalTitle: '全局设置',
    enabled: '启用快捷键',
    showFeedback: '显示操作反馈',
    resetAll: '重置所有快捷键',
    export: '导出快捷键配置',
    import: '导入快捷键配置',
    searchPlaceholder: '搜索快捷键...',
    noResults: '未找到相关快捷键',
    resetConfirm: '确定要重置所有快捷键为默认值吗？',
  },

  // 快捷键列表标题
  headers: {
    command: '命令',
    shortcut: '快捷键',
    description: '描述',
    actions: '操作',
  },

  // 修饰键显示名称
  modifiers: {
    ctrl: 'Ctrl',
    meta: 'Cmd',
    shift: 'Shift',
    alt: 'Alt',
  },
}

export default shortcuts
