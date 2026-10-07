# Precis V2 Configuration Format Quick Reference

> For agents writing configuration. Covers all 10 constraint types, schema-embedded
> constraints, transform nodes, and common settings.
> The format is frozen as of the Beta release: existing fields, types, and semantics
> no longer change — additive-only from here on (new optional fields may be added;
> nothing existing is removed or redefined).
> (For developers in the source repository: the full type definitions are `ConstraintFile`,
> `TableSchemaFile`, `TransformFile`, etc. under `backend/app/shared/`.)

## Directory structure and ID rules

```
<project dir>/
├── project.precis.yaml           # project manifest (entry point)
├── schemas/<table name>.schema.yaml     # one per table
├── constraints/<any name>.constraint.yaml  # one per constraint
├── transforms/<any name>.transform.yaml    # transform nodes (optional)
└── <data file>                     # CSV / TSV / JSON / Excel, etc.
```

- Every entity `id` (manifest entries, schemas, constraints) uses **UUID v4**, and the ID
  referenced by the manifest must match the file's internal `id`.
- The legacy `sc_`-prefixed encoded ID format is **forbidden**.
- The `id` of a schema or constraint file may also be a readable semantic ID (such as
  `orders_amount_range`); both are legal, and UUID v4 is the collision-free default.

## Minimal project.precis.yaml skeleton

```yaml
version: 2
project:
  id: <uuid-v4>        # project identifier
  name: My data validation project
schemas:
  - id: <id inside the schema file>
    path: schemas/orders.schema.yaml
constraints:
  - id: <id inside the constraint file>
    path: constraints/orders_amount_range.constraint.yaml
# Optional: data source directories (used to resolve paths when a schema omits source.path)
data_sources:
  - id: primary
    path: .
    mode: relative
```

Optional `settings` (add as needed):

```yaml
settings:
  validation:
    timeout_seconds: 30     # validation timeout (seconds)
    error_handling: continue  # continue=run everything; stop=stop at the first error
  file_processing:
    default_encoding: utf-8  # utf-8 / gbk / auto (switch to gbk or auto when Chinese CSV text comes out garbled)
    csv_delimiter: ','       # CSV delimiter
  script_security:
    allow_eval: false       # set true when Scripted constraints need expression evaluation
    sandbox_mode: true
```

> **Scripted double switch**: a Scripted constraint runs only when **both** of the following
> hold —
> 1. the project configuration has `settings.script_security.allow_eval: true`;
> 2. the **process environment variable** `PRECIS_ALLOW_UNSAFE_EVAL=1` is set for the process
>    running precis (the server-side master switch, off by default).
>
> With only condition 1 satisfied, Scripted constraints report a permission error on every
> row — this is a security design decision, not a bug.
> When you cannot control the host process environment variables, prefer replacing it with
> another constraint type (for regex format checks see the Scripted + `re_match` form in
> section 9 below, which is subject to the same limitation).

## Schema file (schemas/*.schema.yaml)

```yaml
version: 2
id: orders                      # must match manifest schemas[].id
name: orders                    # table display name
source:
  mode: relative_file           # relative to the manifest directory
  path: ../data/orders.csv      # relative path of the data file
columns:
  - id: order_id                # column ID
    name: order_id              # column name (must match the data file header)
    type: string                # data type, see below
    primary_key: true           # optional
    nullable: false             # optional (informational declaration; use a NotNull constraint for actual not-null validation)
  - id: amount
    name: amount
    type: integer
```

**6 data types**: `string` / `integer` / `float` / `decimal` / `boolean` / `date`

- Type validation runs during format parsing: a column header that does not match `name`, or
  a value that cannot be parsed as its declared type, is reported as an error.
- Excel/JSON are supported too; for JSON use an array of objects, and for Excel specify
  `sheet` in source; TSV (`.tsv`, tab-separated by default) and JSON Lines
  (`.jsonl`/`.ndjson`, one JSON object per line) also work directly as data sources.
- `decimal` can declare precision with a dict form: `type: { name: decimal, precision: 28, scale: 2 }`.
- `source.mode` also supports `absolute_file` (absolute path); `relative_file` resolves
  relative to the manifest directory.

### Schema-embedded constraints (optional)

Constraints may also be written directly in the `constraints:` list of a schema file (no
separate constraint file needed); on load they are automatically expanded into standalone
constraints (with an ID prefixed by `{schema_id}_`). All 10 types are supported; column
references use the **column name or column ID** (`column`/`columns`; top-level columns may
use the bare name, while nested sub-columns need the fully qualified "parent.child" path —
parsing is strict, and a constraint whose reference cannot be resolved is dropped as an
error rather than silently kept). ForeignKey uses `from_column`/`to_table`/`to_column`:

