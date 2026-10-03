# AI → Frontend Change-Set Instruction Contract v2 (frontend_instructions)

> Status: **Finalized** (v2, effective since 2026-10; the v1 mirrored-data format is deprecated)
> Implementation single source of truth: `backend/app/shared/services/llm/constraints/frontend_instructions.py`
> Consumer documentation: frontend `frontend/src/services/aiChatInstructions/` (v2 handler)

This document defines the structure of the **frontend_instruction** messages the
backend sends to the frontend after the AI writes to disk (v2: change-set envelope),
and their delivery semantics across channels (SSE streaming / REST / CLI JSON).
Consumers may rely on the promises made here.

## Design principle (D1: the file is the single source of truth)

After the backend writes to disk, **the project configuration files are the single
source of truth**. Instructions no longer carry entity data (columns/params/config,
etc.); they only declare "which on-disk entity changed and how". Upon receipt the
frontend re-reads from disk (`importV2ResourceToCanvas`, idempotent) and rebuilds
the canvas. The old v1 "mirrored-data dual-write channel" (instructions embedding
complete entity data, the frontend mirroring nodes from them) is deprecated — the
three bug classes it caused (uuid divergence, races, lost params) all stem from
that dual write.

## Envelope fields (v2)

Each instruction is a JSON object with **exactly** the following six fields:

| Field | Type | Description |
|-------|------|-------------|
| `instructionId` | `str` | Deterministic identifier `"{op}:{kind}:{entityId}"`, for tracing and explicit deduplication |
| `actionType` | `str` | Original action type (`ADD_SCHEMA` / `UPDATE_CONSTRAINT_NODE` / `DELETE_REGEX` / `ADD_TO_CANVAS`, etc.; full set in `actions/registry.py`), for display and telemetry — **not used for dispatch logic** |
| `op` | `str` | `add` \| `update` \| `remove` |
| `kind` | `str` | `schema` \| `constraint` \| `regex` \| `transform` (reserved: `manualData` \| `template`) |
| `entityId` | `str` | The real id of the on-disk entity, **always equal to the id derived from the host file name and to the canvas node id** (see below) |
| `filePath` | `str` | Project-relative path (POSIX `/` separators), e.g. `constraints/notnull_3f2a1c8e-5b4d-4e6f-9a0b-7c1d2e3f4a5b.constraint.yaml` |

**No entity-data fields are carried** (`columns` / `params` / `config` /
`constraintSpec`, etc.). The frontend's uniform action for every entry: re-read
from disk by `filePath` (or `kind` + `entityId`) and rebuild.

### op enum semantics (file-level)

| op | Semantics | Frontend action |
|----|-----------|-----------------|
| `add` | File created (or: surface an already-existing resource on the canvas) | Read from disk and create the canvas node (idempotent refresh if it already exists) |
| `update` | File contents changed (file still exists) | Re-read from disk and rebuild the node with the file as the source of truth (including embedded constraints and edges) |
| `remove` | File deleted | Remove the canvas node for `entityId` and its associated edges (no-op if the node doesn't exist) |

### kind enum and directory conventions

| kind | Directory | File suffix | Match key |
|------|-----------|-------------|-----------|
| `schema` | `schemas/` | `.schema.yaml` | Content `id` (with `name` fallback when matching) |
| `constraint` | `constraints/` | `.constraint.yaml` | Content `id` (resolved_id first, semantic lookup fallback; see below) |
| `regex` | `regex/` (legacy `regex_nodes/` still matches) | `.regex.yaml` | Content `id` (with `name` fallback when matching) |
| `transform` | `transforms/` | `.transform.yaml` | Content `id` only |
| `manualData` / `template` | — (no AI actions produce these today; symmetrically reserved on the frontend) | — | — |

## Identity invariant (entityId ≡ real on-disk id)

1. **entityId = the host YAML's content `id` field** (derived from the file name
   minus suffixes when absent) = **the canvas node id**. The frontend must not
   locate nodes by secondary keys such as name/configName.
2. ADD / UPDATE instructions get their entityId by the backend **re-reading disk**
   (the LLM may only provide a name, e.g. `UPDATE_SCHEMA {name: "users"}` matching
   `schemas/sc_users.schema.yaml` → entityId is `sc_users`, not `users`).
3. DELETE instructions are generated after the file is deleted, leaving nothing on
   disk to consult — the handler resolves and returns `resolved_id` before unlink
   (uniform for schema/regex/transform/constraint), so deleted entries also carry
   the real id as entityId.
4. Standalone constraint file ids are no longer semantically derived: new files
   default to `{type}_{UUID v4}` (when the LLM passes an explicit `constraintId`,
   it is respected after filename-safe sanitization). The constraint envelope's
   entityId is **the actual on-disk result of the action** — the message returned
   by `update_yaml_config` / `delete_constraint_file` on success is the real id
   (the processor returns it as `resolved_id`); for direct generators (no
   resolved_id), the backend re-reads disk and falls back to locating by explicit
   `constraintId` → semantic reference (table+column+type,
   `constraint_lookup.find_constraint_file_by_semantics`). Under both paths the
   "written file name" and the "instruction entityId" are always identical.
   Deletion and semantic lookup work the same for legacy semantic-ID files (e.g.
   `notnull_users_email`) and new UUID files.

