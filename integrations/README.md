# Precis Agent Harness Integration (generic)

Lets any AI agent host program (hereafter *harness* — the terminal/editor environment that
runs an agent, such as Kimi Code, Claude Code, ZCode, Cursor, and any CLI agent that supports
MCP or a shell) handle data quality validation in natural language: infer the data structure,
generate a V2 validation configuration (configuration format version 2), run validation,
report violations one by one, export reports, and iterate until everything passes.

No need to install or open the Precis desktop GUI.

## Layered design (this directory is the harness-neutral root of shared content)

```
┌─ L1 CLI contract (base layer shared by every harness) ────────┐
│  precis commands + JSON output contract + exit codes 0/1/2    │
│  Any agent with a shell can use it; the base for L2 and L3    │
├─ L2 generic skill (harnesses with a filesystem + shell) ──────┤
│  skills/precis-data-validation/: workflow + V2 format guide   │
│  Pure markdown + relative paths, no proprietary syntax        │
├─ L3 MCP (protocol-native harnesses) ──────────────────────────┤
│  precis-mcp stdio server: 4 tools; return values = L1 contract│
└───────────────────────────────────────────────────────────────┘
```

- **Single implementation**: L2/L3 share the same implementation and output structure from
  L1; there is no second forked implementation (the CLI `--format json`, the MCP
  `validate_data`, and the `--report` report all come from the same source).
- This directory is also a complete **Kimi Code plugin package root** (`kimi.plugin.json`
  alongside `skills/` and `commands/`) and supports whole-directory/subdirectory URL
  installation.

## Host integration matrix

| Host program | Integration | Notes |
|--------------|-------------|-------|
| **Kimi Code** | Install the plugin package (see below) | Provides all three: skill, `/precis:*` commands, and MCP |
| **Claude Code** | Copy skills + commands (see below) | The same SKILL.md; commands become project commands such as `/precis:validate` |
| **ZCode** | Copy the skill or use MCP | The skill spec is compatible; see below for `precis-mcp` configuration |
| **Cursor / other MCP harnesses** | Configure MCP `precis-mcp` | No skill needed; tools return structured JSON |
| **Any shell agent** | Use the L1 CLI directly | This README's contract documentation is the interface description |

## Prerequisites (pick one; common to all harnesses)

**Option A: pip install (requires Python >= 3.12, < 3.14)**

```bash
pip install precis-cli     # distribution name is precis-cli (PyPI "precis" is taken); the command name is precis
precis --version           # verify
```