```yaml
version: 2
id: customers
name: customers
source:
  mode: relative_file
  path: ../data/customers.csv
columns:
  - id: email
    name: email
    type: string
  - id: country
    name: country
    type: string
constraints:
  - id: email_notnull          # unique within the table is enough
    type: NotNull
    column: email
  - id: cn_must_have_email
    type: Conditional
    column: email              # the THEN target column
    params:
      # Conditional embedded form: the IF conditions and the THEN column live in params and are extracted automatically on load
      if_logic: and
      if_conditions:
        - if_column_id: country
          operator: eq
          value: CN
      then_column_id: email
      then_condition:
        operator: not_null
  - id: orders_customer_fk
    type: ForeignKey
    from_column: customer_id   # a column of this table
    to_table: customers        # id of the target schema
    to_column: id
    params: {}
```

> Standalone constraint files (next section) and embedded constraints are alternatives —
> pick one; for complex constraints (Composite with many sub-constraints) prefer a standalone
> file, while embedding suits simple rules with one or two constraints per column.

## Constraint files (constraints/*.constraint.yaml)

Common skeleton: `version: 2` + `id` + `type` + `refs` (pointing at table/columns) +
`params` (parameters). `refs.table_id` / `column_id` hold the **schema id / column id**.

### 1. NotNull

```yaml
version: 2
id: <uuid>
type: NotNull
enabled: true
description: amount must not be null
refs:
  table_id: orders
  column_id: amount
params: {}
```

### 2. Unique (note that column_id**s** is a list)

```yaml
version: 2
id: <uuid>
type: Unique
enabled: true
description: order_id must be unique
refs:
  table_id: orders
  column_ids: [order_id]
params: {}
```

### 3. AllowedValues

```yaml
version: 2
id: <uuid>
type: AllowedValues
enabled: true
refs:
  table_id: orders
  column_id: status
params:
  allowed_values: [pending, paid, shipped, closed]
```

### 4. Range

```yaml
version: 2
id: <uuid>
type: Range
enabled: true
refs:
  table_id: orders
  column_id: amount
params:
  min: 0
  max: 100000
  boundary_mode: inclusive   # inclusive closed interval / exclusive open interval
```

### 5. ForeignKey

```yaml
version: 2
id: <uuid>
type: ForeignKey
enabled: true
description: orders.customer_id references customers.id
refs:
  from_table_id: orders
  from_column_id: customer_id
  to_table_id: customers
  to_column_id: id
params: {}
```

### 6. Charset

```yaml
version: 2
id: <uuid>
type: Charset
enabled: true
refs:
  table_id: customers
  column_id: username
params:
  charset_mode: ascii   # ascii / chinese / chinese_mixed
```

### 7. Conditional

```yaml
version: 2
id: <uuid>
type: Conditional
enabled: true
description: users in China must provide an ID card number
refs:
  table_id: customers
  then_column_id: id_card
  if_conditions:
    - if_column_id: country
      operator: eq            # IF side: eq / neq / in / not_null / greater_than / less_than
      value: CN
  if_logic: and              # and / or when there are multiple conditions
params:
  then_condition:
    operator: not_null
```

`params.then_condition` — the THEN-side requirement, in two forms:

- **DSL object**: `operator` is required, one of `not_null` / `greater_than` / `less_than` /
  `in` / `eq` / `neq`;
  - `greater_than`/`less_than`/`eq`/`neq` take `value` (a fixed comparison value) or
    `ref_column` (compare against another column of the same table);
  - `in` takes a `values` list;
  - ordering comparisons are numeric-only; for date comparisons use DateLogic.
    ```yaml
    then_condition: { operator: greater_than, value: 1000 }
    then_condition: { operator: in, values: [A, B, C] }
    then_condition: { operator: eq, ref_column: confirm_email }   # the two columns must be equal
    ```
- **String**: the name of a registered condition function, such as `is_not_empty` /
  `is_positive_number`.

Each item of the IF-side `if_conditions`: `if_column_id` + `operator` (the same six as
above) + `value` (or a `values` list for `in`).
When both IF and THEN are empty, the constraint applies to all rows.

### 8. DateLogic

**compare mode** (compare against a fixed date or a reference column):

```yaml
version: 2
id: <uuid>
type: DateLogic
enabled: true
description: date of birth must be later than 1900-01-01
refs:
  table_id: customers
  column_id: birth_date
params:
  logic_mode: compare
  compare_op: gt             # gt / gte / lt / lte / eq / range
  reference_date: "1900-01-01"   # fixed date; or use reference_column: <column id> to compare row by row against another column of the same table
```

- `range` is a closed interval and needs a start/end pair of the same form:
  `reference_date` + `reference_date_end`, or `reference_column` + `reference_column_end`.
- Reference-column form (such as "the signing date must not be earlier than the hire date"):

