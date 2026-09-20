"""Run every check for the site in one go.

    python tests/run_all.py            # static integrity + headless browser suite
    python tests/run_all.py --static   # static only (no Chrome needed)

Exits non-zero if any stage fails.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

stages = [("静态检查（引用完整性 / 语法 / 水印回归）", [sys.executable, "tests/check_static.py"])]
if "--static" not in sys.argv:
    stages.append(("浏览器端到端检查（真实 Chrome）", ["node", "tests/run_site_tests.mjs"]))

code = 0
for label, cmd in stages:
    print("\n" + "=" * 62)
    print(label)
    print("=" * 62)
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode:
        code = r.returncode
        print("!! %s 失败 (exit %d)" % (label, r.returncode))

print("\n" + "=" * 62)
print("全部通过" if code == 0 else "存在失败项")
print("=" * 62)
sys.exit(code)
