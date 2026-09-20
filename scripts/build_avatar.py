"""Build the 阿蓝 digital-human assets from 数字人形象.png.

The source is a hand-drawn character on a pure-white, fully opaque canvas, so the
background has to be keyed out before the figure can sit on the app's paper theme.
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import cv2
import os

SRC = "数字人形象.png"
OUT = "assets/avatar"
PAD = 10


def key_out_background(rgb):
    """Flood-fill the white canvas from every border pixel, then feather the edge."""
    h, w = rgb.shape[:2]
    # cv2.floodFill needs a mask 2px larger in each dimension.
    mask = np.zeros((h + 2, w + 2), np.uint8)
    seeds = []
    for x in range(0, w, 7):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(0, h, 7):
        seeds += [(0, y), (w - 1, y)]
    flags = 4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE
    for sx, sy in seeds:
        if mask[sy + 1, sx + 1]:
            continue
        if int(rgb[sy, sx].min()) < 246:
            continue
        cv2.floodFill(rgb.copy(), mask, (sx, sy), 0, (10, 10, 10), (10, 10, 10), flags)
    bg = mask[1:-1, 1:-1] > 0
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # A 1px blur removes the staircase without eating the dark outline.
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    alpha = np.where(bg, 0, alpha)
    return alpha


def trim(rgb, alpha, pad=PAD):
    ys, xs = np.nonzero(alpha > 8)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + 1 + pad, rgb.shape[1])
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + 1 + pad, rgb.shape[0])
    return rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]


def to_pil(rgb, alpha):
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def save(img, name, max_w=None):
    if max_w and img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    img.save(os.path.join(OUT, name), optimize=True)
    return img.size


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGB")
    rgb = np.asarray(src).copy()
    alpha = key_out_background(rgb)
    rgb, alpha = trim(rgb, alpha)
    full = to_pil(rgb, alpha)
    print("trimmed", full.size)

    sizes = {}
    sizes["alan-full.png"] = save(full, "alan-full.png", max_w=520)

    # Chat-bubble avatar: the head only. The raised arm widens the silhouette below
    # the brim, so measure the hat band to centre the crop on the face instead.
    w, h = full.size
    al = np.asarray(full)[:, :, 3]
    hat = al[: int(h * 0.2)] > 40
    _, xs = np.nonzero(hat)
    cx = int((xs.min() + xs.max()) / 2)
    side = int((xs.max() - xs.min()) * 1.08)
    x0 = max(min(cx - side // 2, w - side), 0)
    head = full.crop((x0, 0, x0 + side, side))
    sizes["alan-face.png"] = save(head, "alan-face.png", max_w=160)

    # Preview over the app's paper background to expose any white halo.
    prev = Image.new("RGBA", (w + 40, h + 40), (247, 243, 235, 255))
    prev.alpha_composite(full, (20, 20))
    prev.convert("RGB").resize((prev.width // 3, prev.height // 3), Image.LANCZOS).save(
        os.path.join(OUT, "_preview_on_paper.jpg"), quality=88
    )
    print(sizes)


if __name__ == "__main__":
    main()
