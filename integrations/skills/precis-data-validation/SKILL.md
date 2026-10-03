---
name: precis-data-validation
description: Validate CSV/Excel/JSON data against schema constraints with the Precis CLI — generate V2 YAML configuration, run validation, interpret the JSON result, and iterate until it passes.
whenToUse: When the user asks you to check/validate the quality of CSV, Excel, or JSON data, or to accept data before delivery.
---

# Precis Data Validation Workflow

Precis is a data validation engine: you write one V2 YAML configuration for your data files
(configuration format version 2, holding the table structure + constraint rules), then run
validation with `precis validate` to get a machine-readable list of violations. This skill
walks you through the complete loop: "read data → write configuration → run → interpret → iterate".

## Step 0: Preflight check

Probe the CLI in priority order (as soon as one works, go to Step 1):

1. `precis --version` — the user installed it with pip
   (`precis-cli` is an equivalent alias command; use `precis` for probing and for all later execution)
2. `uvx --from precis-cli precis --version` — the user has [uv](https://docs.astral.sh/uv/)
   installed, so it runs without installation (the first run downloads dependencies and takes
   some waiting). From then on, prefix every `precis ...` command with
   `uvx --from precis-cli`
   (on a development machine you can also run from source with
   `uvx --from <Precis repo>/backend precis ...`)

If neither works, tell the user how to install and **stop** (do not try other workarounds):

> The Precis CLI is not installed. Pick either installation method:
> 1. Install uv and run it without installing: `uvx --from precis-cli precis --version`
> 2. Install with pip (requires Python >= 3.12): `pip install precis-cli`
> Either way you get the `precis` command. Start the validation again once it is installed.

## Step 1: Read the data file, confirm where files are written

1. Read the **head** of the data file (use `head` for CSV/JSON; for Excel first check the
   sheet names and the first row) to confirm the column names, the approximate types, and
   the row count.
2. **Confirm the configuration location with the user first** (default suggestion:
   `precis-project/` in the directory of the data file), and write files only after the user
   agrees. Keep every artifact in the user's directory so it stays readable, diffable, and
   committable to git.

## Step 2: Write the V2 configuration

**Infer first, adjust by hand second** (this lowers the error rate of hand-written YAML):

```bash
precis infer-schema <data file> --output <project dir>/schemas/<table name>.schema.yaml
# keep the id unchanged when replacing an existing schema: --id <original UUID>; fix a wrong source path with --source-path
```

The inference produces a draft of column types (string/integer/float/decimal/boolean/date;
a few dirty values will not sink a whole column — the dominant type in the data decides).
Show it to the user for confirmation, then adjust it to the business semantics
(for example add primary_key, or change an amount column to decimal).

Then complete the constraints strictly following the format quick reference in
`references/v2-format.md` under this skill directory:

```
<project dir>/
├── project.precis.yaml          # manifest: references every schema and constraint
├── schemas/<table name>.schema.yaml    # one per table: column definitions + data source path
└── constraints/*.constraint.yaml # one per constraint
```

Key points:

- Use **UUID v4** for every ID (the `id` of schemas/constraints), for example
  `8f3d2a1c-4b5e-4f6a-9c8d-1e2f3a4b5c6d`; the legacy `sc_` prefix format is **forbidden**.
- Prefer the 6 simple constraint types: NotNull / Unique / AllowedValues / Range /
  ForeignKey / Charset. Use Scripted / Conditional / DateLogic / Composite as needed
  (Scripted requires allow_eval to be enabled for the project — see references).
- Once the configuration is written you can run validation; mistakes in the configuration
  itself surface through `loading_warnings`, so no separate validation step is required.

## Step 3: Run validation

```bash
precis validate --manifest <project dir>/project.precis.yaml --format json
```

- Quote paths containing spaces on Windows.
- Large files (>500MB) are loaded in chunks automatically; a long runtime is normal —
  remind the user to be patient.
- Do **not** use `--format json` in the interactive command line (REPL) (the option is
  ignored there).

## Step 4: Interpret by exit code

In `--format json` mode **stdout holds exactly one JSON document** (stderr may hold logs;
ignore it). The exit code has three branches:

| Exit code | Meaning | What you must do |
|-----------|---------|------------------|
| 0 | Validation passed | Report the pass to the user, with the tables/summary overview |
| 1 | Validation completed, data violations found | Parse `errors[]` and report each entry to the user |
| 2 | Tool error | Show stderr/the error message, check the configuration and the paths, then fix and retry |

Every `errors[]` entry has these fields: `table`, `column`, `constraint_type`,
`constraint_file` (the source constraint file, relative to the manifest directory — for a
standalone constraint this is its `*.constraint.yaml` path, for a schema-embedded constraint
it is the host schema path; errors without a source such as format validation are `null`),
`row_index`, `cell_value`, and `error_message` (a human-readable message that the CLI
currently emits in Chinese).

Suggested report format:

> Found N violations in total (covering M constraint checks, X passed):
> 1. Table `orders`, row 127, column `email` (NotNull constraint): the value is empty — not-null constraint conflict…
> 2. …

Note: `row_index` is the data row index (0-based, header excluded); when reporting you can
convert it to "data row row_index+1" so the user can locate it easily.

## Step 5: Iteration loop

There are only two ways to handle violations, **ask the user which one to take**:

1. **Fix the data**: after the user edits the data file, simply run Step 3 again.
2. **Adjust the rules**: when you think a constraint is too strict/too loose, edit the
   constraint file that `errors[].constraint_file` points to and run again.

Iterate until the exit code is 0. If the user asks along the way to adjust project settings
such as timeouts or error handling, see the settings section of references/v2-format.md.

## Prohibitions

- Do not hand-edit or prettify the JSON output; only parse and restate it.
- Do not write configuration files into the user's directory without confirmation.
- Do not use `--format json` in the interactive command line (REPL).
- **Do not enable `script_security.allow_eval` on the user's behalf** — Scripted constraints
  execute expressions, which is a security decision requiring the user's explicit
  authorization; only when the user explicitly agrees may the user change the settings
  themselves, and state the risk (script execution) clearly. Use another constraint type
  instead by default.
- When the environment has MCP configured (the `precis-mcp` server), prefer calling the MCP
  tools directly (validate_data / infer_schema / check_config / describe_constraints); their
  return structure matches the CLI JSON contract. Without MCP, use Bash + CLI.
