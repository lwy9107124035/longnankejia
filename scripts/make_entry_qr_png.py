"""把浏览器导出的入口二维码放大成可打印的成品图，并解码自检。

来源是 tests/run_site_tests.mjs 导出的 canvas（或 QR_PNG 指定的任意一份导出）。
放大只用整数倍最近邻：源图每个模块正好 scale 像素，整数倍放大不会引入插值灰边，
印出来仍是干净的方块。写完立刻用 OpenCV 解一遍，解不出来就报错而不是留一张废图。

    python tests/run_site_tests.mjs            # 先生成本地导出
    python scripts/make_entry_qr_png.py        # → docs/入口二维码.png
    QR_PNG=.cache/live-entry-qr.png python scripts/make_entry_qr_png.py  # 用线上那份
"""
import math
import os
import sys

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("QR_PNG") or os.path.join(ROOT, ".cache", "test-shots", "entry-qr.png")
OUT = os.path.join(ROOT, "docs", "入口二维码.png")
TARGET = int(os.environ.get("QR_SIZE", "1000"))


def main():
    if not os.path.exists(SRC):
        print("FAIL  找不到源图 %s（先跑 tests/run_site_tests.mjs）" % SRC)
        return 1
    img = Image.open(SRC).convert("RGB")
    scale = max(1, math.ceil(TARGET / img.width))
    big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)

    import cv2
    import numpy as np
    text, _, _ = cv2.QRCodeDetector().detectAndDecode(np.asarray(big))
    if not text:
        print("FAIL  放大后的图仍解不出内容，不写出成品")
        return 1

    big.save(OUT)
    print("ok    %s  %dx%d（源图 %d 的 %d 倍）-> %s"
          % (os.path.relpath(OUT, ROOT), big.width, big.height, img.width, scale, text))
    return 0


if __name__ == "__main__":
    sys.exit(main())
