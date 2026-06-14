/**
 * @file common.ts
 * @description 英文通用翻译词条
 *
 * 功能概述：
 * - 提供应用中英文界面的通用词汇、按钮、对话框文本
 * - 覆盖设置、校验任务、项目管理、数据源等模块的翻译
 */

// Global common vocabulary
const common = {
  // Status information
  loading: 'Loading...',
  error: 'Error',
  success: 'Success',
  warning: 'Warning',
  info: 'Info',
  confirm: 'Confirm',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving...',
  delete: 'Delete',
  edit: 'Edit',
  create: 'Create',
  add: 'Add',
  remove: 'Remove',
  search: 'Search',
  filter: 'Filter',
  reset: 'Reset',
  clear: 'Clear',
  refresh: 'Refresh',
  close: 'Close',
  open: 'Open',
  collapse: 'Collapse',
  expand: 'Expand',
  comingSoon: 'Coming soon',
  export: 'Export',
  import: 'Import',
  back: 'Back',
  next: 'Next',
  previous: 'Previous',
  yes: 'Yes',
  no: 'No',
  notAvailable: 'N/A',

  // Common terms
  name: 'Name',
  description: 'Description',
  type: 'Type',
  status: 'Status',
  date: 'Date',
  time: 'Time',
  id: 'ID',
  version: 'Version',
  enabled: 'Enabled',
  disabled: 'Disabled',
  active: 'Active',
  inactive: 'Inactive',
  required: 'Required',
  optional: 'Optional',
  valid: 'Valid',
  invalid: 'Invalid',
  select: 'Select',
  all: 'All',
  key: 'Key',
  value: 'Value',
  addMapping: '+ Add mapping',
  none: 'None',
  noData: 'No Data',
  unknownError: 'Unknown error',
  fileNotFound: 'File not found',

  // Action buttons
  button: {
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    add: 'Add',
    remove: 'Remove',
    search: 'Search',
    filter: 'Filter',
    reset: 'Reset',
    clear: 'Clear',
    refresh: 'Refresh',
    close: 'Close',
    open: 'Open',
    export: 'Export',
    import: 'Import',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    select: 'Select',
  },

  // Confirmation dialogs
  confirmDialog: {
    title: 'Confirm Action',
    message: 'Are you sure you want to perform this action?',
    deleteMessage: 'Are you sure you want to delete this item? This action cannot be undone.',
    switchProjectMessage:
      'Are you sure you want to switch projects? All unsaved changes will be lost.',
    deleteSchema:
      'Are you sure you want to delete this Schema node? Related data source connections and constraints will also be disconnected/removed.',
    deleteSourcePreview: 'Are you sure you want to delete this data source node?',
    deleteRegex: 'Are you sure you want to delete this Regex node? This cannot be undone.',
    deleteConstraint: 'Are you sure you want to delete this constraint?',
    deleteDefault: 'Are you sure you want to delete this node?',

    // Schema Save Conflicts
    schemaConflict: {
      idDuplicateTitle: 'Schema File Exists',
      idDuplicateMessage:
        'A Schema file already exists in the project: <span class="highlight-path">{filePath}</span><br/>Table Name: <span class="highlight-info">{existingTableName}</span><br/><br/>Current Table Name: <span class="highlight-info">{tableName}</span><br/><br/>Select <b>Overwrite</b> to replace with current configuration, or <b>Cancel</b> to abort.',

      configDiffTitle: 'Schema File Exists',
      configDiffMessage:
        'Schema file already exists with configuration differences:<br/><span class="highlight-path">{filePath}</span>Differences: <span class="highlight-info">{diff}</span><br/><br/>Please select save mode:<ul><li><b>Overwrite</b>: Completely replace the original file with current Schema configuration</li><li><b>Merge</b>: Append new columns and modify existing columns based on original configuration</li></ul>Note: Merge will preserve original constraint configurations.',

      existsTitle: 'Schema File Exists',
      existsMessage:
        'Schema file already exists:<span class="highlight-path">{filePath}</span>Table Name: <span class="highlight-info">{tableName}</span><br/>Select <b>Overwrite</b> to replace with current configuration, or <b>Merge</b> to update existing file.',

      overwrite: 'Overwrite',
      merge: 'Merge',
    },
  },

  // Settings panel
  settings: {
    title: 'General Settings',
    saveError: 'Failed to save settings, please try again later',

    // General settings tab
    startupLoading: {
      label: 'Show loading screen on startup',
      desc: 'Display loading animation when the application starts',
    },

    // Project settings tab
    project: {
      tab: 'Project Settings',
      title: 'Project Validation Settings',
      defaultRunParamsTitle: 'Project Default Run Parameters',
      defaultRunParamsDescription: 'Manage default runtime parameters for task-based validation',
      defaultRunParamsSectionTitle: 'Default Validation Parameters',
      defaultRunParamsHint:
        'These parameters only affect task-based validation such as full/table/file runs. They do not affect instant validation on canvas nodes.',
      validation: {
        title: 'Validation Behavior',
      },
      autoValidate: {
        label: 'Auto Validate',
        desc: 'Automatically run validation when connections or configurations change',
      },
      strictMode: {
        label: 'Strict Mode',
        desc: 'Mark validation as failed if any error is found',
      },
      errorHandling: {
        label: 'Error Handling',
        desc: 'How to handle validation errors',
        stop: 'Stop on first error',
        continue: 'Continue validating others',
        report: 'Record errors and continue',
      },
      timeout: {
        label: 'Validation Timeout',
        desc: 'Maximum execution time for a single validation (seconds)',
      },
      batchLimit: {
        label: 'Batch Limit',
        desc: 'Maximum number of files for batch validation',
      },
    },

    // File processing settings tab
    file: {
      encoding: {
        label: 'Default Encoding',
        desc: 'Character encoding for reading files',
        auto: 'Auto-detect',
      },
      delimiter: {
        label: 'CSV Delimiter',
        desc: 'Field delimiter for CSV files',
        comma: 'Comma',
        semicolon: 'Semicolon',
        tab: 'Tab',
        custom: 'Custom',
        customLabel: 'Custom delimiter',
      },
    },

    // Script settings tab
    script: {
      tab: 'Script Settings',
      todo: 'Coming soon',
      warning: {
        title: 'Security Warning',
        text: 'Script functionality allows executing custom code and may pose security risks. Only execute scripts from trusted sources.',
      },
      enabled: {
        label: 'Enable Script Functionality',
        desc: 'Allow using script definitions in constraints',
      },
      hint: 'Script functionality can be used to implement complex validation logic, but please be aware of security risks.',
      security: {
        title: 'Security Options',
      },
      allowEval: {
        label: 'Allow eval',
        desc: 'Allow executing Python eval() function',
      },
      allowExec: {
        label: 'Allow exec',
        desc: 'Allow executing Python exec() function',
      },
      sandbox: {
        label: 'Sandbox Mode',
        desc: 'Execute scripts in a restricted environment',
      },
      timeout: {
        label: 'Execution Timeout',
        desc: 'Maximum execution time for a single script (seconds)',
      },
    },

    // Update settings tab
    update: {
      tab: 'Check for Updates',
      currentVersion: 'Current Version',
      status: 'Status',
      autoCheck: {
        label: 'Auto Check Updates',
        desc: 'Automatically check for new versions when app starts',
      },
      autoDownload: {
        label: 'Auto Download Updates',
        desc: 'Automatically download update packages when new version is available',
      },
      sourceType: {
        label: 'Update Source Type',
        desc: 'Choose the update server source',
        local: 'Local (for testing)',
        github: 'GitHub Releases',
        custom: 'Custom Server',
      },
      sourceUrl: {
        label: 'Custom Server URL',
        desc: 'Enter custom update server URL',
        placeholder: 'https://updates.example.com',
      },
      checkNow: 'Check for Updates',
      checking: 'Checking...',
      newVersion: 'New Version',
      releaseDate: 'Release Date',
      download: 'Download',
      downloading: 'Downloading...',
      install: 'Install & Restart',
      statusIdle: 'Idle',
      statusChecking: 'Checking',
      statusAvailable: 'Update Available',
      statusNotAvailable: 'Up to Date',
      statusDownloading: 'Downloading',
      statusDownloaded: 'Downloaded',
      statusError: 'Error',
    },

    // AI Assistant Settings Tab
    aiAssistant: {
      tab: 'AI Assistant',
      title: 'AI Assistant Settings',
      desc: 'AI Provider configuration is fully controlled by the local ai_providers.yaml file.',
      // Config file related
      configPath: 'Config File Path',
      openConfigFile: 'Open Config File',
      configTemplate: 'Config Template',
      copied: 'Copied',
      restartRequired: 'Restart the application after modifying the config file.',
      // Provider list
      configuredProviders: 'Configured Providers',
      configured: 'Configured',
      noApiKey: 'No API Key',
      // No provider
      noProvider: 'No AI Provider Configured',
      noProviderHint: 'Please edit the ai_providers.yaml configuration file to add a Provider.',
    },
  },

  fullValidation: {
    entry: 'Validation Task',
    open: 'Open Validation Task Panel',
    title: 'Full Validation',
    openSettings: 'Open Settings',
    task: {
      subtitle:
        'Complete preparation, execution, and result review in one task panel. Future table/file validation will reuse the same model.',
      prepareHint:
        'Confirm the validation target, project context, and preflight checks before execution.',
      runHint:
        'Project defaults are used as the base values, and can be overridden for this run only.',
      resultHint: 'Keep the latest task summary, failed preview, and report entry in one place.',
      sections: {
        prepare: 'Prepare',
        run: 'Run',
        result: 'Result',
      },
      targets: {
        fullProject: 'Full Project',
        singleTable: 'Single Table',
        singleFile: 'Single File',
      },
      scope: {
        title: 'Validation Scope',
        desc: 'This task panel already reserves a unified model for full project, single table, and single file targets. This round implements full project validation first.',
        active: 'Current Entry',
        available: 'Available',
        planned: 'Planned',
        fullProjectDesc:
          'Run a complete validation against the current project configuration, data sources, and constraints.',
        singleTableDesc: 'Validate only one schema/table for quick local verification.',
        singleFileDesc:
          'Future support for running task-based validation against a single input file with the same runtime options.',
        tableSelector: 'Target Table',
        selectTablePlaceholder: 'Select a table to validate',
        singleTableUnavailable:
          'There is no table available for single-table validation in the current project.',
        sourceTypes: {
          csv: 'CSV',
          excel: 'Excel',
          json: 'JSON',
          unknown: 'Unknown',
        },
      },
      context: {
        title: 'Validation Target',
        target: 'Task target',
        tableId: 'Table ID',
        resolvedSource: 'Current data resolution base',
        noProject: 'No active project',
      },
      preflight: {
        title: 'Preflight Checks',
        ready: 'Preflight checks passed. Ready to validate.',
        attention: '{count} item(s) need attention before running.',
        noProject: 'Project context is missing. Validation cannot start.',
        unlistedResources: 'Unmerged resources',
        danglingResources: 'Dangling references',
        resourceSummary: 'Constraints {constraintCount} / Regex {regexCount}',
      },
      defaults: {
        title: 'Project Defaults',
      },
      overrides: {
        title: 'This Run Overrides',
        active:
          'Temporary overrides are active for this run only and will not automatically change project defaults.',
        inheritDefaults:
          'No temporary overrides are set. This run will use project defaults directly.',
      },
      options: {
        saveBeforeRun: 'Save project before running',
        missingResources: 'When unmerged resources are found',
        ask: 'Ask before running',
        mergeThenRun: 'Merge then run',
        runDirectly: 'Run directly',
      },
      stages: {
        title: 'Task Progress',
        loadSettings: 'Load defaults',
        loadSettingsDesc: 'Read the current default runtime parameters from the project.',
        saveProject: 'Save project',
        saveProjectDesc: 'Save the graph and manifest resources before execution.',
        preflight: 'Preflight checks',
        preflightDesc: 'Check unmerged resources and task context availability.',
        execute: 'Run validation',
        executeDesc: 'Call the full validation API and collect the summary.',
      },
      stageStatus: {
        pending: 'Pending',
        running: 'Running',
        success: 'Done',
        error: 'Failed',
        attention: 'Needs attention',
        skipped: 'Skipped',
      },
      resetOverrides: 'Reset to defaults',
      saveProject: 'Save project',
      runNow: 'Run Validation',
      openDefaults: 'Open defaults',
      unsupportedTarget:
        'This version does not support this validation target yet. Please use full project validation.',
      resultPreview: 'Failed Preview',
      emptyResultTitle: 'No validation task has run yet',
      emptyResultDesc:
        'Complete the preparation step to start a task-based validation and review the summary here.',
      noFailedPreview: 'There are no failed items to preview.',
    },
    precheck: {
      constraintsMissingTitle: 'Found constraint files not in manifest',
      constraintsMissingDesc:
        '{count} constraint(s) under constraints/ are not referenced in project.precis.yaml: {ids}',
    },
    mergeConstraints: {
      title: 'Unmerged Resources Found',
      message:
        'Found {constraintCount} constraint(s) and {regexCount} regex node(s) in the project directory that are not referenced in project.precis.yaml.',
      more: '…and {count} more',
      hint: 'Choose "Merge & Validate" to add these resource refs to the manifest, then run full validation.',
      cancel: 'Cancel',
      validateDirectly: 'Validate Directly',
      mergeAndValidate: 'Merge & Validate',
      successTitle: 'Resources Merged',
      successDesc: 'Added {count} resource ref(s) to project.precis.yaml',
    },
    project: {
      title: 'Project Context',
      configPath: 'Project path (configPath)',
      dataPath: 'Data directory (dataPath)',
      useCurrent: 'Use current project',
      apply: 'Apply to current canvas',
      missingConfigPath: 'Please set project path (configPath) first',
      appliedTitle: 'Applied',
      appliedDesc: 'Full validation will use this project context',
      browse: 'Browse to select path',
      selectConfigPath: 'Select project configuration directory',
      selectDataPath: 'Select data directory',
      selectButton: 'Select',
      directorySelectionUnavailable:
        'Directory selection is unavailable, please ensure the application is running correctly',
    },
    settings: {
      title: 'Run Settings (from Settings panel)',
      timeout: 'Timeout',
      strict: 'Strict mode',
      errorHandling: 'Error handling',
      csvEncoding: 'CSV encoding',
      csvDelimiter: 'CSV delimiter',
      allowEval: 'Allow eval',
      hint: 'To change these settings, go to Settings → Project/File Processing/Script and save.',
    },
    run: {
      title: 'Run',
      runOnce: 'Save & validate',
      running: 'Validating…',
      completed: 'Completed',
      completedWithErrors: 'Completed with errors',
      save: 'Save only',
      saveFailed: 'Save failed. Cannot run full validation.',
    },
    result: {
      title: 'Results',
      pass: 'Pass',
      fail: 'Fail',
      total: 'Total errors',
      duration: 'Duration',
      all: 'All',
      loading: 'Loading',
      format: 'Format',
      constraint: 'Constraints',
      regex: 'Regex',
      toastPass: 'No errors found',
      toastFail: 'Errors found. See details.',
      completeSuccess: 'Validation complete. All checks passed.',
      completeWithErrors: 'Validation complete. Errors found.',
      exportHint: 'You can preview the full report or export as HTML/PDF.',
      suggestion: 'Suggestion',
    },
    table: {
      stage: 'Stage',
      location: 'Location',
      type: 'Type',
      message: 'Message',
      row: 'Row',
      table: 'Table',
      column: 'Column',
      errorType: 'Error Type',
      checkType: 'Check Type',
    },
    export: {
      reportFilename: 'DataQualityReport',
      exportReport: 'Export Report',
      exportHtml: 'Export as HTML',
      exportPdf: 'Export as PDF',
      preview: 'Preview Report',
    },
    report: {
      title: 'Data Quality Report',
      projectName: 'Project Name',
      generatedAt: 'Generated At',
      statusPass: '✓ Pass',
      statusFail: 'Fail',
      totalChecks: 'Total Checks',
      passed: 'Passed',
      failed: 'Failed',
      passRate: 'Pass Rate',
      totalFiles: 'Total Files',
      loadedFiles: 'Loaded Files',
      tablesLoaded: 'Tables Loaded',
      loadingErrors: 'Loading Errors',
      formatErrors: 'Format Errors',
      constraintErrors: 'Constraint Errors',
      warnings: 'Warnings',
      duration: 'Duration',
      errorDetails: 'Error Details',
      passedDetails: 'Passed Items Details',
    },
    progress: {
      title: 'Overall Progress',
      processingTable: 'Validating table: {table}',
      errorsFound: 'Errors found: {count}',
    },
    error: {
      navigateToCanvas: 'Navigate to Canvas',
      groupByTable: 'By Table',
      groupByStage: 'By Stage',
      groupByType: 'By Type',
      noGrouping: 'No Grouping',
      searchPlaceholder: 'Search errors...',
    },
    stats: {
      files: 'Files',
      tables: 'Tables',
      errors: 'Errors',
      duration: 'Duration',
    },
  },

  projectManagement: {
    title: 'Project Management',
    createNew: 'Create New Project',
    projectName: 'Project Name',
    projectNamePlaceholder: 'Enter project name',
    projectPath: 'Project Path',
    projectPathPlaceholder: 'Select project directory',
    browse: 'Browse',
    create: 'Create Project',
    openExisting: 'Open Existing Project',
    selectProjectFolder: 'Select Project Folder',
    recentProjects: 'Recent Projects',
    noRecentProjects: 'No recent projects',
    removeFromHistory: 'Remove from history',
    currentProject: 'Current Project',
    unnamed: 'Unnamed Project',
    closeProject: 'Close Project',
    closeWithUnsavedChanges: 'Close Project (Unsaved Changes)',
    switchProject: 'Switch Project',
    openProject: 'Open Project',
    noProject: 'No Project',
    shortcut: 'Open Project Management',
    confirmClose: {
      title: 'Confirm Close',
      message: 'The current project has unsaved changes. Are you sure you want to close?',
      confirm: 'Close Project',
      cancel: 'Cancel',
    },
  },

  dataSources: {
    tab: 'Data Sources',
    title: 'Data Source Configuration',
    desc: 'Configure project data source directories, supporting multiple sources. Full validation will search for data files in these directories in order.',
    id: 'ID',
    idPlaceholder: 'e.g., primary',
    path: 'Path',
    pathPlaceholder: 'Data directory path',
    mode: 'Path Mode',
    relative: 'Relative (to project directory)',
    absolute: 'Absolute',
    description: 'Description',
    descPlaceholder: 'Optional: data source description',
    browse: 'Browse',
    add: 'Add Data Source',
    empty: 'No data sources configured',
    emptyHint: 'Click the button above to add your first data source',
    selectDirectory: 'Select Data Directory',
    directorySelectionUnavailable:
      'Directory selection is unavailable, please ensure the application is running correctly',
    selectError: 'Failed to select directory',
    loadError: 'Failed to load data source configuration',
    saveError: 'Failed to save data source configuration',
    saveSuccess: 'Data source configuration saved',
    errorEmptyId: 'Data source ID cannot be empty',
    errorEmptyPath: 'Data source path cannot be empty',
    errorDuplicateId: 'Data source ID must be unique',
  },

  // Data source file types (global)
  dataSourceFileTypes: {
    csv: 'CSV',
    excel: 'Excel',
    json: 'JSON',
    unknown: 'Unknown',
  },
}

export default common
