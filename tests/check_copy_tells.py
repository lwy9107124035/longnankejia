# -*- coding: utf-8 -*-
"""界面文案的"AI 套话"计数与守卫。

判据来自 humanizer-zh（blader/humanizer 的汉化版）31 条模式里最容易复发的一批：
套话词、句尾拔高、假对比、格言式收尾。这里只列能被机械匹配的那部分。

注释和《文化典藏》原文都不算：前者观众看不到，后者是引文，一个字都不能改。
所以先剥注释再数——这也是 tests/check_static.py 里那道守卫用的同一套函数，
量法只有一份，不会两处判得不一样。

    python tests/check_copy_tells.py        # 打印命中；有命中就非零退出
"""
import io
import os
import re
import sys

TELLS = [
    "匠心", "赋能", "无缝", "深入探讨", "至关重要", "闭环", "彰显", "值得一提",
    "总而言之", "在当今", "一站式", "助力", "致力于打造", "旨在", "力求",
    "完美融合", "独一无二", "带你探访", "焕发出新的生机", "深厚的文化底蕴",
]

FILES = ["index.html", "js/ui.js", "js/answer-engine.js", "js/hometown.js",
         "js/diancang.js", "js/dialect.js", "js/voice-input.js", "js/config.js"]


def strip_comments(text, path):
    """剥掉 HTML 注释、块注释和整行 // 注释，只留下观众看得见的部分。"""
    if path.endswith(".html"):
        text = re.sub(r"<!--[\s\S]*?-->", "", text)
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return re.sub(r"(?m)^\s*//.*$", "", text)


def scan(root):
    """返回 [(文件, {套话: 次数}), ...]。"""
    out = []
    for rel in FILES:
        with io.open(os.path.join(root, *rel.split("/")), encoding="utf-8") as f:
            body = strip_comments(f.read(), rel)
        hits = {t: body.count(t) for t in TELLS if t in body}
        if hits:
            out.append((rel, hits))
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    hits = scan(root)
    total = sum(sum(h.values()) for _, h in hits)
    for rel, h in hits:
        print("  %-24s %s" % (rel, "、".join("%s×%d" % (k, v) for k, v in sorted(h.items()))))
    print("界面文案套话命中：%d 处（守卫要求 0）" % total)
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
