---
description: Generate and present a Precis validation report (shareable HTML/Excel file)
---

Generate a Precis validation report for $ARGUMENTS:

1. Preflight check: `precis --version` (if unavailable, give installation guidance and stop).
2. When the target is a data file, first confirm/generate the configuration following the
   `precis-data-validation` skill; when it is a project.precis.yaml, go straight to the next step.
3. Run (the report format is dispatched by extension; `.html` is a single shareable file,
   `.xlsx` has one sheet per table with violating rows highlighted in red):

   ```bash
   precis validate --manifest <path> --format json --report <output path>.html
   ```

4. Parse the stdout JSON and summarize it for the user (conclusion, number of checks,
   violation distribution), and tell them the report file path (an HTML file can be sent
   directly to non-technical colleagues to open).
5. If the user asks for Excel, rerun with `--report <path>.xlsx`.
