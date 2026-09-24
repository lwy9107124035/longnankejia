"""把书里 QR 指向、但还没接进页面的两条客家话讲解链接补上。

data/qr-content.json 里一共 16 条 hlcode.pro 链接，页面只挂了 14 条：
第 41 页「客家寿诞」和第 57 页「九狮拜象」漏了。按展品名定位，只改这两处。
"""
import io
import json
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
P = "js/diancang-data.js"
src = io.open(P, encoding="utf-8").read()

qr = json.load(io.open("data/qr-content.json", encoding="utf-8"))
by_exhibit = {}
for page, v in qr.items():
    by_exhibit[v.get("exhibit")] = v["url"]

targets = [n for n in ("客家寿诞", "九狮拜象") if n in by_exhibit]
assert len(targets) == 2, "qr-content.json 里找不到这两个展品的链接"

out = src
for name in targets:
    url = by_exhibit[name]
    i = out.find("name: '%s'" % name)
    assert i >= 0, name
    j = out.find("videoUrl: null", i)
    assert 0 <= j < i + 4000, "%s 的 videoUrl 不在块内" % name
    out = out[:j] + ("videoUrl: '%s'" % url) + out[j + len("videoUrl: null"):]

io.open(P, "w", encoding="utf-8", newline="").write(out)
wired = re.findall(r"videoUrl:\s*'(https://[^']+)'", out)
print("已挂链接：%d 条（补了 %d 条）" % (len(wired), len(targets)))
for name in targets:
    print("  %-8s %s" % (name, by_exhibit[name]))
