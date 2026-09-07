/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
    backToParent: 'Back to parent',
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
  // Error/check type codes → user-readable labels (referenced dynamically via
  // validationErrorTypeLabel; unregistered codes fall back to the raw code)
  errorTypes: {
    DataLoad: 'Data loading',
    DataLoadingError: 'Data loading failed',
    SchemaIdDuplicate: 'Duplicate schema ID',
    RegexViolation: 'Regex mismatch',
    RegexExecutionError: 'Regex execution error',
    TransformExecutionError: 'Transform execution error',
    ConstraintConfigError: 'Invalid constraint config',
    ScriptCheckExecutionError: 'Script execution error',
    Timeout: 'Validation timed out',
  },
  // Pre-save validation (preValidator)
  save: {
    schemaMissingSource:
      'This table has no data file source yet: open the table node and choose the file to read',
    schemaNoColumns: 'This table has no columns defined yet',
    columnMissingId: 'Column {index} is missing an ID; "{suggestedId}" will be used on save',
    columnMissingName: 'Column {index} is missing a name; "{suggestedName}" will be used on save',
    columnMissingType:
      'Column "{column}" has no data type; it will be treated as text (Str) automatically',
    columnIdDuplicate: 'Column ID "{oldId}" is duplicated; it has been renamed to "{newId}"',
    columnNameDuplicate:
      'Column name "{oldName}" is duplicated; it has been renamed to "{newName}"',
    constraintMissingTableId:
      'This {type} constraint is not connected to any table: connect the constraint node to the table it should validate, then save again',
    constraintSchemaNotInPlan:
      'The table "{tableId}" of this constraint no longer exists (it may have been deleted); reconnect the constraint to a table or remove it',
    foreignKeyMissingTableRefs:
      'This foreign key is not connected to both tables yet: check that it links the current table and the referenced table',
    foreignKeyMissingColumnRefs:
      'This foreign key has no columns selected yet: check that the columns are chosen on both ends',
    foreignKeySelfReference:
      'This foreign key starts and ends at the same column — if the self-reference is intentional, you can ignore this reminder',
    rangeMinGreaterThanMax:
      'The minimum ({min}) of this range is greater than its maximum ({max}); they have been swapped automatically',
    allowedValuesEmpty:
      'This allowed-values constraint has no values configured yet; add at least one',
    scriptedExpressionEmpty: 'This scripted constraint has no validation script yet',
    compositeNoSubConstraints:
      'This composite constraint has no sub-constraints yet; add at least one',
    compositeSelfReference:
      'A composite constraint cannot contain itself (that would be a circular reference)',
    compositeSubConstraintMissingId: 'One sub-constraint in this composite is missing an ID',
    regexMissingPattern: 'This regex node has no match rule yet',
    regexSyntaxInvalid:
      'The regex cannot be parsed: "{pattern}". Common causes: unbalanced parentheses, or an invalid group name (group names cannot be plain numbers, e.g. (?P<1>…)',
    regexSyntaxInvalidDetail:
      'The regex cannot be parsed: "{pattern}" ({detail}). Common causes: unbalanced parentheses, or an invalid group name (group names cannot be plain numbers, e.g. (?P<1>…)',
    regexSchemaNotInPlan:
      'The table "{tableId}" of this regex node no longer exists (it may have been deleted); reconnect it to a table or remove it',
    transformNoOutputColumns: 'This transform has no output columns configured yet',
    transformInputNotInSchemas:
      'The input node "{nodeId}" of this transform is not a saved table; if transforms are chained, you can ignore this notice',
    templateInstanceMissingId:
      'This template instance has no template selected yet; please choose a template',
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
  errorGroups: {
    allErrors: 'All errors',
    unknownTable: 'Unknown table',
    unknownType: 'Unknown type',
  },
}

export { validation }