### Special mapping for inline constraints

Inline constraints (`isInline: true`) have no standalone disk file; their changes
land in the **host schema file**. Therefore:

- Inline ADD / UPDATE / DELETE always produce entries with `kind=schema`,
  `op=update` (actionType keeps its original value such as `ADD_CONSTRAINT_NODE`
  for telemetry);
- The frontend re-reads the schema and rebuilds embedded constraint nodes from its
  `constraints` list (deleted inline constraints are simply not rebuilt);
- Multiple inline operations on the same schema within one batch produce the
  **same instructionId** (`update:schema:{id}`), naturally deduplicating into a
  single re-read.

### Actions without entries

The following actions produce no change-set entries (the generator returns `None`;
every consuming channel skips them automatically):

- `UPDATE_SETTINGS`: writes `project.precis.yaml`, has no standalone entity file,
  and the frontend has no canvas action;
- `VALIDATE_PROJECT`: read-only validation;
- Unknown actionTypes / actions whose entityId cannot be resolved.

## Idempotency requirements (safe on repeated delivery)

- **Repeated delivery of the same entry must be safe**: the frontend deduplicates
  by instructionId (or entityId + op); even without deduplication, `add`/`update`
  handling is "rebuild from disk as the source of truth" (idempotent), and
  `remove` on a nonexistent node is a no-op.
- `ADD_TO_CANVAS` and `ADD_*` are unified into the same envelope (`op=add`): the
  former's target file already exists — the semantics are "surface the on-disk
  resource on the canvas", indistinguishable from create-then-surface.

## Delivery channels and timing (invariants)

| Channel | Carrier | Semantics |
|---------|---------|-----------|
| SSE streaming (agent chat) | Event name `frontend_instruction`, payload `{"instruction": {…envelope…}}`, emitted **one by one** after disk writes are confirmed | Frontend executes on receipt + fitView (canvas grows in real time) |
| SSE terminal-event fallback | The `completed` event snapshots `frontend_instructions: [{…envelope…}, …]` | Fallback when streaming is lost; the frontend deduplicates against already-streamed entries by instructionId (envelope determinism reduces text-comparison dedup to identity comparison) |
| REST non-streaming `/ai/chat` | Response field `frontend_instructions` (list, same envelope) | Pass-through |
| CLI `ai ask --json` | `CommandResult.data.frontend_instructions` | Pure pass-through/display; the CLI has no canvas and does not consume the field |

Timing and event names are **unchanged**; only the payload shape moved from v1
(embedded entity data) to the v2 envelope.

### Producer-side invariants (established in the P0 batch; do not break)

- **Rollback clears instructions**: when any action in a batch fails and triggers
  a full rollback, all instructions of write actions are cleared (disk is back to
  pre-execution state; instructions would point at nonexistent results = ghost
  instructions); read-only actions (`ADD_TO_CANVAS`) re-read disk configuration
  that existed before the batch, so their instructions are kept.
- **No double accumulation in dry-run**: two-phase-confirmation dry-run
  (shadow-copy) artifacts are for diff preview only; instructions are collected
  exactly once from the real write results (`apply_actions._run_two_phase`).
- **EventJournal replay semantics**: `frontend_instruction` events persist with
  the journal (non-terminal events, no forced fsync). `/ai/chat/stream` does not
  support cross-connection resumption — `Last-Event-ID` only serves as the start
  cursor for journal replay within the same connection (replayed from that id
  when proxy buffering/reconnects trigger it); replay re-delivers already-sent
  events (including `frontend_instruction` and those in the `completed`
  snapshot). **Idempotency + instructionId deduplication are the foundation of
  replay safety**, guaranteed by the frontend. Instructions of rolled-back
  batches are already cleared on the producer side, so no ghost entries appear
  in the journal.

## Compatibility promises (v2)

1. **Add-only**: adding new fields is allowed within the v2 lifetime (consumers
   must tolerate unknown fields); the six field names and semantics never change.
2. **Breaking changes** (removing fields, changing semantics) require a version
   bump and an update to this document.
3. v1 → v2 is a **hard switch** (frontend and backend live in the same repo and
   release together): a v1 frontend handler receiving a v2 envelope —
   schema/regex/transform/canvas handlers **silently skip** due to the missing
   `spec` (canvas not updated, no error); the constraint handler **throws a
   TypeError** destructuring `undefined` — swallowed with a log by `.catch` on
   the streaming path, bubbling up on the batch fallback path. Neither case
   produces error nodes or dirty data; only the canvas lags (reloading the
   project restores it).

## Contract guards

- Generator unit tests: `backend/tests/unit/test_frontend_instructions.py`
  (envelope-field completeness, add/update/remove per actionType family, entityId
  ≡ on-disk file id, ADD_TO_CANVAS, inline downgrade, the DELETE resolved_id
  chain, None-returning classes).
