"""Report every committed path in history whose content contains an API-key-shaped string.

Run before shipping a full-history backup anywhere: js/secrets.js is gitignored, but a
key can still have leaked into another file that was committed at some point.
"""
import re
import subprocess
import sys

KEY = re.compile(rb"sk-[A-Za-z0-9]{20,}")

out = subprocess.run(
    ["git", "rev-list", "--all", "--objects"],
    capture_output=True, check=True,
).stdout.decode("utf-8", "replace")

seen = {}
for line in out.splitlines():
    parts = line.split(" ", 1)
    sha, path = parts[0], (parts[1] if len(parts) > 1 else "")
    if not path or sha in seen:
        continue
    seen[sha] = path

hits = []
for sha, path in seen.items():
    r = subprocess.run(["git", "cat-file", "-p", sha], capture_output=True)
    if r.returncode != 0:
        continue  # not a blob, or missing
    if KEY.search(r.stdout):
        hits.append((path, sha, len(r.stdout)))

print("scanned %d candidate objects" % len(seen))
if not hits:
    print("no committed file contains an sk- shaped key")
else:
    print("LEAKED INTO %d path(s):" % len(hits))
    for path, sha, size in sorted(hits):
        print("   %s   (blob %s, %d bytes)" % (path, sha[:10], size))
sys.exit(1 if hits else 0)
