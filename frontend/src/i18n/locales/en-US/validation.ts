/**
 * @file validation.ts
 * @description Validation/error message i18n (key-based text)
 *
 * Services/validators return these keys; the UI layer resolves them via
 * renderText(t, key, fallback, params). Namespaces: validation.save.* (pre-save),
 * validation.notNull.* (not-null row errors), etc.
 */

const validation = {
  // Validation stats mini-card labels
  stats: {
    files: 'Files',
    tables: 'Tables',
    errors: 'Errors',
    duration: 'Time',
  },
  // Error filter bar
  filter: {
    groupLabel: 'Group by',
    groupByTable: 'By table',
    groupByStage: 'By stage',
    groupByType: 'By type',
    groupByNone: 'No grouping',
    searchPlaceholder: 'Search errors...',
  },
  // Validation settings grid units
  settings: {
    unitSeconds: 's',
    unitFiles: 'files',
  },
  // JSON data tree / source preview
  json: {
    searchFieldPlaceholder: 'Search fields...',
    typeMismatchSummary: '{count} field type(s) do not match the Schema definition',
    viewDetails: 'View',
  },
  // Source preview (header row hints)
  source: {
    currentHeaderRow: 'Current header row',
    clickToSetHeaderRow: 'Click to set as header row',
  },
  // Validation summary (key-based text for getValidationSummary, for callers rendering by locale)
  summary: {
    pass: 'Validation passed',
    errors: '{count} error(s)',
    warnings: '{count} warning(s)',
  },
  // Pre-save validation (preValidator)
  save: {
    schemaMissingSource: 'Schema is missing the data source path',
    schemaNoColumns: 'Schema defines no columns',
    columnMissingId: 'Column {index} is missing an ID, suggested: {suggestedId}',
    columnMissingName: 'Column {index} is missing a name, suggested: {suggestedName}',
    columnMissingType: 'Column "{column}" has no data type specified; defaulting to Str',
    columnIdDuplicate: 'Duplicate column ID: {oldId}, fixed to: {newId}',
    columnNameDuplicate: 'Duplicate column name: {oldName}, fixed to: {newName}',
    constraintMissingTableId: 'Constraint {type} is missing the table_id reference',
    constraintSchemaNotInPlan:
      'The schema {tableId} referenced by the constraint is not in the current save plan',
    foreignKeyMissingTableRefs: 'ForeignKey constraint is missing from_table_id or to_table_id',
    foreignKeyMissingColumnRefs: 'ForeignKey constraint is missing from_column_id or to_column_id',
    foreignKeySelfReference:
      'ForeignKey self-reference (from and to point to the same column); please confirm this is intended',
    rangeMinGreaterThanMax:
      'Range constraint min ({min}) is greater than max ({max}); automatically swapped',
    allowedValuesEmpty: 'AllowedValues constraint has no allowed values configured',
    scriptedExpressionEmpty: 'Scripted constraint expression is empty',
    compositeNoSubConstraints: 'Composite constraint contains no sub-constraints',
    compositeSelfReference: 'Composite constraint cannot contain itself (circular reference)',
    compositeSubConstraintMissingId: 'Composite contains a sub-constraint missing an ID',
    regexMissingPattern: 'Regex node must configure pattern or uses_pattern',
    regexSyntaxInvalid: 'Invalid regex syntax: {pattern}',
    regexSchemaNotInPlan:
      'The schema {tableId} referenced by the regex is not in the current save plan',
    transformNoOutputColumns: 'Transform has no output columns configured',
    transformInputNotInSchemas:
      'The input node {nodeId} referenced by the transform is not in the current schema set (may be a transform chain reference)',
    templateInstanceMissingId: 'TemplateInstance is missing template_id',
  },
  // Not-null constraint (row errors)
  notNull: {
    valueEmpty: 'Value cannot be empty',
    rowEmpty: 'Row {row}: value cannot be empty',
    requestFailed: 'Not-null validation failed',
  },
  // Unique constraint
  unique: {
    valueNotUnique: 'Value must be unique',
    rowNotUnique: 'Row {row}: value must be unique',
    requestFailed: 'Uniqueness validation failed',
  },
  // JSON Schema column-definition validation
  column: {
    idEmpty: 'Column ID cannot be empty',
    nameInvalid:
      'Column name is invalid (only letters, digits, and underscores; cannot start with a digit; max length 50)',
    jsonPathInvalid: 'JSONPath format is invalid (must start with $)',
    dataTypeEmpty: 'Data type cannot be empty',
    uniqueAndNotNull: 'Unique and not-null constraints can both be set',
    allowedValuesEmpty: 'Allowed values list cannot be empty',
    arrayItemTypeMissing: 'Array type must specify an element type',
    columnsEmpty: 'Column definitions cannot be empty',
    nameDuplicate: 'Column name "{name}" is duplicated',
    idDuplicate: 'Column ID "{id}" is duplicated',
    jsonPathDuplicate: 'JSONPath "{path}" is duplicated',
    nestedPathDuplicate: 'Nested path "{path}" is duplicated',
  },
}

export { validation }
