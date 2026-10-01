"""Prepare web-sized copies of supplied photographs and a traceable model gallery."""
import json
import re
import shutil
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/model-references'
GROUPS = {
    '花帽': 'hutoumao', '织带': 'zhidai', '冬头帕': 'dongtoupa',
    '大襟衫': 'dajinshan', '子孙袋': 'zisundai', '脖围': 'bowei',
    '客家纸艺': 'zhiyi', '竹编': 'boji', '织机': 'zhiji', '蓝染': 'landye',
}


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    gallery = {key: [] for key in GROUPS.values()}
    for folder, model_id in GROUPS.items():
        for path in sorted((ROOT / '3D模型参考原图' / folder).iterdir()):
            number = re.search(r'_(\d+)_964', path.stem)
            if path.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                name = f'{model_id}-{number[1]}.jpg'
                picture = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
                picture.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                picture.save(OUT / name, quality=86, optimize=True)
                gallery[model_id].append({'src': f'assets/model-references/{name}',
                                         'label': f'{folder} · 参考照片 {number[1]}',
                                         'original': path.relative_to(ROOT).as_posix()})
            elif path.suffix.lower() == '.mp4':
                name = f'{model_id}-{path.stem}.mp4'
                shutil.copyfile(path, OUT / name)
                gallery[model_id].append({'src': f'assets/model-references/{name}',
                                         'label': f'{folder} · 实物视频', 'video': True,
                                         'original': path.relative_to(ROOT).as_posix()})
    gallery['liangmao'] = [item for item in gallery['boji']
                          if re.search(r'-(243|249)\.jpg$', item['src'])]
    gallery['weiwu'] = [{'url': 'https://www.ganzhou.gov.cn/zfxxgk/c144214/202211/8dcc8823a68742bf8fb3c4f5afff641a.shtml',
                         'label': '赣州市政府 · 关西新围实景与形制介绍'}]
    supplement = {
        'zhiji': ('博物馆图片', '微信图片_20260928193605_163_964.jpg'),
        'zhidai': ('博物馆图片', '微信图片_20260928193605_179_964.jpg'),
        'boji': ('9.27传龙南非遗/非遗传承人', '6.jpg'),
        'landye': ('9.27传龙南非遗/非遗传承人', '29.jpg'),
    }
    for model_id, (folder, filename) in supplement.items():
        path = ROOT / folder / filename
        name = model_id + '-fieldwork.jpg'
        picture = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
        picture.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        picture.save(OUT / name, quality=86, optimize=True)
        gallery[model_id].append({'src': f'assets/model-references/{name}',
                                 'label': '馆内展示与传承实践',
                                 'original': path.relative_to(ROOT).as_posix()})
    (ROOT / 'js/model-references.js').write_text(
        '// Source files and web-sized reference media for each exhibit.\nwindow.ModelReferences = '
        + json.dumps(gallery, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
    print(f'Prepared {sum(len(items) for items in gallery.values())} reference entries.')


if __name__ == '__main__':
    prepare()
