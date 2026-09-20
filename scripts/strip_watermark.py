"""Strip the generator's corner badge from the AI-made texture maps.

Every map fed to the three 3D models carries the same "AI生成 / Xiaomi MIMO" pill
baked into its bottom-right corner, which smears across the model once the map is
tiled. All maps are 1024x1024 from one generator, so the badge sits at a fixed
offset and a single rectangle covers the whole set.

The hole is filled from the neighbouring strip of the same texture rather than by
diffusion inpainting: Navier-Stokes inpainting across a 188x110 window collapses
into a flat colour gradient and reads as an obvious smudge, while cloning the band to
the left keeps the grain and puts every horizontal feature back on its own row.
"""
from PIL import Image
import numpy as np
import os
import shutil

TEXTURES = "assets/textures"            # the maps the 3D models load
SPARE = "assets/source/textures"        # generated alternates, kept out of the build
BACKUP = ".cache/texture-originals"
# Measured pill bounds ~ x 843-1022, y 922-1022; padded for the soft rounded edge.
BADGE = (836, 914, 1024, 1024)   # x0, y0, x1, y1
FEATHER = 14                     # px of gradient blend along the two open edges
TARGETS = [
    "black-cotton.png", "tiger-embroidery.png", "embroidery-pattern.png",
    "rammed-earth.png", "roof-tiles.png", "stone-paving.png", "landye-final.png",
    "landye-cloth.png", "landye-pattern.png", "tiger-face.png", "weiwu-wall.png",
]


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


def sheet(paths, path, box=(700, 820, 1024, 1024)):
    tiles = [Image.open(p).convert("RGB").crop(box) for p in paths]
    tw, th = tiles[0].size
    cols = 3
    out = Image.new("RGB", (cols * tw, ((len(tiles) + cols - 1) // cols) * th), (250, 250, 250))
    for i, t in enumerate(tiles):
        out.paste(t, ((i % cols) * tw, (i // cols) * th))
    out.save(path)


def main():
    os.makedirs(BACKUP, exist_ok=True)
    current, originals = [], []
    for sub in (TEXTURES, SPARE):
        for name in TARGETS:
            f = os.path.join(sub, name)
            if not os.path.exists(f):
                continue
            b = os.path.join(BACKUP, name)
            if os.path.exists(b):
                os.remove(f)
                shutil.copy(b, f)      # always restart from the pristine original
            else:
                shutil.copy(f, b)
            Image.fromarray(clean(f)).save(f, optimize=True)
            current.append(f)
            originals.append(b)
            print("cleaned", f)
    sheet(current, os.path.join(BACKUP, "_after.png"))
    sheet(originals, os.path.join(BACKUP, "_before.png"))
    print("review sheets in", BACKUP)


if __name__ == "__main__":
    main()
