"""Rectify small, material-only crops from the six textile reference photos."""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "3D模型参考原图"
OUT = ROOT / "assets" / "model-textures"
OUT.mkdir(parents=True, exist_ok=True)

# Coordinates are normalized TL, TR, BR, BL corners in each complete source photo.
# They target the cloth itself; perspective correction removes the camera angle without
# introducing the display case, table, mannequin, or unrelated adjacent objects.
CROPS = {
    "cloth-huamao-face.jpg": (
        "花帽/微信图片_20260928203744_219_964.jpg",
        [(0.20, 0.32), (0.89, 0.32), (0.89, 0.58), (0.20, 0.58)],
        (900, 620),
    ),
    "cloth-huamao-top.jpg": (
        "花帽/微信图片_20260928203744_219_964.jpg",
        # Broad white embroidered crown band, including its red and magenta
        # borders. This is the sewn-on upper piece above the tiger face.
        [(0.025, 0.115), (0.975, 0.115), (0.975, 0.345), (0.025, 0.345)],
        (1200, 290),
    ),
    "cloth-huamao-side.png": (
        "花帽/微信图片_20260928203744_217_964.jpg",
        [(0.08, 0.00), (0.39, 0.00), (0.39, 0.18), (0.08, 0.18)],
        (700, 700),
    ),
    "cloth-huamao-drape.jpg": (
        "花帽/微信图片_20260928203744_219_964.jpg",
        [(0.08, 0.60), (0.90, 0.60), (0.90, 0.78), (0.08, 0.78)],
        (1100, 400),
    ),
    "cloth-zhidai-band.jpg": (
        "织带/微信图片_20260928203852_255_964.jpg",
        None,
        (1600, 96),
    ),
    "cloth-dongtoupa-front.jpg": (
        "冬头帕/微信图片_20260928203827_235_964.jpg",
        [(0.253, 0.265), (0.539, 0.275), (0.547, 0.644), (0.259, 0.651)],
        (1100, 1100),
    ),
    "cloth-dajinshan-body.jpg": (
        "大襟衫/微信图片_20260928203812_230_964.jpg",
        [(0.355, 0.250), (0.580, 0.250), (0.580, 0.515), (0.355, 0.515)],
        (900, 1000),
    ),
    "cloth-dajinshan-cuff.jpg": (
        "大襟衫/微信图片_20260928203812_230_964.jpg",
        [(0.603, 0.438), (0.735, 0.414), (0.747, 0.470), (0.606, 0.479)],
        (900, 420),
    ),
    "cloth-dajinshan-sash.jpg": (
        "大襟衫/微信图片_20260928203812_230_964.jpg",
        [(0.3922, 0.1094), (0.5204, 0.0922), (0.5304, 0.1125), (0.3867, 0.1433)],
        (1100, 180),
    ),
    "cloth-zisundai-front.jpg": (
        "子孙袋/微信图片_20260928203727_199_964.jpg",
        # Begin at the red patterned upper band of the bag; exclude the loose
        # plaid cloth folded over it in the reference photograph.
        [(0.405, 0.315), (0.805, 0.315), (0.80, 0.755), (0.30, 0.735)],
        (900, 990),
    ),
    "cloth-bowei-top.jpg": (
        "脖围/微信图片_20260928203716_193_964.jpg",
        [(0.08, 0.27), (0.92, 0.27), (0.92, 0.91), (0.08, 0.91)],
        (1200, 1200),
    ),
}


def rectify(source: Path, corners, size):
    image = cv2.imdecode(np.fromfile(source, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"could not read reference photo: {source}")
    height, width = image.shape[:2]
    src = np.float32([(x * width, y * height) for x, y in corners])
    out_w, out_h = size
    dst = np.float32([(0, 0), (out_w - 1, 0), (out_w - 1, out_h - 1), (0, out_h - 1)])
    transform = cv2.getPerspectiveTransform(src, dst)
    patch = cv2.warpPerspective(image, transform, size, flags=cv2.INTER_CUBIC,
                                borderMode=cv2.BORDER_REPLICATE)
    return cv2.cvtColor(patch, cv2.COLOR_BGR2RGB)


def rectify_ribbon(source: Path, size):
    image = cv2.imdecode(np.fromfile(source, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"could not read reference photo: {source}")
    height, width = image.shape[:2]
    # The selected 255 ribbon bows gently. Eight adjacent homographies preserve
    # its real weave and lettering without pulling the table into the crop.
    top0, top1 = np.float32([122, 150]), np.float32([1065, 70])
    bottom0, bottom1 = np.float32([125, 173]), np.float32([1070, 107])
    out_w, out_h = size
    pieces = []
    for section in range(8):
        t0, t1 = section / 8, (section + 1) / 8
        quad = np.float32([
            top0 * (1-t0) + top1 * t0,
            top0 * (1-t1) + top1 * t1,
            bottom0 * (1-t1) + bottom1 * t1,
            bottom0 * (1-t0) + bottom1 * t0,
        ])
        target = np.float32([(0, 0), (out_w // 8 - 1, 0),
                             (out_w // 8 - 1, out_h - 1), (0, out_h - 1)])
        matrix = cv2.getPerspectiveTransform(quad, target)
        piece = cv2.warpPerspective(image, matrix, (out_w // 8, out_h),
                                    flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        pieces.append(piece)
    return cv2.cvtColor(np.concatenate(pieces, axis=1), cv2.COLOR_BGR2RGB)


for output, (relative, quad, size) in CROPS.items():
    source = REF / relative
    rgb = rectify_ribbon(source, size) if quad is None else rectify(source, quad, size)
    if output == "cloth-huamao-side.png":
        height, width = rgb.shape[:2]
        xx, yy = np.meshgrid(np.linspace(0, 1, width), np.linspace(0, 1, height))
        edge = np.minimum.reduce([xx, 1 - xx, yy, 1 - yy])
        color = rgb.astype(np.float32) / 255
        chroma = color.max(axis=2) - color.min(axis=2)
        embroidery = np.maximum(
            np.clip((chroma - 0.08) / 0.15, 0, 1),
            np.clip((color.min(axis=2) - 0.40) / 0.18, 0, 1),
        )
        alpha = np.uint8(embroidery * np.clip(edge / 0.09, 0, 1) * 255)
        Image.fromarray(np.dstack([rgb, alpha])).save(OUT / output, optimize=True)
    else:
        Image.fromarray(rgb).save(OUT / output, quality=94, optimize=True)
    detail = "eight-segment ribbon rectification" if quad is None else f"quad={quad}"
    print(f"{output}: {relative} {detail} pixels={size[0]}x{size[1]}")
