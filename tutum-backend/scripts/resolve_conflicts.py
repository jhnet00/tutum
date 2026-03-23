import re

files = [
    r"d:\dev\final\docs\K8S_MIGRATION_PLAN.md",
    r"d:\dev\final\docs\K8S_TECH_STACK.md",
    r"d:\dev\final\docs\ruby\01_MINIO_PLAN.md",
    r"d:\dev\final\docs\ruby\03_TROUBLESHOOTING_GITRECORD.md",
]

# Keep origin/develop side (theirs), discard HEAD side (ours)
pattern = re.compile(
    r"<<<<<<< HEAD\r?\n(.*?)=======\r?\n(.*?)>>>>>>> [^\n]+\r?\n", re.DOTALL
)

for path in files:
    try:
        with open(path, "r", encoding="utf-8") as f:
            original = f.read()
        conflicts_before = original.count("<<<<<<< HEAD")
        resolved = pattern.sub(lambda m: m.group(2), original)
        conflicts_after = resolved.count("<<<<<<< HEAD")
        print(f"{path}: {conflicts_before} conflicts -> {conflicts_after} remaining")
        with open(path, "w", encoding="utf-8") as f:
            f.write(resolved)
    except Exception as e:
        print(f"ERROR {path}: {e}")

print("Done.")
