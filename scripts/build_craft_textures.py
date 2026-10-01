"""Extract visible cloth and planter surfaces; leave the reference originals intact."""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "3D模型参考原图"
OUT = ROOT / "assets" / "model-textures"
OUT.mkdir(parents=True, exist_ok=True)

# Normalized TL, TR, BR, BL corners in the complete reference photograph.
CROPS = {
    "craft-loom-cloth.jpg": (
        "织机/微信图片_20260928203759_226_964.jpg",
        [(0.423, 0.478), (0.503, 0.510), (0.511, 0.597), (0.396, 0.572)],
        (1000, 1000),
    ),
    "craft-pot-left.jpg": (
        "客家纸艺/微信图片_20260928203736_204_964.jpg",
        [(0.5553, 0.8344), (0.5887, 0.8468), (0.5867, 0.9594), (0.5618, 0.9385)],
        (420, 660),
    ),
    "craft-pot-center.jpg": (
        "客家纸艺/微信图片_20260928203736_204_964.jpg",
        [(0.5922, 0.8408), (0.6350, 0.8540), (0.6273, 0.9685), (0.5965, 0.9596)],
        (420, 660),
    ),
    "craft-pot-right.jpg": (
        "客家纸艺/微信图片_20260928203736_204_964.jpg",
        [(0.6428, 0.8600), (0.6906, 0.8330), (0.6785, 0.9453), (0.6348, 0.9625)],
        (420, 660),
    ),
    "craft-paper-bark.jpg": (
        "客家纸艺/微信图片_20260928203736_204_964.jpg",
        [(0.474, 0.618), (0.491, 0.618), (0.491, 0.650), (0.474, 0.650)],
        (256, 384),
    ),
}

for name, (source, corners, size) in CROPS.items():
    image = np.asarray(Image.open(REF / source).convert("RGB"))
    height, width = image.shape[:2]
    points = np.float32([(x * width, y * height) for x, y in corners])
    dest = np.float32([(0, 0), (size[0] - 1, 0), (size[0] - 1, size[1] - 1), (0, size[1] - 1)])
    matrix = cv2.getPerspectiveTransform(points, dest)
    rectified = cv2.warpPerspective(image, matrix, size, flags=cv2.INTER_CUBIC)
    Image.fromarray(rectified).save(OUT / name, quality=92, subsampling=0)
    print(name)
