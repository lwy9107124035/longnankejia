"""Give every 典藏 exhibit the correct PDF sheet for its image.

The `page` field in diancang-data.js is the book's *printed* page number, but the
extracted images are named assets/pdf-imgs/page-NN.jpg by *sheet index*. The two drift
apart by -5 to -2 through the book, so every detail image and thumbnail was showing a
different exhibit's page than the text it illustrated.

This adds a `sheet` field used for image paths, leaves `page` alone so the printed-page
citation readers see stays correct, and writes data/exhibit-openings.json recording how
each sheet's body text begins. tests/check_static.py then asserts the exhibit's own name
appears in that opening, which makes a wrong mapping impossible to ship.

Run:  python scripts/sync_diancang_pages.py
"""
from __future__ import annotations
import fitz
import io
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

PDF = "docs/世界客家非遗展示馆文化典藏.pdf"
DATA = "js/diancang-data.js"
OPENINGS = "data/exhibit-openings.json"
MARK = "扫描二维码观看龙南方言介绍视频"


def sheet_bodies():
    """sheet index -> (body text, big display title).

    The title is the vertical display line above the "scan the QR" marker. PyMuPDF
    emits vertical CJK bottom-to-top, so it comes out reversed; comparing it as a
    character set is what reliably ties a sheet to an exhibit, because several
    exhibits never repeat their own name in the body text.
    """
    doc = fitz.open(PDF)
    out = {}
    for i, page in enumerate(doc, start=1):
        text = page.get_text()
        head, _, tail = text.partition(MARK)
        body = tail if tail else text
        title = re.sub(r"[^\w一-鿿]", "", head) if tail else ""
        body = re.sub(r"\[[^\]]*\]", "", body)
        out[i] = (re.sub(r"\s+", "", body), title)
    return out


def norm(name):
    return re.sub(r"[\"“”‘’《》()（）\s]", "", name)


def match_items(items, bodies):
    """items: [(name, page)] in book order. Returns {name: sheet}."""
    used = set()
    resolved = {}
    for name, _page in items:
        n = norm(name)
        if not n:
            continue
        cands = [i for i, b in bodies.items() if b.startswith(n) and i not in used]
        if not cands:
            cands = [i for i, b in bodies.items() if n in b[:24] and i not in used]
        if len(cands) == 1:
            resolved[name] = cands[0]
            used.add(cands[0])
    # anything left gets the smallest unused sheet after its predecessor's sheet,
    # because both the data and the PDF run in book order
    order = [n for n, _ in items]
    for k, name in enumerate(order):
        if name in resolved:
            continue
        prev = None
        for j in range(k - 1, -1, -1):
            if order[j] in resolved:
                prev = (order[j], resolved[order[j]])
                break
        nxt = None
        for j in range(k + 1, len(order)):
            if order[j] in resolved:
                nxt = (order[j], resolved[order[j]])
                break
        lo = prev[1] if prev else 0
        hi = nxt[1] if nxt else max(bodies) + 1
        gap = [i for i in sorted(bodies) if lo < i < hi and i not in used]
        if len(gap) == 1:
            resolved[name] = gap[0]
            used.add(gap[0])
    return resolved


def main():
    sheets = sheet_bodies()
    bodies = {i: v[0] for i, v in sheets.items()}
    titles = {i: v[1] for i, v in sheets.items()}
    src = io.open(DATA, encoding="utf-8").read()
    items = re.findall(r"name:\s*'([^']+)'[^}]*?page:\s*'?(\d+)'?", src)
    resolved = match_items(items, bodies)

    missing = [n for n, _ in items if n not in resolved]
    print("matched %d / %d exhibits" % (len(resolved), len(items)))
    if missing:
        print("UNRESOLVED (left on printed page, needs a human):", missing)

    changed = 0
    out_lines = []
    for line in src.split("\n"):
        m = re.search(r"name:\s*'([^']+)'", line)
        if m and m.group(1) in resolved:
            name = m.group(1)
            sheet = resolved[name]
            if re.search(r"\bsheet:\s*\d+", line):
                new = re.sub(r"\bsheet:\s*\d+", "sheet: %d" % sheet, line)
            else:
                new = re.sub(r"(name:\s*'[^']+')", r"\1, sheet: %d" % sheet, line, count=1)
            if new != line:
                changed += 1
            line = new
        out_lines.append(line)
    src = "\n".join(out_lines)
    io.open(DATA, "w", encoding="utf-8", newline="").write(src)
    print("wrote sheet field on %d lines" % changed)

    openings = {
        str(name): {"sheet": sheet, "opening": bodies[sheet][:200],
                    "title": titles.get(sheet, "")}
        for name, sheet in resolved.items()
    }
    os.makedirs("data", exist_ok=True)
    io.open(OPENINGS, "w", encoding="utf-8").write(
        json.dumps(openings, ensure_ascii=False, indent=2) + "\n")
    print("wrote", OPENINGS)


if __name__ == "__main__":
    main()
