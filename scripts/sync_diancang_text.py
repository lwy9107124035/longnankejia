"""Put the book's full passage into each 典藏 exhibit.

The `desc` field carried a 30-50 character summary while the book's own text runs to
~200 characters, so the detail view showed about a fifth of what the source says. This
adds a `text` field with the full passage from the PDF; `desc` stays as the card preview.

Run:  python scripts/sync_diancang_text.py
"""
import io, json, re, sys

sys.stdout.reconfigure(encoding="utf-8")
MARK = "扫描二维码观看龙南方言介绍视频"
DATA = "js/diancang-data.js"
OPENINGS = "data/exhibit-openings.json"


def book_text(sheet):
    raw = io.open(".cache/pdf/page-%02d.txt" % sheet, encoding="utf-8").read()
    body = raw.split(MARK, 1)[1] if MARK in raw else raw
    # the IPA bracket is already carried in the item's own ipa field
    body = re.sub(r"\[[^\]]*\]", "", body)
    # the PDF wraps paragraphs mid-sentence; rejoin, then keep real paragraph breaks
    body = re.sub(r"\s*\n\s*", "", body)
    body = re.sub(r"\s+", "", body)
    # strip a leading page-furniture artefact if the title characters leaked through
    return body.strip()


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
    src = io.open(DATA, encoding="utf-8").read()

    done = skipped = failed = 0
    for name, rec in openings.items():
        text = book_text(rec["sheet"])
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
