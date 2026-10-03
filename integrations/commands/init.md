---
description: Guide the creation of a Precis validation project (infer schema + write constraints + first validation)
---

Follow the `precis-data-validation` skill workflow to initialize a validation project for $ARGUMENTS:

1. Preflight check: `precis --version` (if unavailable, try `uvx --from precis-cli precis --version`
   in turn; if neither works, give installation guidance and stop).
2. Confirm the configuration location with the user (default suggestion: `precis-project/` next to the data file).
3. **Infer first, adjust second**: run `precis infer-schema <data file> --output <dir>/schemas/<table name>.schema.yaml`
   to generate a schema draft (column types are inferred automatically; with a few dirty
   values the dominant type in the data decides), show the inferred result to the user for
   confirmation, then adjust it to the business semantics (for example add primary_key to an
   id column, or change a column that needs exact amounts to decimal).
4. Confirm with the user which constraints are needed (not-null/unique/enum/range/foreign
   key, etc.), then follow the skill's references/v2-format.md to write
   `constraints/*.constraint.yaml` and `project.precis.yaml` (use UUID v4 for IDs; the
   inferred schema already carries a UUID, so the manifest only needs to reference it).
5. Run `precis validate --manifest <path> --format json` for the first validation and report
   the result by exit code 0/1/2.
