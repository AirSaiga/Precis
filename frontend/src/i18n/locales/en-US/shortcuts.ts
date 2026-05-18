/**
 * @file shortcuts.ts
 * @description Keyboard shortcuts internationalization - English
 */

const shortcuts = {
  // Category titles
  category: {
    editor: 'Editor',
    canvas: 'Canvas',
    node: 'Node',
    connection: 'Connection',
    history: 'History',
    project: 'Project',
    help: 'Help',
  },

  // Command names
  commands: {
    // Editor commands
    save: 'Save',
    undo: 'Undo',
    redo: 'Redo',
    copy: 'Copy',
    cut: 'Cut',
    paste: 'Paste',
    selectAll: 'Select All',
    find: 'Find',
    delete: 'Delete',
    duplicate: 'Duplicate',

    // Canvas commands
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    zoomReset: 'Reset Zoom',
    fitView: 'Fit View',
    toggleMinimap: 'Toggle Minimap',
    centerView: 'Center View',
    focusProject: 'Focus Project',
    generateSchema: 'Generate Schema',
    bindDataSource: 'Bind Data Source',
    validateNode: 'Validate Node',

    // Project commands
    openProjectManagement: 'Open Project Management',

    // Node commands
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    moveLeft: 'Move Left',
    moveRight: 'Move Right',
    selectParent: 'Select Parent',
    selectChild: 'Select Child',

    // Connection commands
    createConnection: 'Create Connection',
    deleteConnection: 'Delete Connection',

    // History commands
    showHistory: 'Show History',

    // Help commands
    showShortcuts: 'Show Shortcuts',
    showHelp: 'Show Help',
  },

  // Action feedback messages
  feedback: {
    saved: 'Saved',
    undone: 'Undone',
    redone: 'Redone',
    copied: 'Copied',
    cut: 'Cut',
    pasted: 'Pasted',
    deleted: 'Deleted',
    selected: 'Selected',
    moved: 'Moved',
    zoomedIn: 'Zoomed in',
    zoomedOut: 'Zoomed out',
    zoomReset: 'Zoom reset',
    fitView: 'View fitted',
    minimapToggled: 'Minimap toggled',
    centered: 'View centered',
    focusProject: 'Focused to project start',
    notSelected: 'Please select a node first',
    notFound: 'Node not found',
    cannotDeleteProjectRoot: 'Cannot delete project root',
    failed: 'Operation failed',
    nothingToUndo: 'Nothing to undo',
    nothingToRedo: 'Nothing to redo',
    saveFailed: 'Save failed',
    sourceOnly: 'Only source preview node is supported',
    alreadyConnected: 'This source is already connected to a schema',
    schemaGenerated: 'Schema generated',
    bindDataSourceSuccess: 'Data source bound',
    dataSourceNotImported: 'Data source not yet imported',
    dataSourceNotConfigured: 'Schema has no data source configured',
    schemaOnly: 'Only Schema nodes are supported',
    noColumnsToValidate: 'Current Schema has no column definitions',
    validationNoConstraints: 'No connected constraints',
    validationAllPassed: 'All validations passed',
    validationCompleted: 'Validation completed',
    validationFailed: 'Validation failed',
  },

  // Tips
  tips: {
    title: 'Keyboard Shortcuts',
    subtitle: 'Press shortcut keys to perform actions',
    disabled: 'Shortcuts are disabled',
    notAvailable: 'Action not available',
    conflict: 'Shortcut conflict',
    custom: 'Custom',
    default: 'Default',
    reset: 'Reset Shortcut',
    customize: 'Customize Shortcut',
  },

  // Settings
  settings: {
    title: 'Keyboard Shortcuts Settings',
    description:
      'Customize keyboard shortcuts, enable/disable specific commands, and manage shortcut conflicts.',
    enabled: 'Enable shortcuts',
    showFeedback: 'Show action feedback',
    resetAll: 'Reset all shortcuts',
    export: 'Export shortcuts config',
    import: 'Import shortcuts config',
    searchPlaceholder: 'Search shortcuts...',
    noResults: 'No shortcuts found',
    resetConfirm: 'Are you sure you want to reset all shortcuts to default?',
  },

  // Table headers
  headers: {
    command: 'Command',
    shortcut: 'Shortcut',
    description: 'Description',
    actions: 'Actions',
  },

  // Modifier key display names
  modifiers: {
    ctrl: 'Ctrl',
    meta: 'Cmd',
    shift: 'Shift',
    alt: 'Alt',
  },
}

export default shortcuts