```yaml
params:
  logic_mode: compare
  compare_op: gte
  reference_column: hire_date
```

**calculation mode** (compare a computed date against a target value):

```yaml
# Age must be >= 18 (computed from the date of birth; reference_date is optional and defaults to the current date)
params:
  logic_mode: calculation
  calculation_type: age
  target_value: 18            # comparison target (numeric, required)

# The number of days between the shipping date and the order date must be exactly 3 (signed complete 24h days)
params:
  logic_mode: calculation
  calculation_type: days_diff
  target_column: order_date   # the other side of the day difference (required for days_diff)
  target_value: 3
```

- A non-empty but unparsable date reports an "invalid date" error (the target column and the
  reference column follow the same rule).

### 9. Scripted (needs the double switch, see the settings section above)

```yaml
version: 2
id: <uuid>
type: Scripted
enabled: true
description: the phone number must be 11 digits starting with 1
refs:
  table_id: customers
  column_id: phone
params:
  name: phone_format_check
  expression: 're_match(r"^1[3-9]\d{9}$", str(value))'
```

- `expression` is evaluated row by row, `value` is the current cell value, and returning
  truthy means the row passes.
- **Double switch**: besides the project's `allow_eval: true`, the process running precis
  also needs the environment variable `PRECIS_ALLOW_UNSAFE_EVAL=1` (see the settings section
  above); enabling only one side reports a permission error on every row. When you cannot
  control the host environment variables, prefer replacing it with another constraint type.

### 10. Composite

```yaml
version: 2
id: <uuid>
type: Composite
enabled: true
description: the email must be non-null and unique
refs:
  table_id: customers
params:
  logic: all                # all (every one satisfied) / any (at least one satisfied) / none (passes only when none is satisfied)
  sub_constraints:
    - version: 2
      id: <sub-constraint uuid 1>
      type: NotNull
      enabled: true
      refs: { table_id: customers, column_id: email }
      params: {}
    - version: 2
      id: <sub-constraint uuid 2>
      type: Unique
      enabled: true
      refs: { table_id: customers, column_ids: [email] }
      params: {}
```

- Each `sub_constraints` item is a complete constraint object
  (version/id/type/enabled/refs/params); **nesting Composite is not allowed**; if any
  sub-constraint is configured illegally the whole Composite is skipped and reported in
  `loading_warnings` (fail-closed — better to skip the whole constraint than to let it pass,
  and no sub-constraint is ever silently missing).

## Transform nodes (transforms/*.transform.yaml, optional)

Transforms run **after format parsing and before constraint validation** — constraints
validate the transformed data. Typical use: clean/normalize and then validate (for example
convert status to uppercase uniformly and then apply AllowedValues).

```yaml
# transforms/normalize_status.transform.yaml
version: 2
id: normalize_status
name: Status normalization
type: UpperCase
enabled: true
description: convert orders.status to uppercase in place
input_from_node: orders       # id of the upstream schema
input_column: status
output_columns:
  - status                    # same name as input_column = overwrite in place
```

Manifest registration:

```yaml
transforms:
  - id: normalize_status
    path: transforms/normalize_status.transform.yaml
```

**22 transform types**: `StringSplit` `RegexExtract` `MathExpr` `DateFormat` `Lookup`
`Strip` `UpperCase` `LowerCase` `Replace` `FillNA` `FilterRows` `DropDuplicates`
`CastType` `Concat` `Substring` `Aggregate` `ConditionalAssign` `SortRows` `Digits`
`WeightedSum` `Modulo` `MapValue`.

- Multi-column output: `StringSplit` / `RegexExtract` (multiple `output_columns` items).
- **Changing the row count**: `FilterRows` / `DropDuplicates` / `Aggregate` / `SortRows` —
  after such a transform, the `row_index` of a constraint violation no longer corresponds
  one-to-one to the original file line number (known limitation; keep it in mind when
  reporting error row numbers).
- Parameters go in `params` (such as `old`/`new` for `Replace`, or the mapping table for
  `MapValue`); the exact key names follow the backend implementation (developers in the
  source repository: see `backend/app/shared/domain/transforms/`).

## Common errors and troubleshooting

| Symptom | Cause |
|---------|-------|
| `loading_warnings` contains IdMismatchWarning | the id referenced by the manifest does not match the file's internal id |
| Reports "table is not in the dataset" | `refs.table_id` is not the schema's `id` |
| Reports "column does not exist" | `column_id` is not an `id` from the schema columns (use the column ID, not an arbitrary column name) |
| Scripted constraint reports a permission error | one half of the double switch is missing: `settings.script_security.allow_eval` is not enabled, or the process environment variable `PRECIS_ALLOW_UNSAFE_EVAL=1` is not set |
| Data file not found | the schema `source.path` is resolved relative to the manifest directory |