**Option B: uvx without installation (requires [uv](https://docs.astral.sh/uv/), no pip needed)**

```bash
uvx --from precis-cli precis --version
# prefix every command afterwards with uvx --from precis-cli, for example:
uvx --from precis-cli precis validate --manifest ./project.precis.yaml --format json
```

**Option C: from source (developers)**

```bash
pip install -e /path/to/Precis/backend
# or uvx --from /path/to/Precis/backend precis ...
```

MCP requires `pip install "precis-cli[mcp]"` (optional dependency, the official mcp SDK).

## Kimi Code installation

```
# local path (install and use immediately in a development setup)
/plugins install /path/to/Precis/integrations

# GitHub URL (four forms; the Kimi Code official documentation is authoritative)
/plugins install https://github.com/AirSaiga/Precis                              # 1. repository root (through the .kimi-plugin/plugin.json shim)
/plugins install https://github.com/AirSaiga/Precis/tree/main                    # 2. default branch of the repository
/plugins install https://github.com/AirSaiga/Precis/tree/main/integrations       # 3. subdirectory (kimi.plugin.json is at that directory root)
/plugins install https://github.com/AirSaiga/Precis/tree/v0.1.2/integrations     # 4. subdirectory at a given tag/commit
```

Run `/reload` after installation for it to take effect.

> Dual manifest note: `integrations/kimi.plugin.json` and the repository-root
> `.kimi-plugin/plugin.json` point to the same skills/commands and **must be changed
> together** (a CI golden test verifies consistency).

## Claude Code installation

```bash
# project level (available in the current project only)
mkdir -p .claude/skills .claude/commands/precis
cp -r integrations/skills/precis-data-validation .claude/skills/
cp integrations/commands/*.md .claude/commands/precis/   # the subdirectory is the namespace: /precis:validate, etc.

# or user level (available in all projects)
mkdir -p ~/.claude/skills ~/.claude/commands/precis
cp -r integrations/skills/precis-data-validation ~/.claude/skills/
cp integrations/commands/*.md ~/.claude/commands/precis/
```

Afterwards trigger it in natural language ("check this CSV with precis") or use project
commands such as `/precis:validate`. Command files are a description frontmatter plus an
`$ARGUMENTS` body, compatible with the Claude Code command spec.

> Note: commands must be copied into the `commands/precis/` **subdirectory** — Claude Code
> uses the subdirectory name as the command namespace; flattening them into `commands/`
> yields `/validate`, `/init`, `/report`, and `/init` collides with a Claude Code built-in
> command.

## MCP direct connection (Cursor / ZCode / other MCP harnesses)

The plugin's `mcpServers.precis` declaration (command `precis-mcp`, stdio). Manual setup:

```json
{ "mcpServers": { "precis": { "command": "precis-mcp", "args": [] } } }
```

| Tool | Purpose |
|------|---------|
| `validate_data` | Runs validation and returns a contract structure **exactly the same** as the CLI `--format json` |
| `infer_schema` | Infers a schema draft from a data file |
| `check_config` | Checks configuration loading problems (without running validation) |
| `describe_constraints` | Lists the 10 constraint types with their refs/params documentation |

Health self-check (source repository only): `cd backend && python -m scripts.mcp_smoke_test`
(simulates a stdio client through the full initialize → tools/list → tools/call flow).

> Dependency note: the MCP protocol layer uses the official `mcp` Python SDK
> (`mcp>=1.30.0,<2`; 2.x is still in its migration period). Tool execution reuses the same
> CLI implementation; no second output format has been forked.

## CLI contract (L1, for any agent to consume directly)

```bash
precis validate --manifest <project dir>/project.precis.yaml --format json
precis infer-schema <data file> [--output <path>]     # infer a schema draft
precis validate ... --report <path>.html|.xlsx       # shareable report, same source as JSON
```

**Exit codes**:

| Code | Meaning |
|------|---------|
| 0 | Validation passed |
| 1 | Validation completed, data violations found |
| 2 | Tool error (bad arguments, missing file, unhandled crash) |

**JSON output** (with `--format json`, stdout holds only one UTF-8 JSON document and
human-readable output is suppressed; see the full contract in
[validate-json-v1.md](https://github.com/AirSaiga/Precis/blob/main/docs/contracts/validate-json-v1.md)):

```json
{
  "schema_version": 1,
  "is_valid": false,
  "interrupted": false,
  "duration_ms": 120,
  "tables": [{"name": "orders", "rows": 15234}],
  "summary": {"constraints_total": 5, "constraints_passed": 3, "constraints_failed": 2},
  "errors": [
    {
      "table": "orders",
      "column": "amount",
      "constraint_type": "NotNullConstraint",
      "constraint_file": "constraints/orders_amount_notnull.constraint.yaml",
      "row_index": 127,
      "cell_value": null,
      "error_message": "NotNull constraint conflict: the value of column 'amount' must not be empty."
    }
  ],
  "loading_warnings": []
}
```

- Missing value fields are always `null`, but the field is always present.
- `row_index` is the 0-based data row index (header excluded).
- `constraint_file` is the source file path **relative to the manifest directory**: for a
  standalone constraint it is its `*.constraint.yaml` path, for a schema-embedded constraint
  it is the host `*.schema.yaml` path; for errors with no constraint source such as format
  validation or timeouts it is `null`. With it you can open and edit the constraint file directly.
- `loading_warnings` passes through configuration/loading-stage problems (such as an ID
  mismatch, a missing file, or an unsupported manifest version); configuration mistakes
  usually surface here.

## Security notes

- **Scripted constraints and `allow_eval`**: executing custom expressions is a
  security-sensitive operation. The skill explicitly requires the agent **not to enable**
  `script_security.allow_eval` on the user's behalf; it may only prompt the user to change it
  themselves and explain the risk clearly; by default, substitute one of the other 9
  constraint types.
- **MCP path allowlist**: every file parameter of `precis-mcp` (manifest/data directory/data
  file) may only access paths inside the **server working directory**, preventing an agent
  from being induced to read or write arbitrary files; to extend the scope, the user sets the
  `PRECIS_MCP_ALLOWED_ROOTS` environment variable (separated by os.pathsep).
- Validation only reads data files; writes are limited to the `--output` / `--report` paths
  the user explicitly requests.

## Troubleshooting

| Symptom | Handling |
|---------|----------|
| `precis --version` reports command not found | Not installed or not on PATH: `pip install precis-cli` and reopen the terminal, or use `uvx --from precis-cli` |
| The agent says the configuration is written but validation reports "manifest file does not exist" | Check that the `--manifest` path and the actual output location match (quote Windows paths containing spaces) |
| errors stays empty but the data clearly has problems | The constraint may not be written or not registered in the manifest `constraints:` list; or `refs.column_id` uses a column name instead of a column ID |
| Scripted constraint reports a permission error | Set `settings.script_security.allow_eval: true` in `project.precis.yaml` (the user does this themselves) |
| Validation of a large file shows no response for a long time | >500MB is loaded in chunks automatically, which is normal; you can raise `settings.validation.timeout_seconds` |
| Exit code 2 with a stack trace on stderr | Tool error: usually a YAML syntax error or a nonexistent path; fix it as the stderr message indicates |
| MCP tool call gets no response | Confirm `precis-cli[mcp]` is installed; run `python -m scripts.mcp_smoke_test` for a self-check |

## Uninstall and version compatibility

- Uninstall: `/plugins remove precis` (removes only the installation record; the plugin copy
  and the source files stay on disk).
- The plugin version and the `precis-cli` version evolve independently: this documentation is
  written against the behavior of the latest CLI, so keeping the CLI up to date is
  recommended (`pip install -U precis-cli`); when the versions differ, the CLI's actual
  behavior wins.

## License

Apache-2.0 (see the `LICENSE` file in this directory).

## Directory structure

```
integrations/                          # generic integration root (also the Kimi plugin package root)
├── kimi.plugin.json                   # Kimi Code plugin manifest (one of the entry points)
├── marketplace.json                   # Kimi marketplace listing material
├── LICENSE                            # Apache-2.0
├── README.md                          # this file: generic integration documentation
├── skills/precis-data-validation/
│   ├── SKILL.md                       # generic skill workflow manual (no proprietary syntax)
│   └── references/v2-format.md        # V2 YAML format quick reference
├── commands/                          # generic command bodies (description frontmatter + $ARGUMENTS)
│   ├── validate.md
│   ├── init.md
│   └── report.md
└── workbuddy/                         # Tencent WorkBuddy open platform listing material (see that directory's README)
```

The corresponding repository-root `.kimi-plugin/plugin.json` (whole-repo installation shim)
and the backend `precis` / `precis-mcp` commands (`backend/app/cli/` and
`backend/app/mcp_server.py`).
