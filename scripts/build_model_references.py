"""Prepare web-sized copies of supplied photographs and a traceable model gallery."""
import json
import re
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/model-references'
GROUPS = {
    '花帽': 'hutoumao', '织带': 'zhidai', '冬头帕': 'dongtoupa',
    '大襟衫': 'dajinshan', '子孙袋': 'zisundai', '脖围': 'bowei',
    '客家纸艺': 'zhiyi', '竹编': 'boji', '织机': 'zhiji', '蓝染': 'landye',
}

# 严格黑名单：排除所有含有人物、传承人、面部/肢体、人影倒影的照片
EXCLUDE = {
    'dajinshan': {'231', '232'},
    'zisundai': {'202'},
    'zhiyi': {'204', '206', '208', '210'},
    'boji': {'244'},
    'landye': {'236', '239'},
    'zhidai': {'250', '252', '254', '255'},
}


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    gallery = {key: [] for key in GROUPS.values()}
    for folder, model_id in GROUPS.items():
        for path in sorted((ROOT / '3D模型参考原图' / folder).iterdir()):
            m = re.search(r'_(\d+)_964', path.stem)
            if not m:
                continue
            number = m[1]
            if number in EXCLUDE.get(model_id, set()):
                continue
            if path.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                name = f'{model_id}-{number}.jpg'
                picture = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
                if model_id == 'zhidai' and number == '251':
                    picture = picture.crop((150, 100, 900, 1420))
                picture.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                picture.save(OUT / name, quality=86, optimize=True)
                gallery[model_id].append({'src': f'assets/model-references/{name}',
                                         'label': f'{folder} · 参考照片 {number}',
                                         'original': path.relative_to(ROOT).as_posix()})
    gallery['liangmao'] = [item for item in gallery['boji']
                          if re.search(r'-(243|249)\.jpg$', item['src'])]
    gallery['weiwu'] = [{'url': 'https://www.ganzhou.gov.cn/zfxxgk/c144214/202211/8dcc8823a68742bf8fb3c4f5afff641a.shtml',
                         'label': '赣州市政府 · 关西新围实景与形制介绍'}]
    (ROOT / 'js/model-references.js').write_text(
        '// Source files and web-sized reference media for each exhibit.\nwindow.ModelReferences = '
        + json.dumps(gallery, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
    print(f'Prepared {sum(len(items) for items in gallery.values())} reference entries.')


if __name__ == '__main__':
    prepare()
