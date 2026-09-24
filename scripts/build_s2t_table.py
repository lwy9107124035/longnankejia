"""从 Unicode Unihan 数据生成「简体 → 繁体候选」表，供 js/data-s2t.js 使用。

为什么要这张表：萌典客家语接口只认繁体字（/h/寿 返回 404，/h/壽 才有读音），
而本站界面是简体。不转字的话，观众打「蓝」「表」「寿」都会被告知"查不到"，
数据其实就在那里 —— 这是一个纯粹的字符门槛，不是知识缺口。

用法（Unihan.zip 约 8 MB，不入库，只在生成时下载）：
    curl -x http://127.0.0.1:31181 -o /tmp/Unihan.zip ^
        https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
    python scripts/build_s2t_table.py /tmp/Unihan.zip

输出 js/data-s2t.js：window.S2T = { "寿": "壽", "干": "乾幹", ... }
只收录"简繁不同形"的字，值里不含自身，由调用方自己把原字排在第一个候选。
"""
import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "js" / "data-s2t.js"
DEFAULT_ZIP = Path("C:/tmp/Unihan.zip")
UNIHAN_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip"


def ensure_zip(path):
    if path.exists():
        return path
    proxy = "http://127.0.0.1:31181"
    req = urllib.request.Request(UNIHAN_URL, headers={"User-Agent": "Mozilla/5.0"})
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
    path.parent.mkdir(parents=True, exist_ok=True)
    with opener.open(req, timeout=180) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def parse_unihan(zf):
    """返回 {繁体码点: [简体码点,...]}，即 Unihan 的 kSimplifiedVariant。"""
    trad2simp = {}
    with zf.open("Unihan_Variants.txt") as fh:
        for raw in io.TextIOWrapper(fh, encoding="utf-8"):
            if "kSimplifiedVariant" not in raw:
                continue
            parts = raw.rstrip("\n").split("\t")
            if len(parts) != 3:
                continue
            cp = int(parts[0][2:], 16)
            if not (0x4E00 <= cp <= 0x9FFF):
                continue
            variants = [int(t[2:], 16) for t in parts[2].split()]
            trad2simp.setdefault(cp, []).extend(v for v in variants if v != cp)
    return trad2simp


def build(zf_path):
    with zipfile.ZipFile(zf_path) as zf:
        trad2simp = parse_unihan(zf)

    simp2trad = OrderedDict()
    for trad, sims in sorted(trad2simp.items()):
        for s in sorted(set(sims)):
            if not (0x4E00 <= s <= 0x9FFF) or s == trad:
                continue
            simp2trad.setdefault(s, [])
            if chr(trad) not in simp2trad[s]:
                simp2trad[s].append(chr(trad))
    # 只保留"确实少数字对应少数繁体候选"的项；候选超过 4 个的多是噪声聚合
    return OrderedDict((chr(k), "".join(v[:4])) for k, v in sorted(simp2trad.items()))


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    arg = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_ZIP
    table = build(ensure_zip(arg))
    if len(table) < 1000:
        # 解析不到东西通常是被换字段所在文件坑了（kSimplifiedVariant 在 Variants 里），
        # 生成一张空表比不生成更糟——界面会安静地退化回「查不到」。
        raise SystemExit("只解析到 %d 个映射，判定为失败，请检查 Unihan 字段名" % len(table))
    body = json.dumps(table, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "/* 简体 → 繁体候选表：由 scripts/build_s2t_table.py 从 Unicode Unihan\n"
        "   kSimplifiedVariant 生成，请勿手改。萌典客家语只认繁体字，本站界面是简体，\n"
        "   查词前先转一次字形，否则「寿」「蓝」这类字会被误报成「查不到」。\n"
        "   数据源：https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip (UTF-3 许可)\n"
        "   共 " + str(len(table)) + " 个字形有别的简体字。 */\n"
        "window.S2T = " + body + ";\n",
        encoding="utf-8")
    print("wrote", OUT, len(table), "chars,", OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
