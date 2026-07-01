/**
 * @file inspection.ts
 * @description Configuration self-check — English translations
 */
const inspection = {
  title: 'Config Inspection',
  badge: {
    tooltip: '{count} configuration issue(s) found',
    ignoredTooltip: '{count} issue(s) ignored, click to review',
    passedTooltip: 'Configuration check passed, no issues found',
  },
  severity: {
    blocker: 'Blocker',
    warning: 'Warning',
    info: 'Info',
  },
  summary: {
    issuesTitle: '{count} issue(s) found',
    passedTitle: 'Configuration check passed',
    allClear: 'Project configuration is healthy',
    lastCheck: 'Checked at {time}',
  },
  empty: {
    passedTitle: 'Configuration is correct',
    passedDesc: 'No configuration issues found. You are good to go.',
    allIgnoredTitle: 'All issues are ignored',
    allIgnoredDesc: '{count} issue(s) currently ignored. Click below to restore.',
  },
  groupBy: {
    file: 'By file',
    severity: 'By severity',
  },
  action: {
    recheck: 'Re-check',
    expandAll: 'Expand all',
    manageIgnored: 'Manage ignored',
    copyAll: 'Copy all',
    dismiss: 'Ignore this issue',
    dismissShort: 'Ignore',
    dismissAllInGroup: 'Ignore all in this group',
    dismissAllShort: 'Ignore all',
    restore: 'Restore',
    openFile: 'Open file',
  },
  /**
   * Card action labels (mapped from backend action.label_key)
   */
  actions: {
    openFile: 'Open file',
    copyFilePath: 'Copy file path',
    copyId: 'Copy ID',
    dismiss: 'Ignore',
    viewAvailableTables: 'View available tables',
    selectFix: 'Select',
    navigateToNode: 'Navigate to node',
    autoFix: {
      deduplicate: 'Auto deduplicate',
    },
  },
  context: {
    availableSchemas: 'Pick a table to use',
    availableColumns: 'Pick a column to use',
  },
  /** Neutral label used to replace a raw id when it is machine-generated (UUID/encoded) */
  machineIdLabel: {
    table: 'a deleted table',
    column: 'a deleted column',
  },
  rawDetails: 'Show raw details',
  errorType: 'Error type',
  filePath: 'File path',
  copyAll: {
    file: 'File',
    refId: 'Resource ID',
  },
  unknownFile: '(unknown file)',
  errors: {
    noProject: 'No project path set',
    noFixApi: 'Auto-fix not supported for this issue',
    nodeNotFound: 'This node is not on the canvas yet — drag it in from the resource tree first',
  },
  toast: {
    recheckDone: 'Check done: {count} issue(s)',
    recheckFailed: 'Re-check failed',
    copied: 'Copied to clipboard',
    pathCopied: 'File path copied',
    allCopied: '{count} issue(s) copied as Markdown',
    nothingToCopy: 'Nothing to copy',
    fixDone: 'Fixed',
    fixFailed: 'Fix failed',
  },
  ignoredManager: {
    title: 'Manage ignored issues',
    empty: 'No ignored issues',
    clearAll: 'Clear all ignored',
  },
  /**
   * Localized text for each kind of configuration issue.
   * Placeholders correspond to backend message_params:
   *   - manifestId / fileId / filePath / manifestDisplay / fileDisplay (ID mismatch)
   *   - constraintId / tableId / columnId (foreign key / generic reference)
   */
  issues: {
    /** Fallback title when title is completely missing */
    untitled: 'Configuration problem',
    /** ID mismatch: the name recorded in the project config doesn't match the file */
    idMismatch: {
      schema: {
        title: 'Table name mismatch',
        description:
          'The project config records this table as "{fileDisplay}", but the file itself is named "{manifestDisplay}". The mismatch may break other references to this table.',
        fixHint: 'Click "Auto fix" to make both sides match.',
      },
      constraint: {
        title: 'Rule name mismatch',
        description:
          'The project config records this rule as "{fileDisplay}", but the rule file is named "{manifestDisplay}". The mismatch may stop this rule from working.',
        fixHint: 'Click "Auto fix" to make both sides match.',
      },
      regex: {
        title: 'Regex rule name mismatch',
        description:
          'The project config records this regex as "{fileDisplay}", but the file is named "{manifestDisplay}". The mismatch may stop this rule from working.',
        fixHint: 'Click "Auto fix" to make both sides match.',
      },
      transform: {
        title: 'Transform name mismatch',
        description:
          'The project config records this transform as "{fileDisplay}", but the file is named "{manifestDisplay}". The mismatch may stop it from working.',
        fixHint: 'Click "Auto fix" to make both sides match.',
      },
    },
    /** The same rule is registered twice in the project config */
    dupConstraintRef: {
      title: 'A rule is registered twice',
      description:
        'The rule file "{filePath}" appears twice in the project config, and one entry ({manifestDisplay}) does not match the file\'s name ({fileDisplay}). The duplicate will cause a conflict.',
      fixHint: 'Click "Auto fix" to remove the redundant entry.',
    },
    /** A foreign key references a table/column that no longer exists */
    fk: {
      srcTableMissing: {
        title: 'Foreign key source table is missing',
        description:
          '{constraintDisplay} reads data from table "{tableId}", but this table may have been deleted or renamed.',
        fixHint: 'Pick an existing table below as the source.',
      },
      srcColMissing: {
        title: 'Foreign key source column is missing',
        description:
          '{constraintDisplay} reads column "{columnId}" of table "{tableId}", but this column no longer exists.',
        fixHint: 'Pick an existing column below as the source.',
      },
      dstTableMissing: {
        title: 'Foreign key target table is missing',
        description:
          '{constraintDisplay} points to table "{tableId}", but this table may have been deleted or renamed.',
        fixHint: 'Pick an existing table below as the target.',
      },
      dstColMissing: {
        title: 'Foreign key target column is missing',
        description:
          '{constraintDisplay} points to column "{columnId}" of table "{tableId}", but this column no longer exists.',
        fixHint: 'Pick an existing column below as the target.',
      },
    },
    /** A normal rule references a table/column that no longer exists */
    ref: {
      tableMissing: {
        title: 'The table used by this rule is missing',
        description:
          '{constraintDisplay} uses table "{tableId}", but this table may have been deleted or renamed.',
        fixHint: 'Pick an existing table below.',
      },
      colMissing: {
        title: 'The column used by this rule is missing',
        description:
          '{constraintDisplay} uses column "{columnId}" of table "{tableId}", but this column no longer exists.',
        fixHint: 'Pick an existing column below.',
      },
    },
    /** A regex rule references a table/column that no longer exists */
    regex: {
      tableMissing: {
        title: 'The table used by this regex rule is missing',
        description:
          '{regexDisplay} uses table "{tableId}", but this table may have been deleted or renamed.',
        fixHint: 'Pick an existing table below.',
      },
      colMissing: {
        title: 'The column used by this regex rule is missing',
        description:
          '{regexDisplay} uses column "{columnId}" of table "{tableId}", but this column no longer exists.',
        fixHint: 'Pick an existing column below.',
      },
    },
    saveBlocked: {
      title: 'Cannot save right now',
      description: '{description}',
      fixHint: 'Please check the node configuration on the canvas',
      fixHintWithField: 'Please check field "{field}" of node "{nodeId}"',
    },
    /**
     * Load-time errors (file not found / parse error / path issue / template expansion failure)
     * Placeholders: resourceLabel (localized resource type), refId (reference id), filename, instanceId (template instance id)
     */
    load: {
      pathValidation: {
        title: '{resourceLabel} has a path problem',
        description:
          'The path to "{resourceLabel}" ({refId}) in the project config cannot be accessed. It may be wrong, or point outside the project folder.',
        fixHint: 'Check the resource path and make sure it points to a file inside the project.',
      },
      notFound: {
        title: '{resourceLabel} file is missing',
        description:
          'The file for "{resourceLabel}" ({refId}) — "{filename}" — does not exist. It may have been moved, deleted, or renamed.',
        fixHint:
          'Confirm the file still exists, or remove this stale reference from the project config.',
      },
      parseError: {
        title: '{resourceLabel} file has a format problem',
        description:
          'The file for "{resourceLabel}" ({refId}) could not be parsed — usually a YAML syntax error or a missing required field.',
        fixHint:
          'Open the file and check indentation and required fields, referencing other configs of the same type.',
      },
      templateExpansion: {
        title: 'Template could not be expanded',
        description:
          'A template on the canvas ({instanceId}) failed to expand into rules. The params may be incomplete or the template definition is wrong.',
        fixHint:
          'Check the template params and referenced columns/tables, or delete and recreate it.',
      },
    },
    /** Multiple tables share the same name */
    schemaIdDuplicate: {
      title: 'Tables share the same name',
      description:
        'The table name "{schemaId}" is used by {count} tables. Other rules can get confused when looking up a table by name, so each name must be unique.',
      fixHint:
        'Rename one of the tables to something unique (click "Navigate to node" to jump and edit).',
    },
    /** Multiple tables point to the same data file */
    sourceDuplicate: {
      title: 'Tables point to the same data file',
      description:
        'The data file "{sourceDisplay}" is defined by {count} tables ({schemas}). A data file can only be defined by one table, otherwise reads will conflict.',
      fixHint:
        'Keep only one table and delete or change the others (click "Navigate to node" to jump and handle).',
    },
  },
}

export default inspection
