"""Put the book's full passage into each 典藏 exhibit.

The `desc` field carried a 30-50 character summary while the book's own text runs to
~200 characters, so the detail view showed about a fifth of what the source says. This
adds a `text` field with the full passage from the PDF; `desc` stays as the card preview.

Run:  python scripts/sync_diancang_text.py
"""
import io, json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8")
MARK = "扫描二维码观看龙南方言介绍视频"
DATA = "js/diancang-data.js"
OPENINGS = "data/exhibit-openings.json"
PDF = "docs/世界客家非遗展示馆文化典藏.pdf"


def sheet_texts():
    """Extract every page's body straight from the PDF.

    Reads the document rather than a cached .cache/pdf/ dump so the script keeps
    working after scratch directories are cleared.
    """
    import fitz
    if not os.path.exists(PDF):
        sys.exit("找不到 %s —— 本脚本靠它取原文，请把典藏 PDF 放回 docs/" % PDF)
    doc = fitz.open(PDF)
    out = {}
    for i, page in enumerate(doc, start=1):
        raw = page.get_text()
        body = raw.split(MARK, 1)[1] if MARK in raw else raw
        body = re.sub(r"\[[^\]]*\]", "", body)       # IPA bracket lives in item.ipa
        body = re.sub(r"\s*\n\s*", "", body)         # rejoin mid-sentence wraps
        out[i] = re.sub(r"\s+", "", body)
    return out


def js_str(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")


def insert_text(src, name, quoted):
    """Insert `text: '...'` just before the videoUrl field of one exhibit.

    Located by scanning rather than one big regex: the item blocks are multi-line and
    contain nested quotes (the IPA field), which makes a single pattern fragile.
    Returns (new_src, ok).
    """
    anchor = src.find("name: '%s'" % name)
    if anchor < 0:
        return src, False
    d = src.find("desc: '", anchor)
    if d < 0:
        return src, False
    # walk to the closing quote of the desc string literal, honouring backslash escapes
    i = d + len("desc: '")
    while i < len(src):
        if src[i] == "\\":
            i += 2
            continue
        if src[i] == "'":
            break
        i += 1
    else:
        return src, False
    v = src.find("videoUrl:", i)
    if v < 0:
        return src, False
    # reuse the indentation the videoUrl line already has
    bol = src.rfind("\n", 0, v) + 1
    indent = src[bol:v].rstrip()
    return src[:v] + quoted + ",\n" + indent + src[v:], True


def main():
    openings = json.load(io.open(OPENINGS, encoding="utf-8"))
    texts = sheet_texts()
    src = io.open(DATA, encoding="utf-8").read()

    done = skipped = failed = 0
    for name, rec in openings.items():
        text = texts.get(rec["sheet"], "")
        if len(text) < 40:
            print("skip (too short):", name)
            skipped += 1
            continue
        anchor = src.find("name: '%s'" % name)
        nxt = src.find("name: ", anchor + 1)
        block = src[anchor: nxt if nxt > 0 else anchor + 2000]
        if "text:" in block:
            print("already has text:", name)
            skipped += 1
            continue
        src, ok = insert_text(src, name, "text: '%s'" % js_str(text))
        if not ok:
            print("FAILED:", name)
            failed += 1
        else:
            done += 1

    io.open(DATA, "w", encoding="utf-8", newline="").write(src)
    print("inserted text on %d exhibits, skipped %d, failed %d" % (done, skipped, failed))


if __name__ == "__main__":
    main()
