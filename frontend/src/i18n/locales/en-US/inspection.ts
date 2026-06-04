/**
 * @file inspection.ts
 * @description Configuration self-check — English translations
 */
const inspection = {
  title: 'Config Inspection',
  badge: {
    tooltip: '{count} configuration issue(s) found',
    ignoredTooltip: '{count} issue(s) ignored, click to review',
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
    autoFix: {
      deduplicate: 'Auto deduplicate',
    },
  },
  context: {
    availableSchemas: 'Available tables in the project',
    availableColumns: 'Available columns',
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
   *   - manifestId / fileId / filePath (ID mismatch)
   *   - constraintId / tableId / columnId (foreign key / generic reference)
   */
  issues: {
    idMismatch: {
      schema: {
        title: 'Table ID does not match the project manifest',
        description:
          'The project manifest registers this table as "{manifestId}", but the file itself has ID "{fileId}". This may break other references to this table.',
        fixHint: 'Update the manifest to match the file, or change the file ID to match the manifest.',
      },
      constraint: {
        title: 'Constraint ID does not match the project manifest',
        description:
          'The project manifest registers this constraint as "{manifestId}", but the file itself has ID "{fileId}". This may prevent the rule from being referenced correctly.',
        fixHint: 'Update the manifest to match the file, or change the file ID to match the manifest.',
      },
      regex: {
        title: 'Regex rule ID does not match the project manifest',
        description:
          'The project manifest registers this regex rule as "{manifestId}", but the file itself has ID "{fileId}". This may prevent the rule from being referenced correctly.',
        fixHint: 'Update the manifest to match the file, or change the file ID to match the manifest.',
      },
      transform: {
        title: 'Data transform ID does not match the project manifest',
        description:
          'The project manifest registers this transform as "{manifestId}", but the file itself has ID "{fileId}". This may prevent the transform from being referenced correctly.',
        fixHint: 'Update the manifest to match the file, or change the file ID to match the manifest.',
      },
    },
    dupConstraintRef: {
      title: 'A constraint is referenced multiple times',
      description:
        'The project manifest lists the same constraint file "{filePath}" twice, and one of the entries uses ID "{manifestId}" which does not match the file\'s actual ID "{fileId}". This will load the rule twice and may cause conflicts.',
      fixHint: 'Click "Auto deduplicate" to clean up (recommended), or manually remove the redundant entry from the manifest.',
    },
    fk: {
      srcTableMissing: {
        title: 'Foreign key source table not found',
        description:
          'Foreign key rule "{constraintId}" tries to read data from source table "{tableId}", but this table no longer exists in the project (it may have been deleted or renamed).',
        fixHint: 'Pick one from "Available tables in the project" below as the source table.',
      },
      srcColMissing: {
        title: 'Foreign key source column not found',
        description:
          'Foreign key rule "{constraintId}" tries to read column "{columnId}" of source table "{tableId}", but this column no longer exists.',
        fixHint: 'Pick one from "Available columns" below as the source column.',
      },
      dstTableMissing: {
        title: 'Foreign key target table not found',
        description:
          'Foreign key rule "{constraintId}" references target table "{tableId}", but this table no longer exists in the project (it may have been deleted or renamed).',
        fixHint: 'Pick one from "Available tables in the project" below as the target table.',
      },
      dstColMissing: {
        title: 'Foreign key target column not found',
        description:
          'Foreign key rule "{constraintId}" references column "{columnId}" of target table "{tableId}", but this column no longer exists.',
        fixHint: 'Pick one from "Available columns" below as the target column.',
      },
    },
    ref: {
      tableMissing: {
        title: 'The table referenced by this rule no longer exists',
        description:
          'Rule "{constraintId}" references table "{tableId}", but this table no longer exists in the project (it may have been deleted or renamed).',
        fixHint: 'Pick one from "Available tables in the project" below as the referenced table.',
      },
      colMissing: {
        title: 'The column referenced by this rule no longer exists',
        description:
          'Rule "{constraintId}" references column "{columnId}" of table "{tableId}", but this column no longer exists.',
        fixHint: 'Pick one from "Available columns" below as the referenced column.',
      },
    },
  },
}

export default inspection
