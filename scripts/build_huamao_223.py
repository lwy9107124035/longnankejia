"""Extract the selected 223 hat's cloth and solid metal relief from its photograph.

The brass outlines are traced individually. Relief height is an estimate, not a scan;
the original RGB pixels retain the visible engraving and patina.
"""
import base64
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "3D模型参考原图/花帽/微信图片_20260928203744_223_964.jpg"
DRAPE_SOURCE = ROOT / "3D模型参考原图/花帽/微信图片_20260928203744_224_964.jpg"
OUT = ROOT / "assets/model-textures"
rgb = np.array(Image.open(SOURCE).convert("RGB"))

# Seven separate silhouettes, including their cloud-shaped bases. The spaces
# between heads remain empty rather than becoming a rectangular photograph plate.
figures = [
    [(325,397),(336,400),(338,424),(347,453),(345,495),(348,541),(340,558),(310,556),(303,542),(311,516),(315,477),(319,441),(319,412)],
    [(373,386),(389,383),(392,406),(398,416),(396,444),(403,465),(398,485),(400,516),(409,541),(406,555),(394,568),(350,564),(338,551),(342,526),(342,488),(348,467),(350,434),(359,415),(360,397)],
    [(452,389),(474,394),(482,413),(478,429),(490,441),(494,468),(494,490),(500,517),(511,540),(506,552),(488,565),(429,564),(414,554),(415,534),(424,508),(421,475),(425,452),(438,435),(437,415),(441,398)],
    [(555,379),(573,379),(582,394),(581,414),(589,426),(600,434),(604,452),(596,465),(601,494),(596,519),(614,549),(613,566),(595,583),(520,583),(497,574),(498,555),(514,529),(519,497),(520,474),(521,448),(534,428),(543,415),(543,394)],
    [(644,397),(661,398),(671,411),(669,431),(684,447),(682,468),(677,486),(684,501),(679,522),(690,544),(685,565),(675,577),(615,573),(600,562),(604,543),(615,519),(616,492),(617,464),(628,444),(639,432),(636,415)],
    [(735,400),(751,399),(761,414),(757,437),(771,453),(775,474),(770,493),(775,520),(784,541),(776,561),(764,575),(706,574),(688,562),(696,539),(704,516),(704,480),(712,455),(720,438),(723,419)],
    [(783,402),(794,407),(800,426),(796,446),(812,461),(822,480),(822,503),(813,522),(823,544),(819,563),(799,571),(783,560),(780,539),(786,515),(778,483),(781,453),(778,432)]
]
mask = np.zeros(rgb.shape[:2], np.uint8)
for polygon in figures:
    cv2.fillPoly(mask, [np.array(polygon, np.int32)], 255)

# Keep the photograph's cloth weave and embroidery while omitting the metal which
# is drawn as separate closed relief geometry at the same photographic coordinates.
front = rgb[245:615, 300:860].copy()
alpha = 255 - cv2.dilate(mask, np.ones((5, 5), np.uint8))[245:615, 300:860]
Image.fromarray(np.dstack([front, alpha])).save(OUT / "cloth-huamao-223-front.png", optimize=True)

# Flatten the curved embroidered brim by sampling between traced top/bottom hems.
top = np.array([(220,284),(278,227),(350,186),(450,156),(566,148),(680,154),(783,181),(864,228),(943,313)])
bottom = np.array([(220,317),(278,288),(350,254),(450,232),(566,184),(680,237),(783,266),(864,307),(943,337)])
xx = np.linspace(220, 943, 1100)
yy_top = np.interp(xx, top[:, 0], top[:, 1])
yy_bottom = np.interp(xx, bottom[:, 0], bottom[:, 1])
vv = np.linspace(0, 1, 240)[:, None]
mapx = np.broadcast_to(xx, (240, 1100)).astype(np.float32)
mapy = (yy_top * (1-vv) + yy_bottom * vv).astype(np.float32)
brim = cv2.remap(rgb, mapx, mapy, cv2.INTER_CUBIC)
Image.fromarray(brim).save(OUT / "cloth-huamao-223-brim.jpg", quality=94, optimize=True)

quad = np.float32([(846,433),(891,449),(875,778),(818,748)])
target = np.float32([(0,0),(279,0),(279,799),(0,799)])
side = cv2.warpPerspective(rgb, cv2.getPerspectiveTransform(quad,target), (280,800), flags=cv2.INTER_CUBIC)
Image.fromarray(side).save(OUT / "cloth-huamao-223-side.jpg", quality=94, optimize=True)
left_quad = np.float32([(247,408),(326,433),(293,745),(244,758)])
left = cv2.warpPerspective(rgb, cv2.getPerspectiveTransform(left_quad,target), (280,800), flags=cv2.INTER_CUBIC)
Image.fromarray(left).save(OUT / "cloth-huamao-223-side-left.jpg", quality=94, optimize=True)
# Correct the museum photograph's exposure before using its red cloth as albedo:
# keeping the baked-in shadow would darken it a second time under the 3D lights.
# This patch excludes the wooden stand, embroidery and metal ornaments.
drape = np.array(Image.open(DRAPE_SOURCE).convert("RGB"))[960:1080, 650:730].astype(np.float32)
median = np.median(drape, axis=(0, 1))
drape = np.clip(drape * np.array([151, 38, 30]) / median, 0, 255).astype(np.uint8)
Image.fromarray(drape).save(OUT / "cloth-huamao-224-red.jpg", quality=94, optimize=True)

metal = rgb[370:588, 300:830]
Image.fromarray(metal).save(OUT / "metal-huamao-223-figures.jpg", quality=95, optimize=True)
Image.fromarray(rgb[573:616, 584:630]).save(OUT / "metal-huamao-223-rosette.jpg", quality=95, optimize=True)

# A small height field drives a closed front/back/edge mesh in the existing model
# builder. Distance to each silhouette's edge rounds the cast profiles; luminance
# adds only a shallow engraving relief, so photographic shadows do not become spikes.
width, height = 177, 74
small_mask = cv2.resize(mask[370:588, 300:830], (width,height), interpolation=cv2.INTER_NEAREST)
distance = cv2.distanceTransform(small_mask, cv2.DIST_L2, 5)
gray = cv2.cvtColor(cv2.resize(metal, (width,height)), cv2.COLOR_RGB2GRAY) / 255
heightmap = np.where(small_mask, 32 + 170 * np.clip(distance/7,0,1) + 35*gray, 0).astype(np.uint8)
data = {"width":width,"height":height,"heights":base64.b64encode(heightmap.tobytes()).decode("ascii")}
(ROOT / "js/huamao-223-relief.js").write_text(
    "// Photo 223: traced cast-ornament silhouettes and estimated relief depth.\nwindow.Huamao223Relief = " + json.dumps(data, separators=(",",":")) + ";\n", encoding="utf-8")
print("223: embroidery and seven cast silhouettes; 224: exposure-corrected red cloth; no display stand included")
