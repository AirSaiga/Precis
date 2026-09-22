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
    rangeMissingBounds:
      'This Range constraint has no bounds at all — fill in at least one of min/max before saving. Missing template params no longer default to 0..100',
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
    requestFailed: 'Not-null validation request failed: {detail}',
  },
  // Unique constraint
  unique: {
    valueNotUnique: 'Value must be unique',
    rowNotUnique: 'Row {row}: value must be unique',
    requestFailed: 'Uniqueness validation request failed: {detail}',
  },
  // Row-level error row prefix (composed by renderLocalizedMessage: row + body); body rendered via its own key
  rowError: 'Row {row}: {message}',
  // Per-kind "validation request failed" texts (backend business failure success:false; detail carries the raw backend error)
  range: { requestFailed: 'Range validation request failed: {detail}' },
  foreignKey: { requestFailed: 'Foreign-key validation request failed: {detail}' },
  allowedValues: { requestFailed: 'Allowed-values validation request failed: {detail}' },
  conditional: { requestFailed: 'Conditional validation request failed: {detail}' },
  scripted: { requestFailed: 'Scripted validation request failed: {detail}' },
  charset: { requestFailed: 'Charset validation request failed: {detail}' },
  dateLogic: { requestFailed: 'Date-logic validation request failed: {detail}' },
  composite: { requestFailed: 'Composite validation request failed: {detail}' },
  // Stable error codes → user-readable texts (shared namespace for backend error_code and
  // client-side pre-checks). Frontend resolves validation.codes.<CODE> dynamically; unregistered
  // codes fall back to the raw backend message.
  codes: {
    // —— Generic / pre-checks ——
    COLUMN_NOT_FOUND: "Column '{column}' does not exist",
    PARAM_REQUIRED: "Parameter '{param}' cannot be empty",
    CONFIG_INCOMPLETE: 'Validation configuration is incomplete',
    VALIDATION_UNSUPPORTED_TYPE: 'Unsupported validation type: {validation_type}',
    VALIDATION_EXECUTION_FAILED: 'Validation execution failed: {detail}',
    // —— Range ——
    RANGE_NO_BOUNDS: 'No bounds configured (fill in at least one of min/max)',
    RANGE_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    RANGE_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    RANGE_COLUMN_NOT_NUMERIC:
      "Column '{column}' is not numeric. Range validation requires a numeric field (no implicit string-to-number conversion)",
    RANGE_VALUE_OUT_OF_RANGE: 'Value {value} is outside the allowed range {bounds}',
    RANGE_VALUE_BELOW_MIN: 'Value {value} violates {op} {min}',
    RANGE_VALUE_ABOVE_MAX: 'Value {value} violates {op} {max}',
    // —— NotNull ——
    NOT_NULL_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    NOT_NULL_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    NOT_NULL_VALUE_EMPTY: 'Value cannot be empty',
    // —— Unique ——
    UNIQUE_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    UNIQUE_CONFIG_NO_COLUMNS: 'No validation columns configured',
    UNIQUE_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    UNIQUE_VALUE_DUPLICATED: "Value '{value}' is duplicated in column(s) '{columns}'",
    // —— Charset ——
    CHARSET_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    CHARSET_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    CHARSET_INVALID_MODE: "Unknown charset mode '{charset_mode}'. Supported modes: {valid_modes}",
    CHARSET_INVALID_CHARACTER:
      "Value '{value}' contains characters outside the '{charset_name}' character set",
    // —— Regex ——
    REGEX_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    REGEX_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    REGEX_PATTERN_EMPTY: 'Pattern is empty: no regex provided',
    REGEX_INVALID_MATCH_MODE: "Unknown match mode '{match_mode}'. Supported values: {valid_modes}",
    REGEX_VIOLATION: "Value '{value}' does not match the regex pattern",
    REGEX_EXECUTION_ERROR: 'Validation error: {value} ({error_detail})',
    REGEX_PATTERN_SYNTAX_ERROR: 'Regex syntax error: {pattern} ({error_detail})',
    // —— AllowedValues ——
    ALLOWED_VALUES_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    ALLOWED_VALUES_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    ALLOWED_VALUES_NOT_PERMITTED: "Value '{value}' is not in the allowed list {allowed}",
    ALLOWED_VALUES_EMPTY: 'Configure the allowed-values list before validating',
    // —— Conditional ——
    CONDITIONAL_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    CONDITIONAL_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    CONDITIONAL_REF_COLUMN_NOT_FOUND:
      "Reference column '{column}' does not exist in table '{table}'",
    CONDITIONAL_THEN_THRESHOLD_NOT_NUMERIC:
      "The THEN operator '{operator}' requires a numeric threshold, got '{threshold}'; use the DateLogic constraint for date comparison",
    CONDITIONAL_UNKNOWN_IF_LOGIC: "Unknown IF logic '{if_logic}'",
    CONDITIONAL_IF_COLUMN_NOT_FOUND: "IF column '{column}' does not exist in table '{table}'",
    CONDITIONAL_INVALID_IF_CONDITION: 'Invalid IF condition: {detail}',
    CONDITIONAL_IF_VALUE_MISSING: "No comparison value configured for IF column '{if_column}'",
    CONDITIONAL_TIMEOUT:
      'Conditional validation timed out after processing {processed}/{total} rows',
    CONDITIONAL_THEN_VIOLATION:
      "When the condition is met, value '{value}' of column '{column}' does not satisfy the requirement ({condition})",
    CONDITIONAL_IF_NOT_CONFIGURED:
      'No IF condition configured: connect an IF column or enable "trigger without condition"',
    CONDITIONAL_IF_THEN_COLUMN_MISSING: 'IF/THEN column does not exist or has been deleted',
    // —— ForeignKey ——
    FK_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    FK_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    FK_VIOLATION:
      "Value '{value}' does not exist in column '{to_column}' of target table '{to_table}'",
    FK_TARGET_NOT_SELECTED: 'Select a target column before validating',
    FK_TARGET_UNAVAILABLE:
      'The target table has no usable data source or the target column does not exist; reference values cannot be extracted',
    // —— Scripted ——
    SCRIPTED_PERMISSION_DENIED:
      'Scripted constraint "{name}" was skipped: "Allow script execution (eval)" is not enabled in project settings',
    SCRIPTED_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    SCRIPTED_TIMEOUT:
      "Scripted constraint '{name}' timed out: {processed} rows processed, {remaining} rows not validated",
    SCRIPTED_NON_BOOL_RESULT:
      "The expression of rule '{name}' did not return a boolean (True/False); it returned {result_type}",
    SCRIPTED_VIOLATION: "Business logic check failed: '{name}'",
    SCRIPTED_EXECUTION_ERROR:
      "Error while executing rule '{name}'; check the expression syntax or data types ({detail})",
    SCRIPTED_NO_SCRIPT: 'Configure the script before validating',
    // —— DateLogic ——
    DATE_LOGIC_TABLE_NOT_FOUND: "Table '{table}' is not in the dataset",
    DATE_LOGIC_COLUMN_NOT_FOUND: "Column '{column}' does not exist in table '{table}'",
    DATE_LOGIC_REF_COLUMN_NOT_FOUND: "Reference column '{column}' does not exist",
    DATE_LOGIC_INVALID_REF_DATE: "Invalid reference date '{reference_date}'",
    DATE_LOGIC_UNKNOWN_MODE:
      "Unknown logic_mode '{logic_mode}'. Supported modes: compare, calculation",
    DATE_LOGIC_INVALID_DATE_VALUE: "Value '{value}' cannot be parsed as a date",
    DATE_LOGIC_RANGE_BOUNDARY_MISMATCH:
      'Range mode requires both a start and an end of the same kind (both fixed dates or both column references)',
    DATE_LOGIC_RANGE_MISSING_END:
      'Range mode requires an end boundary (reference_date_end or reference_column_end)',
    DATE_LOGIC_RANGE_VIOLATION: 'Date {value} is outside the range [{start}, {end}]',
    DATE_LOGIC_MISSING_REFERENCE: 'Compare mode requires reference_column or reference_date',
    DATE_LOGIC_UNSUPPORTED_OP:
      "Unsupported comparison operator '{compare_op}'. Supported: {valid_ops}",
    DATE_LOGIC_COMPARE_VIOLATION: 'Date {value} should be {op} {reference}',
    DATE_LOGIC_AGE_VIOLATION:
      'Age check failed: {value} (age {age}) does not satisfy {op} {target}',
    DATE_LOGIC_TARGET_NOT_NUMERIC:
      'Target value "{target_value}" cannot be converted to a number; check the constraint config ({detail})',
    DATE_LOGIC_MISSING_TARGET: 'calculation_type={calculation_type} requires target_value',
    DATE_LOGIC_MISSING_TARGET_COLUMN:
      'calculation_type=days_diff requires target_column (the reference column)',
    DATE_LOGIC_UNKNOWN_CALCULATION_TYPE:
      "Unknown calculation_type '{calculation_type}'. Supported types: age, days_diff",
    DATE_LOGIC_DAYS_DIFF_VIOLATION:
      'Day difference mismatch: {value} vs {reference}; expected {op} {expected} days, got {actual} days',
    // —— Composite ——
    COMPOSITE_ANY_ALL_FAILED:
      'Composite constraint (logic=any) requires at least one sub-constraint to pass, but all {total} failed',
    COMPOSITE_NONE_HAS_PASSED:
      'Composite constraint (logic=none) requires all sub-constraints to fail, but {passed} passed',
    COMPOSITE_SUB_CONSTRAINT_ERROR: 'Sub-constraint {sub_type} raised an error: {detail}',
    COMPOSITE_UNKNOWN_SUB_TYPE:
      'Composite constraint contains unsupported sub-constraint types: {unknown_types}; these were not validated',
    COMPOSITE_NO_SUB_CONSTRAINTS:
      'Select the constraint nodes to aggregate in the properties panel',
    COMPOSITE_NO_VALID_SUB_CONSTRAINTS: 'No valid sub-constraint nodes found',
    COMPOSITE_SUB_CONSTRAINTS_IDLE:
      '{count} constraint(s) have not run yet; run the upstream constraint validations first',
    COMPOSITE_ALL_IDLE: 'No constraints have run yet',
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
