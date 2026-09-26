# -*- coding: utf-8 -*-
"""Dump every user-visible Chinese string literal, for an editorial pass.

Comments are stripped first (the audience never reads them) and the two data
files holding 《文化典藏》 text are excluded, because those are quotations and
not ours to rewrite.
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tests"))
from check_copy_tells import FILES, strip_comments  # same file list the guard uses

EXTRA = ["js/knowledge-base.js", "js/app.js", "js/showcase3d.js"]
CJK = re.compile(u"[\u4e00-\u9fff]")
STR = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    for rel in FILES + EXTRA:
        p = os.path.join(ROOT, *rel.split("/"))
        if not os.path.exists(p):
            continue
        raw = io.open(p, encoding="utf-8").read().split("\n")
        body = strip_comments("\n".join(raw), rel).split("\n")
        print("\n" + "=" * 70)
        print(rel)
        print("=" * 70)
        for i, line in enumerate(body):
            if not CJK.search(line):
                continue
            vals = [a or b for a, b in STR.findall(line)]
            vals = [v for v in vals if v and CJK.search(v)]
            if vals:
                print("%5d  %s" % (i + 1, " | ".join(vals)))


if __name__ == "__main__":
    main()
