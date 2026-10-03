# `precis validate --format json` Output Contract v1

> Status: **Frozen** (since 2026-09-20)
> Implementation single source of truth: `build_json_payload` in `backend/app/shared/services/validation/json_payload.py`
> Contract snapshot tests: `backend/tests/unit/cli/test_validate_json_contract.py`

This document defines the structure of the JSON document that
`precis validate --manifest <path> --format json` writes to **stdout**.
Consumers (Kimi Code plugin, CI pipelines, other agent harnesses) may rely on
the promises made here.

## General rules

- stdout contains **exactly one JSON document** (`json.dumps(..., ensure_ascii=False)`,
  single line, UTF-8). Spinner and rich summary output is suppressed in JSON mode;
  logs go to stderr.
- **Fields must always be present; missing values are `null`** — consumers check
  for emptiness only, never for key existence.
- `schema_version` is currently `1`.

## Compatibility promises (v1)

1. **Add-only**: adding new fields is allowed within the v1 lifetime (consumers
   must tolerate unknown fields); the **names and semantics of existing fields
   never change**.
2. **Breaking changes** (removing fields, changing semantics or types) require
   bumping `schema_version` and updating this document.
3. Exit-code semantics (below) are independent of `schema_version` and are an
   equally frozen promise.

## Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | `int` | Output contract version; currently always `1` |
| `is_valid` | `bool` | `true` if and only if `errors` is empty; `loading_warnings` does not affect this verdict |
| `interrupted` | `bool` | `true` when validation terminated early due to `error_handling: stop` (stop on first error) |
| `duration_ms` | `int` | Total validation duration in milliseconds |
| `tables` | `list[TableEntry]` | Loaded tables that participated in validation; see below |
| `summary` | `Summary` | Constraint-check statistics; see below |
| `errors` | `list[ErrorEntry]` | Violation/error entries; see below |
| `loading_warnings` | `list[dict]` | Loading-stage issues (passed through verbatim from `loading_errors`); entry structure below |

### `tables[i]`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `str \| null` | Table display name (from `validation_details.format_checks`) |
| `rows` | `int \| null` | Row count; DataFrame length in standard mode, `row_count` in chunked mode; `null` when unavailable |

### `summary`

| Field | Type | Description |
|-------|------|-------------|
| `constraints_total` | `int` | Number of constraint checks executed |
| `constraints_passed` | `int` | Number of checks passed |
| `constraints_failed` | `int` | Number of checks failed (`total = passed + failed`) |

### `errors[i]`

| Field | Type | Description |
|-------|------|-------------|
| `table` | `str \| null` | Table display name |
| `column` | `str \| null` | Column name; may be `null` for cross-table or table-level errors |
| `constraint_type` | `str \| null` | Constraint class name (e.g. `NotNullConstraint`); `FormatValidation` for format-validation errors; the corresponding type for timeout/interruption errors |
| `constraint_file` | `str \| null` | Source file path **relative to the manifest directory**: for standalone constraints the `*.constraint.yaml` path, for schema-embedded constraints the host `*.schema.yaml` path; `null` for sourceless errors (format validation, timeouts, template-expansion artifacts, etc.) |
| `row_index` | `int \| null` | Zero-based data row index (header excluded); `null` for errors without a row concept. Two baselines exist: format-validation errors (`FormatValidation`) are always **original-file row positions**; constraint errors use **row positions at constraint-evaluation time** — the Transform DAG runs after format validation and before constraint validation, so row-count-changing transforms (FilterRows/SortRows/DropDuplicates/Aggregate) re-index rows, and constraint-error `row_index` values then no longer correspond to original-file positions (the two baselines agree when no row-transform is applied). Back-mapping row positions to the original file (index lineage) is a known backlog item, not implemented |
| `cell_value` | `any (JSON) \| null` | Raw value of the violating cell; numpy scalars are normalized to native Python types, NaN/Inf become strings |
| `error_message` | `str \| null` | Human-readable error message (Chinese); table identifiers in the message are display names (table IDs are replaced in post-processing); dangling references (table no longer exists) keep the ID for troubleshooting |
| `error_message_en` | `str \| null` | English error message (for the international open-source release), rendered from `error_code` + `error_params`; **`null` for unregistered codes / missing params / rendering failures — consumers must fall back to `error_message`**; always `null` for uncoded errors (format validation, timeouts, loading issues) (v1-compatible additive field) |
| `suggestion` | `str \| null` | Optional fix hint: suggests "did you mean X" when a value is lexically close to an allowed value (AllowedValues; difflib closeness, no bold guesses), or points out the out-of-range field for near-miss Y-M-D dates with invalid month/day; `null` when the generator has no hint (v1 additive field) |
| `error_code` | `str \| null` | Stable machine error code (UPPER_SNAKE, e.g. `RANGE_COLUMN_NOT_NUMERIC`), for the GUI frontend to map to an i18n key and render in the current language; CLI consumers generally don't need it (v1 additive field) |
| `error_params` | `object \| null` | Interpolation params for `error_code` (JSON scalars; data values stringified), e.g. `{"column": "Total"}`; `null` for uncoded errors (v1 additive field) |

### `loading_warnings[i]`

Loading-stage issues (passed through verbatim from `LoadingError.to_dict()`); common
fields: `error_type`, `file_path`, `ref_id`, `message`, `severity`, `title`,
`description`, `fix_hint`. Manifest version problems (`ManifestVersionError`),
missing files, parse failures, ID mismatches, etc. all surface through this channel.

## Exit-code contract (single-shot mode; orthogonal to the output format)

| Code | Meaning | Typical scenario |
|------|---------|------------------|
| `0` | Validation passed | `errors` is empty and validation completed normally |
| `1` | Validation completed, data violations found | `errors` is non-empty (format errors, constraint violations) |
| `2` | Tool error | Argument errors (including invalid `--format` values, unknown commands), manifest path not found, crashes |

Note: a manifest that **exists but has an unsupported version** (`ManifestVersionError`)
surfaces structurally through `loading_warnings`, and validation finishes in a controlled
manner (`errors` contains data-not-loaded errors) → exit code `1`; a manifest that does
not exist / crashes on parse → exit code `2`.

`--report` export failure (unwritable path / invalid extension) does **not break the
stdout contract**: stdout still emits the full JSON document (validation results shown
as-is), the error message goes to stderr, and the exit code is `2` (tool error;
distinct from the `1` used for data violations).

The interactive REPL mode is not covered by the exit-code contract; `--format` takes
effect only in standalone (with `--manifest`) mode.
