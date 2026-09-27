# -*- coding: utf-8 -*-
"""按重挂后的对应关系，修知识库条目里的 📺 链接和聊天挂卡用的触发词表。

  1. 条目末尾那句"📺 可观看客家话讲解视频：…"——只有当这条目的主角确实有
     自己的讲解视频时才留，并把链接换成它自己的 id；没有的整句删掉。
     挂着别人的视频就是错信息。
  2. window.VIDEO_TRIGGERS（在 js/diancang-data.js）整表重建：只留两字以上、
     不会误伤的词。原表里有 '戏'、'唱'、'调'、'汤'、'鼓'、'炭' 这类单字，
     答案里沾一个字就挂视频。

    python scripts/fix_video_links.py --dry
    python scripts/fix_video_links.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = os.path.join(ROOT, "js", "knowledge-base.js")
DATA = os.path.join(ROOT, "js", "diancang-data.js")

# 条目主角 → 该看哪件展品的讲解。语义不等同的一律不映射（映射不到就不挂）。
KB_SUBJECT = {
    '采茶戏': '采茶戏', '黄元米果': '黄元米果', '仙水冻': '仙水冻',
    '三及第': '三及第', '火笼': '火笼', '走古事': '走古事',
    '乌石围': '乌石围', '虎形围': '虎形围', '客家擂茶': '客家擂茶',
    '线粉': '线粉', '花带': '花带', '织带': '花带',
}

TRIGGERS = {
    '乌石围': ['乌石围', '磐石围'],
    '虎形围': ['虎形围', '虎形'],
    '采茶戏': ['采茶戏', '采茶'],
    '芋汇': ['芋汇', '芋头'],
    '黄元米果': ['黄元米果', '米果'],
    '客家擂茶': ['擂茶'],
    '精珠子': ['精珠子', '凤眼珍珠'],
    '仙水冻': ['仙水冻', '仙人粄'],
    '线粉': ['线粉'],
    '三及第': ['三及第'],
    '花带': ['花带', '织带'],
    '衫': ['交领', '襟衫', '蓝衫'],
    '冬头帕': ['冬头帕', '头帕'],
    '火笼': ['火笼'],
    '走古事': ['走古事'],
    '龙舟': ['龙舟', '龙船会'],
}

SENT = re.compile(r"📺 可观看客家话讲解视频：https://\S*?(?=')")


def owners():
    src = io.open(DATA, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"\{\s*name:\s*'([^']*)'(.*?)\}", src, re.S):
        u = re.search(r"videoUrl:\s*'(https:[^']+)'", m.group(2))
        if u:
            out[m.group(1)] = u.group(1)
    return out


def write(path, text):
    tmp = path + ".tmp"
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(text)
    os.replace(tmp, path)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    dry = "--dry" in sys.argv
    own = owners()
    kb = io.open(KB, encoding="utf-8").read()

    blocks = kb.split("\n  {\n")
    kept, dropped, out_blocks = [], [], [blocks[0]]
    for b in blocks[1:]:
        t = re.search(r"title: '([^']+)'", b)
        title = t.group(1) if t else "?"
        hits = list(SENT.finditer(b))
        if not hits:
            out_blocks.append(b)
            continue
        url = own.get(KB_SUBJECT.get(title, ""))
        if url:
            b2 = SENT.sub("📺 可观看客家话讲解视频：" + url, b)
            kept.append("%s：%d 处链接已指向它自己的视频" % (title, len(hits)))
            out_blocks.append(b2)
        else:
            b2 = re.sub(r"[，。；、\s]*" + SENT.pattern, "", b)
            b2 = SENT.sub("", b2)
            dropped.append(title)
            out_blocks.append(b2)
    kb2 = "\n  {\n".join(out_blocks)

    src = io.open(DATA, encoding="utf-8").read()
    block = re.search(r"window\.VIDEO_TRIGGERS = \{[\s\S]*?\n\};", src)
    assert block, "找不到 VIDEO_TRIGGERS"
    body = ",\n".join("  '%s': [%s]" % (k, ", ".join("'%s'" % w for w in v))
                      for k, v in TRIGGERS.items())
    data2 = src[:block.start()] + "window.VIDEO_TRIGGERS = {\n%s\n};" % body + src[block.end():]

    for s in kept:
        print("  留  " + s)
    for s in dropped:
        print("  删  %s（该展品没有自己的讲解视频）" % s)
    print("触发词表重建：%d 件展品、%d 个词，最短 %d 字"
          % (len(TRIGGERS), sum(len(v) for v in TRIGGERS.values()),
             min(len(w) for v in TRIGGERS.values() for w in v)))
    left = len(re.findall(r"可观看客家话讲解视频", kb2))
    print("知识库里还剩 %d 处 📺 链接" % left)
    if dry:
        print("\n--dry：没写盘")
        return 0
    write(KB, kb2)
    write(DATA, data2)
    print("已写回 knowledge-base.js 与 diancang-data.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
