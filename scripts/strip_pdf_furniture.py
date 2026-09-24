"""去掉 diancang-data.js 里 text/desc 开头的 PDF 页码残渣。

《文化典藏》把页码印在正文同一行，sync_diancang_text.py 拼接时把它们粘进了正文开头，
实测有 7 条：「hhh大漆…」「21421435迎龙灯…」「513555h11九狮拜象…」这类。
观众在典藏详情和方言命中句里会直接看到这串乱码。

规则：开头 2~10 位纯数字/小写字母算残渣，但「1929年」这种四位年份+汉字是正文，放过。
可重复执行：已经干净的条目不会再动。

    python scripts/strip_pdf_furniture.py
"""
import io
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
P = "js/diancang-data.js"
FIELD = re.compile(r"(text: '|desc: ')((?:[^'\\]|\\.)*)'", re.S)
# 开头一串数字/小写字母；后面紧跟汉字，且不是「1929年」这种年份
FURNITURE = re.compile(r"^(?!19\d\d年|20\d\d年)([0-9a-z]{2,10})(?=[\u4e00-\u9fff])")


def main():
    src = io.open(P, encoding="utf-8").read()
    changed = []

    def sub(m):
        head, body, tail = m.group(1), m.group(2), "'"
        stripped = FURNITURE.sub("", body)
        if stripped != body:
            changed.append((body[:14], stripped[:14]))
        return head + stripped + tail

    out = FIELD.sub(sub, src)
    if not changed:
        print("没有需要清理的残渣（已经是干净的）")
        return 0
    io.open(P, "w", encoding="utf-8", newline="").write(out)
    print("清理 %d 处：" % len(changed))
    for a, b in changed:
        print("  %s…  ->  %s…" % (a, b))
    return 0


if __name__ == "__main__":
    sys.exit(main())
