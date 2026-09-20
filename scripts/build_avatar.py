"""Build the 阿蓝 digital-human assets from 数字人形象.png.

The source is a hand-drawn character on a pure-white, fully opaque canvas, so the
background has to be keyed out before the figure can sit on the app's paper theme.
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import cv2
import os

SRC = "assets/source/数字人形象.png"
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
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGB")
    rgb = np.asarray(src).copy()
    alpha = key_out_background(rgb)
    rgb, alpha = trim(rgb, alpha)
    full = to_pil(rgb, alpha)
    print("trimmed", full.size)

    # Every shipped layer must share one canvas: the eye and mouth coordinates below
    # are measured on this 520-wide image, and the browser stacks the layers with
    # object-fit: contain, so a mismatched canvas silently offsets the features.
    base = save(full, "alan-full.png", max_w=520)
    sizes = {"alan-full.png": base.size}
    w, h = base.size

    # Chat-bubble avatar: the head only. The raised arm widens the silhouette below
    # the brim, so measure the hat band to centre the crop on the face instead.
    al = np.asarray(base)[:, :, 3]
    hat = al[: int(h * 0.2)] > 40
    _, xs = np.nonzero(hat)
    cx = int((xs.min() + xs.max()) / 2)
    side = int((xs.max() - xs.min()) * 1.08)
    x0 = max(min(cx - side // 2, w - side), 0)
    head = base.crop((x0, 0, x0 + side, side))
    sizes["alan-face.png"] = save(head, "alan-face.png", max_w=160).size

    build_expression_layers(base, OUT)

    # Preview over the app's paper background to expose any white halo.
    prev = Image.new("RGBA", (w + 40, h + 40), (247, 243, 235, 255))
    prev.alpha_composite(full, (20, 20))
    # 预览写到 .cache，别落进要发布的 assets 里
    os.makedirs(".cache", exist_ok=True)
    prev.convert("RGB").resize((prev.width // 3, prev.height // 3), Image.LANCZOS).save(
        ".cache/avatar_preview.jpg", quality=88
    )
    print(sizes)




# ---------------------------------------------------------------- 表情覆盖层
# 眨眼和口型用「与原图完全重合的覆盖层」实现：覆盖层和底图同一坐标系、
# 同一位置，只在不透明像素处替换，所以不会出现分层旋转那种接缝。
SKIN = (244, 237, 216)        # 眼间/唇上取样得到的面部肤色
LASH = (58, 48, 44)           # 闭合时的睫毛线颜色，取自眼部描边
EYES = [(186, 200, 256, 278), (276, 180, 346, 258)]   # 左眼 / 右眼，含眼白描边圈
MOUTH = (250, 250, 297, 289)


def _lid_overlay(size, boxes, closed=True):
    """Paint skin over each box, then a curved lash line so it reads as a shut eye."""
    import cv2
    w, h = size
    img = np.zeros((h, w, 4), np.uint8)
    for x0, y0, x1, y1 in boxes:
        cv2.ellipse(img, ((x0 + x1) // 2, (y0 + y1) // 2),
                    ((x1 - x0) // 2, (y1 - y0) // 2), 0, 0, 360, SKIN + (255,), -1)
    if closed:
        for x0, y0, x1, y1 in boxes:
            c = ((x0 + x1) // 2, (y0 + y1) // 2)
            ax, ay = (x1 - x0) // 2 - 3, (y1 - y0) // 2 - 5
            cv2.ellipse(img, c, (ax, ay), 0, 25, 155, LASH + (255,), 3, cv2.LINE_AA)
    return img


def build_expression_layers(full, out_dir):
    """Emit alan-blink.png and alan-mouth-closed.png aligned to alan-full.png."""
    import cv2
    w, h = full.size
    blink = _lid_overlay((w, h), EYES, closed=True)
    Image.fromarray(blink, "RGBA").save(os.path.join(out_dir, "alan-blink.png"), optimize=True)

    mouth = _lid_overlay((w, h), [MOUTH], closed=False)
    # 闭口帧：把张开的嘴盖掉，再画一条上扬的微笑线
    x0, y0, x1, y1 = MOUTH
    cv2.ellipse(mouth, ((x0 + x1) // 2, (y0 + y1) // 2 - 2),
                ((x1 - x0) // 2, (y1 - y0) // 2 - 3), 0, 0, 360, SKIN + (255,), -1)
    cv2.ellipse(mouth, ((x0 + x1) // 2, (y0 + y1) // 2 - 6),
                ((x1 - x0) // 2 - 5, (y1 - y0) // 2 - 3), 0, 20, 160, LASH + (255,), 3, cv2.LINE_AA)
    Image.fromarray(mouth, "RGBA").save(os.path.join(out_dir, "alan-mouth-closed.png"), optimize=True)
    print("expression layers written")


if __name__ == "__main__":
    main()
