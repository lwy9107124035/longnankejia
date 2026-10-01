"""Rectify the two actual sample fabrics in reference photograph 236."""
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '3D模型参考原图/蓝染/微信图片_20260928203833_236_964.jpg'
OUT = ROOT / 'assets/model-textures'

image = cv2.imdecode(np.fromfile(SOURCE, dtype=np.uint8), cv2.IMREAD_COLOR)
height, width = image.shape[:2]
samples = {
    'indigo-rings.jpg': [(265/1080, 220/1920), (919/1080, 174/1920),
                         (941/1080, 785/1920), (177/1080, 810/1920)],
    'indigo-rays.jpg': [(176/1080, 845/1920), (976/1080, 839/1920),
                        (1010/1080, 1785/1920), (34/1080, 1706/1920)],
}
OUT.mkdir(parents=True, exist_ok=True)
for filename, points in samples.items():
    source = np.float32([(x*width, y*height) for x,y in points])
    target = np.float32([(0,0), (1023,0), (1023,1023), (0,1023)])
    transform = cv2.getPerspectiveTransform(source, target)
    patch = cv2.warpPerspective(image, transform, (1024,1024), flags=cv2.INTER_CUBIC)
    encoded = cv2.imencode('.jpg', patch, [cv2.IMWRITE_JPEG_QUALITY, 92])[1]
    encoded.tofile(OUT / filename)
    print(filename)
