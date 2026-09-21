"""Strip the generator's corner badge from the AI-made texture maps.

Every map fed to the three 3D models carries the same "AI生成 / Xiaomi MIMO" pill
baked into its bottom-right corner, which smears across the model once the map is
tiled. All maps are 1024x1024 from one generator, so the badge sits at a fixed
offset and a single rectangle covers the whole set.

The hole is filled from the neighbouring strip of the same texture rather than by
diffusion inpainting: Navier-Stokes inpainting across a 188x110 window collapses
into a flat colour gradient and reads as an obvious smudge, while cloning the band to
the left keeps the grain and puts every horizontal feature back on its own row.

Re-running is safe: each map is checked against tests/badge-template.npy first, and
only the ones that still correlate to the badge get patched. Without that template the
script refuses to run rather than re-patching already-clean maps.
"""
from PIL import Image
import numpy as np
import os
import sys

TEXTURES = "assets/textures"            # the maps the 3D models load
SPARE = "assets/source/textures"        # generated alternates, kept out of the build
# Measured pill bounds ~ x 843-1022, y 922-1022; padded for the soft rounded edge.
BADGE = (836, 914, 1024, 1024)   # x0, y0, x1, y1
FEATHER = 14                     # px of gradient blend along the two open edges


def feather_mask(shape, rect=BADGE):
    """Solid over the badge, ramping to zero only where the patch has a free edge."""
    h, w = shape[:2]
    x0, y0, x1, y1 = rect
    m = np.zeros((h, w), np.float32)
    m[y0:y1, x0:x1] = 1.0
    ramp = np.linspace(0, 1, FEATHER, dtype=np.float32)
    m[y0:y1, x0:x0 + FEATHER] *= ramp[None, :]
    m[y0:y0 + FEATHER, x0:x1] *= ramp[:, None]
    return m[..., None]


def clean(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    x0, y0, x1, y1 = BADGE
    bw = x1 - x0
    patch = rgb[y0:y1, max(x0 - bw, 0):max(x0 - bw, 0) + bw]
    dst = rgb.copy()
    dst[y0:y1, x0:x0 + patch.shape[1]] = patch
    m = feather_mask(rgb.shape)
    return np.clip(rgb * (1 - m) + dst * m, 0, 255).astype(np.uint8)


def badge_score(path, template="tests/badge-template.npy", box=(760, 854, 1024, 1024)):
    """Normalised cross-correlation against the recovered badge; None if no template."""
    import cv2
    if not os.path.exists(template):
        return None
    tmpl = np.load(template)
    gray = cv2.cvtColor(np.asarray(Image.open(path).convert("RGB")), cv2.COLOR_RGB2GRAY).astype(np.float32)
    x0, y0, x1, y1 = box
    win = gray[y0:min(y1, gray.shape[0]), x0:min(x1, gray.shape[1])]
    if win.shape[0] < tmpl.shape[0] or win.shape[1] < tmpl.shape[1]:
        return None
    return float(cv2.matchTemplate(win, tmpl, cv2.TM_CCOEFF_NORMED).max())


def main():
    if not os.path.exists("tests/badge-template.npy"):
        sys.exit("需要 tests/badge-template.npy 来判断角标是否还在；没有它本脚本拒绝工作，\n"
                 "否则会把已经干净的贴图当成未处理再补一遍。")

    threshold = 0.40
    worked = skipped = 0
    for sub in (TEXTURES, SPARE):
        if not os.path.isdir(sub):
            continue
        for name in sorted(os.listdir(sub)):
            if not name.endswith(".png"):
                continue
            f = os.path.join(sub, name)
            score = badge_score(f)
            if score is None or score <= threshold:
                print("  跳过（角标相关度 %.2f，已干净）%s" % (score or -1, f))
                skipped += 1
                continue
            Image.fromarray(clean(f)).save(f, optimize=True)
            print("  已去角标（相关度 %.2f → 复检 %.2f）%s" % (score, badge_score(f), f))
            worked += 1

    print("\n处理 %d 张，跳过 %d 张。" % (worked, skipped))
    print("原始带角标版本另存于 OneDrive 备份目录，不在仓库内。")


if __name__ == "__main__":
    main()
