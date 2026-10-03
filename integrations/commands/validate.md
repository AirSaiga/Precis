---
description: Validate a specified data file or project with Precis
---

Follow the `precis-data-validation` skill workflow to validate: $ARGUMENTS

Key steps:

1. Run `precis --version` first to confirm the CLI is available; if it is not, give
   installation guidance and stop.
2. Read the data file that `$ARGUMENTS` points to (if it is a project.precis.yaml, skip to
   step 4) and, following the skill's references/v2-format.md, infer the structure and
   generate the V2 configuration; confirm the output location with the user first.
3. Run `precis validate --manifest <path> --format json` (quote Windows paths containing spaces).
4. Branch on the exit code when reporting: 0 passed; 1 restate each `errors[]` entry's
   table/column/row/value/constraint; 2 report the tool error and show stderr. Finally ask
   the user whether to fix the data or adjust the rules, and iterate until it passes.
