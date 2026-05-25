import os

EXCLUDE = {"__pycache__", ".pytest_cache", ".ruff_cache", "node_modules", "dist", "build", ".git", ".precis", ".vscode", ".qoder"}


def should_include(root):
    parts = root.replace("\\", "/").split("/")
    return not any(e in parts for e in EXCLUDE)


def count_dir(path, exts, label):
    files, total, nonempty, comment = 0, 0, 0, 0
    for root, dirs, filenames in os.walk(path):
        dirs[:] = [d for d in dirs if d not in EXCLUDE]
        if not should_include(root):
            continue
        for f in filenames:
            if any(f.endswith(e) for e in exts):
                fp = os.path.join(root, f)
                try:
                    with open(fp, "r", encoding="utf-8", errors="ignore") as fh:
                        lines = fh.readlines()
                except Exception:
                    continue
                files += 1
                total += len(lines)
                ext = os.path.splitext(f)[1].lower()
                for line in lines:
                    t = line.strip()
                    if t == "":
                        continue
                    nonempty += 1
                    if ext == ".py" and t.startswith("#"):
                        comment += 1
                    elif ext in (".ts", ".vue") and (
                        t.startswith("//") or t.startswith("/*") or t.startswith("*")
                    ):
                        comment += 1
    return {
        "label": label,
        "files": files,
        "total": total,
        "nonempty": nonempty,
        "comment": comment,
        "code": nonempty - comment,
    }


rows = [
    count_dir("backend/app/api", [".py"], "Backend: api"),
    count_dir("backend/app/cli", [".py"], "Backend: cli"),
    count_dir("backend/app/shared", [".py"], "Backend: shared"),
    count_dir("backend/tests", [".py"], "Backend: tests"),
    count_dir("frontend/src", [".ts"], "Frontend: TypeScript"),
    count_dir("frontend/src", [".vue"], "Frontend: Vue"),
    count_dir("frontend/tests", [".ts", ".vue"], "Frontend: tests"),
    count_dir("electron/src", [".ts"], "Electron: src"),
]

print(f"{'Label':<25} {'Files':>6} {'Total':>8} {'NonEmpty':>9} {'Comment':>8} {'Code':>8}")
print("-" * 70)
totals = {"files": 0, "total": 0, "code": 0}
for r in rows:
    print(
        f"{r['label']:<25} {r['files']:>6} {r['total']:>8} {r['nonempty']:>9} {r['comment']:>8} {r['code']:>8}"
    )
    totals["files"] += r["files"]
    totals["total"] += r["total"]
    totals["code"] += r["code"]
print("-" * 70)
print(
    f"{'合计':<25} {totals['files']:>6} {totals['total']:>8} {'':>9} {'':>8} {totals['code']:>8}"
)
