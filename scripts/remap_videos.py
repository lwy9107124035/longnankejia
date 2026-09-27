# -*- coding: utf-8 -*-
"""把 16 件展品的客家话讲解视频按 sheet（风琴页页序）重挂一遍。

根因：data/qr-content.json 的键是 PDF 页序（= 展品数据里的 sheet），而
js/diancang-data.js 当初按读者看到的页码 page 去对，两套页码在风琴页上差得不
止一位（乌石围 page10/sheet15，龙舟 page58/sheet60），于是每件展品的讲解都串到
了隔壁。

独立证据（不靠推断）：视频服务自己的接口返回的 vodName 是文件真名——
  Na61TLY → 线粉.mp4   （线粉 sheet=39，而 page=39 的展品是「一桌菜」）
  Na61TL1 → 冬头帕.mp4 （冬头帕 sheet=52，而 page=52 的展品是「火笼」）
两条都指向 sheet。

    python scripts/remap_videos.py --dry   # 只看会改什么
    python scripts/remap_videos.py         # 真改
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "js", "diancang-data.js")
QR = os.path.join(ROOT, "data", "qr-content.json")


def item_blocks(src):
    """按花括号配对切出每个 { name: '…' … } 块，返回 [(name, start, end)]。"""
    out = []
    for m in re.finditer(r"\{\s*name:\s*'([^']*)'", src):
        i = m.start()
        depth = 0
        j = i
        while j < len(src):
            c = src[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append((m.group(1), i, j + 1))
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    dry = "--dry" in sys.argv
    src = io.open(DATA, encoding="utf-8").read()
    qr = json.load(io.open(QR, encoding="utf-8"))

    sheet_of, blocks = {}, {}
    for name, s, e in item_blocks(src):
        body = src[s:e]
        sh = re.search(r"sheet:\s*(\d+)", body)
        if sh:
            sheet_of[int(sh.group(1))] = name
        blocks[name] = (s, e)

    want = {}          # 展品名 -> 该挂的 url
    for page, v in qr.items():
        owner = sheet_of.get(int(page))
        if not owner:
            print("!! PDF 第 %s 页的码找不到对应 sheet 的展品" % page)
            continue
        want[owner] = v["url"]

    current = {}
    for name, (s, e) in blocks.items():
        u = re.search(r"videoUrl:\s*'(https:[^']+)'", src[s:e])
        if u:
            current[name] = u.group(1)

    edits = []
    for name in set(list(want) + list(current)):
        if want.get(name) == current.get(name):
            continue
        edits.append((name, current.get(name), want.get(name)))
    if not edits:
        print("已经全部按 sheet 挂好了，无需改动。")
        return 0

    # 从后往前替换，避免前面的改动挪动后面的偏移
    out = src
    for name, old, new in sorted(edits, key=lambda x: -blocks[x[0]][0]):
        s, e = blocks[name]
        body = out[s:e]
        if new:
            if re.search(r"videoUrl:\s*null", body):
                body2 = re.sub(r"videoUrl:\s*null", "videoUrl: '%s'" % new, body, count=1)
            else:
                body2 = re.sub(r"videoUrl:\s*'https:[^']*'", "videoUrl: '%s'" % new, body, count=1)
        else:
            body2 = re.sub(r"videoUrl:\s*'https:[^']*'", "videoUrl: null", body, count=1)
        assert body2 != body, "没动到 " + name
        out = out[:s] + body2 + out[e:]

    for name, old, new in sorted(edits):
        print("%-10s  %s → %s" % (name,
                                  (re.search(r"id=([\w-]+)", old).group(1) if old else "无"),
                                  (re.search(r"id=([\w-]+)", new).group(1) if new else "无（该展品没有码）")))
    if dry:
        print("\n--dry：没写盘，共 %d 处待改" % len(edits))
        return 0
    tmp = DATA + ".tmp"
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(out)
    os.replace(tmp, DATA)

    # qr-content 的 exhibit 字段当初也是按 page 填的，一并纠正
    q2 = {}
    for page, v in qr.items():
        v = dict(v)
        v["exhibit"] = sheet_of.get(int(page), v.get("exhibit"))
        q2[page] = v
    tmp = QR + ".tmp"
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(
        json.dumps(q2, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, QR)
    print("\n已改 %d 处挂载，并同步纠正 data/qr-content.json 的 exhibit 字段。" % len(edits))
    return 0


if __name__ == "__main__":
    sys.exit(main())
