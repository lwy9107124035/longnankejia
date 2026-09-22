"""Independently decode the site's entry QR code.

run_site_tests.mjs exports the rendered canvas to .cache/test-shots/entry-qr.png.
Pixel-comparing it against a fresh encode only proves the page is self-consistent;
decoding it here with OpenCV proves a phone at the museum would actually get a URL.

Run after the browser suite:  python tests/run_all.py
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PNG = os.environ.get("QR_PNG") or os.path.join(ROOT, ".cache", "test-shots", "entry-qr.png")


def main():
    if not os.path.exists(PNG):
        print("  skip   没有 %s（先跑浏览器套件，或 scripts/check_live_qr.mjs）" % os.path.basename(PNG))
        return 0
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except ImportError:
        print("  skip   需要 opencv-python + Pillow 才能解码")
        return 0

    img = np.asarray(Image.open(PNG).convert("RGB"))
    det = cv2.QRCodeDetector()
    text, pts, _ = det.detectAndDecode(img)
    if not text:
        # scanned codes sometimes need a quiet zone and a bit of upscaling
        big = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        pad = cv2.copyMakeBorder(big, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        text, pts, _ = det.detectAndDecode(pad)

    if not text:
        print("  FAIL   入口二维码无法解码——观众的手机扫不出来 (%dx%d)" % (img.shape[1], img.shape[0]))
        return 1
    if not text.startswith("http"):
        print("  FAIL   解码结果不是网址: %r" % text)
        return 1
    print("  ok     入口二维码可被独立解码 -> %s" % text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
