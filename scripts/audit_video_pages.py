# -*- coding: utf-8 -*-
"""核对"哪件展品配哪个客家话讲解视频"，全部在本地做，不碰视频服务。

三份材料互相核对：
  1. docs/…文化典藏.pdf —— 每页的正文标题（展品名印在页面上，最权威）
  2. data/qr-content.json —— 从 PDF 上解出来的"第几页 → 哪个视频 id"
  3. js/diancang-data.js —— 页面实际挂的"展品 → videoUrl"

第 2 步的 exhibit 字段是当初人/脚本填的，可能错位；所以这里不信它，
只信"那一页的正文里出现的展品名"。对不上的地方全部列出来。

    python scripts/audit_video_pages.py
"""
import io
import json
import os
import re
import sys

import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "docs", "世界客家非遗展示馆文化典藏.pdf")
QR = os.path.join(ROOT, "data", "qr-content.json")
DATA = os.path.join(ROOT, "js", "diancang-data.js")


def items():
    src = io.open(DATA, encoding="utf-8").read()
    out = []
    for block in re.findall(r"\{\s*name:\s*'[^']+'.*?\n        \}", src, re.S):
        name = re.search(r"name:\s*'([^']+)'", block).group(1)
        page = re.search(r"page:\s*(\d+)", block)
        sheet = re.search(r"sheet:\s*(\d+)", block)
        url = re.search(r"videoUrl:\s*'(https:[^']+)'", block)
        vid = re.search(r"id=([\w-]+)", url.group(1)) if url else None
        out.append({"name": name, "page": int(page.group(1)) if page else None,
                    "sheet": int(sheet.group(1)) if sheet else None,
                    "vid": vid.group(1) if vid else None})
    return out


def page_text(doc, n):
    """PDF 页码从 1 数起，fitz 从 0 数起。"""
    return re.sub(r"\s+", "", doc[n - 1].get_text()) if 0 < n <= doc.page_count else ""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    qr = json.load(io.open(QR, encoding="utf-8"))
    id_of_page = {}
    for p, v in qr.items():
        m = re.search(r"id=([\w-]+)", v.get("url") or "")
        if m:
            id_of_page[int(p)] = (m.group(1), v.get("exhibit"))
    lst = items()
    names = [x["name"] for x in lst]
    doc = fitz.open(PDF)

    print("PDF %d 页；qr-content %d 条；展品 %d 件（其中挂视频 %d 件）\n"
          % (doc.page_count, len(id_of_page), len(lst), sum(1 for x in lst if x["vid"])))

    bad = 0
    # A. 每一页印的码：那一页正文里出现的展品名，是不是 qr-content 写的那个
    for p in sorted(id_of_page):
        txt = page_text(doc, p)
        on_page = [n for n in names if n and n in txt]
        claimed = id_of_page[p][1]
        hit = claimed in on_page
        if not hit:
            bad += 1
        print("%s  第%-3d页 码=%s  qr-content 说是[%s]  该页正文里的展品名：%s"
              % ("ok  " if hit else "不匹配", p, id_of_page[p][0], claimed,
                 "、".join(on_page) or "（没匹配到任何展品名）"))

    print("\nB. 页面上实际挂的 videoUrl：这件展品的页码，与那个视频所在页是否一致")
    page_of_id = {v[0]: p for p, v in id_of_page.items()}
    for x in lst:
        if not x["vid"]:
            continue
        p = page_of_id.get(x["vid"])
        txt = page_text(doc, p or 0)
        ok = p is not None and x["name"] in txt
        if not ok:
            bad += 1
        print("%s  %-12s videoUrl=%s → 该视频印在第 %s 页，那页正文%s含[%s]"
              % ("ok  " if ok else "不匹配", x["name"], x["vid"], p,
                 "认" if ok else "不", x["name"]))

    doc.close()
    print("\n合计 %d 处对不上。" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
