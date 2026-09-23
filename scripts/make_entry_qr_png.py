"""生成印展板用的入口二维码成品图：docs/入口二维码.png

地址取自 js/config.js 的 app.canonicalUrl，编码器用的是页面自己那份
（js/vendor/qrcode.js，通过 scripts/qr_matrix.mjs），所以展板上那张和观众在
「访问地址」面板里看到的码一定同源。写完立刻用 OpenCV 解一遍，核对解出来的
字符串与 canonicalUrl 一致——不一致就报错，绝不留一张指错地址的成品图。

    python scripts/make_entry_qr_png.py
    QR_URL=https://example.com/ python scripts/make_entry_qr_png.py   # 临时试别的地址
"""
import os
import re
import subprocess
import sys

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "入口二维码.png")
TARGET = int(os.environ.get("QR_SIZE", "1000"))
QUIET = 4  # 规范要求的静默区


def canonical_url():
    txt = open(os.path.join(ROOT, "js", "config.js"), encoding="utf-8").read()
    m = re.search(r"canonicalUrl:\s*'([^']*)'", txt)
    if not m or not m.group(1).startswith("http"):
        raise SystemExit("FAIL  js/config.js 里没有可用的 app.canonicalUrl")
    return m.group(1)


def matrix(text):
    r = subprocess.run(["node", "scripts/qr_matrix.mjs", text], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise SystemExit("FAIL  编码失败：%s" % (r.stderr or r.stdout)[:200])
    lines = r.stdout.strip().splitlines()
    n = int(lines[0])
    return n, [[ch == '1' for ch in row] for row in lines[1:1 + n]]


def main():
    url = os.environ.get("QR_URL") or canonical_url()
    n, grid = matrix(url)
    scale = max(2, -(-TARGET // (n + QUIET * 2)))
    side = (n + QUIET * 2) * scale
    img = Image.new("L", (side, side), 255)
    px = img.load()
    for r in range(n):
        for c in range(n):
            if not grid[r][c]:
                continue
            for dy in range(scale):
                for dx in range(scale):
                    px[(c + QUIET) * scale + dx, (r + QUIET) * scale + dy] = 0

    import cv2
    import numpy as np
    got, _, _ = cv2.QRCodeDetector().detectAndDecode(np.asarray(img.convert("RGB")))
    if got != url:
        print("FAIL  成品图解出来是 %r，与 canonicalUrl %r 不一致，不写出" % (got, url))
        return 1

    img.convert("RGB").save(OUT)
    print("ok    %s  %dx%d（%d 模块 × %d 倍）-> %s"
          % (os.path.relpath(OUT, ROOT), side, side, n, scale, url))
    return 0


if __name__ == "__main__":
    sys.exit(main())
