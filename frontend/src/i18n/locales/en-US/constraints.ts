/**
 * @file constraints.ts
 * @description 国际化语言包子模块（由 index.ts 拆分生成）
 */

const constraintRuleTypeMenu = {
  title: 'Constraint Rule Type',
  notNull: 'Not Null Constraint',
  unique: 'Unique Constraint',
  foreignKey: 'Foreign Key Constraint',
  allowedValues: 'Allowed Values Constraint',
  scripted: 'Script Constraint',
  conditional: 'Conditional Constraint',
  composite: 'Composite Constraint',
}

const config = {
  schema: {
    title: 'Schema Configuration',
    list: 'Schema List',
    detail: 'Schema Detail',
    add: 'New Schema',
    edit: 'Edit Schema',
    delete: 'Delete Schema',
    columns: 'Column Definitions',
    column: {
      name: 'Column Name',
      type: 'Data Type',
      nullable: 'Nullable',
      primaryKey: 'Primary Key',
      defaultValue: 'Default Value',
    },
  },
  schemaList: {
    tablesTitle: 'Tables / Schemas',
    addTableTooltip: 'Add new table',
    noTablesFound: 'No tables found.',
    clickToAdd: "Click '+' to add one.",
  },
  schemaDetailPanel: {
    configTitle: 'Configuration: {{ tableName }}',
    saveTable: 'Save This Table',
    basicInfo: 'Basic Information',
    scriptChecks: 'Business Logic Checks (Script Checks)',
    sourceFilename: 'Source Filename',
  },
  columnEditor: {
    title: 'Column Editor',
    addColumn: 'Add Column',
    removeColumn: 'Remove Column',
    moveUp: 'Move Up',
    moveDown: 'Move Down',
  },
  columnRow: {
    name: 'Column Name',
    type: 'Type',
    length: 'Length',
    nullable: 'Nullable',
    primaryKey: 'Primary Key',
    autoIncrement: 'Auto Increment',
    defaultValue: 'Default Value',
    comment: 'Comment',
  },
  scriptCheckEditor: {
    title: 'Script Check Editor',
    language: 'Script Language',
    code: 'Script Code',
    test: 'Test',
    save: 'Save',
    cancel: 'Cancel',
  },
  webhookConfig: {
    title: 'Webhook Configuration',
    url: 'Webhook URL',
    method: 'Request Method',
    headers: 'Request Headers',
    body: 'Request Body',
    test: 'Test Connection',
    save: 'Save',
    cancel: 'Cancel',
  },
  patternNode: {
    badgeReadOnly: 'Read Only',
    groups: {
      config: 'Pattern Config',
      regex: 'Regular Expression',
      source: 'Source Info',
      status: 'Validation Status',
    },
    labels: {
      patternName: 'Pattern Name',
      patternType: 'Pattern Type',
      description: 'Description',
      pattern: 'Regular Expression',
      flags: 'Flags',
      caseSensitive: 'Case Sensitive',
      registry: 'Registry Type',
      sourceFile: 'Source File',
      validationStatus: 'Validation Status',
      matchCount: 'Match Count',
      matchRate: 'Match Rate',
    },
    values: {
      caseSensitive: 'Case Sensitive',
      caseInsensitive: 'Case Insensitive',
      matches: 'matches',
    },
    types: {
      atomic: 'Atomic',
      combination: 'Combination',
      unknown: 'Unknown',
    },
    status: {
      pass: 'Pass',
      error: 'Error',
      idle: 'Idle',
    },
  },
  projectRoot: {
    badgeReadOnly: 'Read Only',
    groups: {
      basicInfo: 'Basic Info',
      statistics: 'Statistics',
      quickActions: 'Quick Actions',
    },
    labels: {
      projectName: 'Project Name',
      projectPath: 'Project Path',
      configPath: 'Config Path',
      lastOpenTime: 'Last Open Time',
    },
    stats: {
      schemaCount: 'Schema Count',
      constraintCount: 'Constraint Count',
      regexCount: 'Regex Count',
      passRate: 'Pass Rate',
      errorCount: 'Error Count',
    },
    actions: {
      fullValidation: 'Full Validation',
      export: 'Export Full Config',
      aiGenerate: 'AI Initialize Config',
      reload: 'Reload Project',
      projectManagement: 'Project Management',
      closeProject: 'Close Project',
    },
    confirm: {
      closeProject: 'Are you sure you want to close this project?',
    },
  },
}

const connectionValidation = {
  incompatibleSourceType: 'Source node type does not support this connection',
  incompatibleTargetType: 'Target node type does not support this connection',
  sourceHandleNotAllowed: 'Source handle does not allow this connection',
  targetHandleNotAllowed: 'Target handle does not allow this connection',
  handleMismatch: 'Handle mismatch',
  multipleConnectionsNotAllowed: 'This connection type does not support multiple connections',
  noMatchingRule: 'No matching connection rule found',
  unknownError: 'Connection validation failed',
  selfConnectionNotAllowed: 'Cannot connect to self',
  connectionSuccess: 'Connection successful',
}

const connectionRules = {
  title: 'Connection Rules Configuration',
  save: 'Save',
  reset: 'Reset',
  addRule: 'Add Rule',
  addFirstRule: 'Add First Rule',
  rulesCount: '{count} rules',
  empty: 'No connection rules',
  newRule: 'New Rule',
  ruleId: 'Rule ID',
  ruleName: 'Rule Name',
  sourceEndpoint: 'Source Endpoint',
  targetEndpoint: 'Target Endpoint',
  nodeTypes: 'Node Types',
  handles: 'Handles',
  optional: 'optional',
  handlesPlaceholder: 'Leave empty for no limit, comma-separated for multiple',
  ruleConfig: 'Rule Configuration',
  allowMultiple: 'Allow Multiple Connections',
  validationMode: 'Validation Mode',
  saved: 'Rules saved successfully',
  saveFailed: 'Failed to save rules',
  resetConfirm:
    'Are you sure you want to reset to default rules? Custom rules will be overwritten.',
  resetSuccess: 'Rules reset to defaults',
  resetFailed: 'Reset failed',
  deleteConfirm: 'Are you sure you want to delete this rule?',
}

const connectionModes = {
  strict: 'Strict Mode',
  loose: 'Loose Mode',
}

export { constraintRuleTypeMenu }
export { config }
export { connectionValidation }
export { connectionRules }
export { connectionModes }
