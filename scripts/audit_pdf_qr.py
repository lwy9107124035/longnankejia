# -*- coding: utf-8 -*-
"""解码《文化典藏》PDF 每一页上印的二维码，得到"第几页 → 哪个视频"的权威对应。

站点里每件展品的 videoUrl 是从 js/diancang-data.js 的 QR_VIDEOS 表按 sheet 取的。
这张表当初怎么来的、有没有错位，页面上的文字看不出来——只有把 PDF 上印的码
真解出来才能核对。结果同时和展品 name 对一遍：码指向的 id 与展品对不上，
就是挂错了，观众点"客家话讲解"会听到别的东西。

    python scripts/audit_pdf_qr.py                 # 全量解码并比对
    python scripts/audit_pdf_qr.py --json out.json
"""
import io
import json
import os
import re
import sys

import cv2
import fitz
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "docs", "世界客家非遗展示馆文化典藏.pdf")
DATA = os.path.join(ROOT, "js", "diancang-data.js")


def qr_videos():
    src = io.open(DATA, encoding="utf-8").read()
    block = src[src.index("window.QR_VIDEOS"):src.index("};", src.index("window.QR_VIDEOS"))]
    return {int(k): v for k, v in re.findall(r"'(\d+)':\s*'(https:[^']+)'", block)}


def items():
    """展品条目：name / page / sheet（sheet 是取视频用的编号）。"""
    src = io.open(DATA, encoding="utf-8").read()
    out = []
    for m in re.finditer(r"\{\s*name:\s*'([^']+)'(.*?)\}", src, re.S):
        body = m.group(2)
        if "videoUrl" not in body and "sheet" not in body:
            continue
        page = re.search(r"page:\s*(\d+)", body)
        sheet = re.search(r"sheet:\s*(\d+)", body)
        out.append({"name": m.group(1),
                    "page": int(page.group(1)) if page else None,
                    "sheet": int(sheet.group(1)) if sheet else None})
    return out


def decode_pages(dpi=170):
    doc = fitz.open(PDF)
    det = cv2.QRCodeDetector()
    found = {}
    for i in range(doc.page_count):
        pix = doc[i].get_pixmap(dpi=dpi)
        img = np.frombuffer(pix.samples, dtype=np.uint8)
        img = img.reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
        else:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        ok, texts, _, _ = det.detectAndDecodeMulti(img)
        if not ok:
            continue
        urls = [t for t in texts if t and "hlcode.pro" in t]
        if urls:
            found[i + 1] = sorted(set(urls))
    doc.close()
    return found


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if not os.path.exists(PDF):
        print("找不到 PDF：", PDF)
        return 1
    qr = qr_videos()
    lst = items()
    found = decode_pages()
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        json.dump(found, io.open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("PDF 解码结果写入", out)

    print("PDF 共 %d 页，解出带 hlcode.pro 的二维码 %d 页；QR_VIDEOS 表 %d 条；展品 %d 件"
          % (fitz.open(PDF).page_count, len(found), len(qr), len(lst)))

    # 表里的 sheet 编号 → 该页解出的码，必须就是同一个 id
    id_of = lambda u: (re.search(r"[?&]id=([\w-]+)", u or "") or [None, ""])[1]
    bad = 0
    for sheet in sorted(qr):
        got = [id_of(u) for page, urls in found.items() for u in urls if page == sheet]
        want = id_of(qr[sheet])
        names = [x["name"] for x in lst if x["sheet"] == sheet]
        if not got:
            print("  缺  sheet %2d (%s) 表里写着 %s，但 PDF 第 %d 页没解出码"
                  % (sheet, "、".join(names) or "?", want, sheet))
            bad += 1
        elif want not in got:
            print("  错位 sheet %2d (%s) 表里写着 %s，PDF 那页实际是 %s"
                  % (sheet, "、".join(names) or "?", want, "/".join(got)))
            bad += 1
        else:
            print("  ok  sheet %2d (%s) → %s" % (sheet, "、".join(names) or "?", want))

    # 反向：PDF 上解出的码，有没有没进表的
    table_ids = {id_of(u) for u in qr.values()}
    for page, urls in sorted(found.items()):
        for u in urls:
            if id_of(u) not in table_ids:
                print("  漏  PDF 第 %d 页的码 %s 不在 QR_VIDEOS 表里" % (page, id_of(u)))
                bad += 1
    print("\n%d 处对不上。" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
