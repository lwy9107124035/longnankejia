"""生成「家乡」地图数据：龙南市真实行政边界 + 乡镇/文保点的真实坐标。

为什么不用手绘示意图：这是给博物馆观众看的，把围屋画错地方就是错信息。
所以底图边界与点位坐标全部取自可核对的公开数据源，并把来源和取数日期写进文件；
拿不到坐标的点宁可少画，也不猜。

数据源：
  * 边界：阿里云 DataV.GeoAtlas 行政区划 GeoJSON（源自国家基础地理信息中心公开底图），
    龙南市 adcode 360783 → https://geo.datav.aliyun.com/areas_v3/bound/360783.json
  * 坐标：中文维基百科各条目 infobox 的 coordinate 字段（Wikidata 上这些乡镇级条目
    恰好没有 P625，只有中文维基有），经 action=query&prop=coordinates 取回
  * 乡镇名单：Wikidata P131 反查 Q1336164（龙南市）下辖政区，用来核对名字写法

用法：
    python scripts/build_hometown_map.py     # 联网取数（链路抖时退回兜底表）并写 js/data-hometown.js

缓存落在 C:/tmp/hm，重跑不再打接口；删掉缓存即可强制重新取数。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "js" / "data-hometown.js"
CACHE = Path("C:/tmp/hm")
PROXY = os.environ.get("HTTPS_PROXY") or "http://127.0.0.1:31181"
UA = {"User-Agent": "longnankejia-museum-demo/1.0"}
RETRIEVED = "2026-09-24"
MIN_PLACES = 12
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": PROXY, "http": PROXY}))

# 中文维基条目名 → (地图显示名, 类别)。类别只影响点的大小/颜色，不影响位置。
PLACES = [
    ("龙南镇", "龙南镇", "seat"),
    ("杨村镇", "杨村镇", "town"),
    ("程龙镇", "程龙镇", "town"),
    ("里仁镇", "里仁镇", "town"),
    ("汶龙镇", "汶龙镇", "town"),
    ("东江镇", "东江镇", "town"),
    ("关西镇", "关西镇", "town"),
    ("武当镇", "武当镇", "town"),
    ("渡江镇", "渡江镇", "town"),
    ("九连山镇", "九连山镇", "town"),
    ("桃江乡", "桃江乡", "town"),
    ("临塘乡", "临塘乡", "town"),
    ("南亨乡", "南亨乡", "town"),
    ("夹湖乡", "夹湖乡", "town"),
    ("乌石围", "乌石围", "site"),
    ("燕翼围", "燕翼围", "site"),
    ("关西新围", "关西新围", "site"),
    ("太平桥", "太平桥", "site"),
]

# 2026-09-24 从 zh.wikipedia 的 action=query&prop=coordinates 实测取回的一份兜底表。
# 加速器对 wikipedia 的连通性时好时坏（同一批请求几分钟前全 200，之后就 timeout），
# 链路抖的时候用这张表出图，联网时仍以接口为准并核对差异。
# 注意精度：四个文保点条目本身就是两位小数（约 1 公里），界面上要如实标出来。
FALLBACK_COORDS = {
    "龙南镇": (24.91086, 114.79371),
    "杨村镇": (24.96372, 114.77362),
    "程龙镇": (24.79961, 114.86663),
    "里仁镇": (24.91225, 114.76318),
    "汶龙镇": (24.8617, 114.72264),
    "东江镇": (24.82946, 114.721),
    "关西镇": (24.81851, 114.703),
    "武当镇": (24.86846, 114.636),
    "渡江镇": (24.955, 114.835),
    "九连山镇": (24.56609, 114.7293),
    "桃江乡": (24.97114, 114.70833),
    "临塘乡": (24.87846, 114.80563),
    "南亨乡": (24.81857, 114.65183),
    "夹湖乡": (24.75272, 114.70543),
    "乌石围": (24.96, 114.78),
    "燕翼围": (24.91, 114.79),
    "关西新围": (24.82, 114.7),
    "太平桥": (24.94, 114.79),
}


def get(url, tries=6, timeout=30, name=None):
    """加速器链路会 reset，所以每个请求都重试几轮；缓存命中就不再联网。"""
    cf = CACHE / name if name else None
    if cf and cf.exists():
        return cf.read_bytes()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with opener.open(req, timeout=timeout) as r:
                body = r.read()
                if cf:
                    cf.parent.mkdir(parents=True, exist_ok=True)
                    cf.write_bytes(body)
                return body
        except Exception as e:  # noqa: BLE001
            last = "%s: %s" % (type(e).__name__, e)
            time.sleep(1.5 + i * 1.5)
    raise SystemExit("取数失败 %s → %s" % (url[:70], last))


def outline_ring():
    raw = json.loads(get("https://geo.datav.aliyun.com/areas_v3/bound/360783.json",
                         name="longnan_outline").decode("utf-8"))
    geom = raw["features"][0]["geometry"]
    # Polygon 的 coordinates 是 [ring, ring…]，MultiPolygon 是 [polygon, polygon…]。
    # 龙南市是 Polygon，但两种形状都吃得下，免得哪天数据换了层就取错。
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    rings = [r for poly in polys for r in poly]
    main = max(rings, key=len)
    closed = main[:-1] if main[0][:2] == main[-1][:2] else main
    return [[round(p[0], 4), round(p[1], 4)] for p in closed]


def simplify(ring, keep):
    """按点到线段垂距做 Douglas-Peucker，把七百多点边界压到 ~keep 点。"""
    if len(ring) <= keep:
        return ring

    def seg_dist(p, a, b):
        ax, ay, bx, by, px, py = a[0], a[1], b[0], b[1], p[0], p[1]
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        qx, qy = ax + t * dx, ay + t * dy
        return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5

    pts = ring + [ring[0]]
    keep_set = {0, len(pts) - 1}
    queue = [(0, len(pts) - 1)]
    while len(keep_set) < min(keep, len(pts)) and queue:
        i, j = queue.pop(0)
        if j - i < 2:
            continue
        worst, idx = -1.0, None
        for k in range(i + 1, j):
            d = seg_dist(pts[k], pts[i], pts[j])
            if d > worst:
                worst, idx = d, k
        if idx is None:
            continue
        keep_set.add(idx)
        queue.append((i, idx))
        queue.append((idx, j))
    return [[round(pts[i][0], 4), round(pts[i][1], 4)] for i in sorted(keep_set)]


def wiki_coords(titles, slot):
    """按批次取坐标。缓存名用批次号而不是内容哈希：哈希每进程都变，重试等于白重试。"""
    u = ("https://zh.wikipedia.org/w/api.php?action=query&prop=coordinates&redirects=1"
         "&format=json&titles=" + urllib.parse.quote("|".join(titles)))
    d = json.loads(get(u, name="wiki_batch_%d.json" % slot).decode("utf-8"))
    out = {}
    for p in d["query"]["pages"].values():
        cs = p.get("coordinates") or []
        if cs:
            out[p["title"]] = (round(float(cs[0]["lat"]), 5), round(float(cs[0]["lon"]), 5))
    return out


def collect_places(bbox):
    live = {}
    for slot, i in enumerate(range(0, len(PLACES), 6)):
        titles = [b[0] for b in PLACES[i:i + 6]]
        try:
            live.update(wiki_coords(titles, slot))
        except SystemExit as e:
            # 加速器抖的时候整批取不到：这批改用兜底表，但要在日志里说清楚
            print("!! 第 %d 批坐标取不到，改走兜底表：%s" % (slot, str(e)[:70]))
    print("  线上取到 %d / %d 个点" % (len(live), len(PLACES)))

    places, used_fallback = [], 0
    for title, label, kind in PLACES:
        if title in live:
            c, src = live[title], "wiki-live"
            fb = FALLBACK_COORDS.get(title)
            if fb and max(abs(c[0] - fb[0]), abs(c[1] - fb[1])) > 0.01:
                print("!! %s 线上坐标 %s 与兜底表差约 %d 公里，以线上为准"
                      % (title, c, round(max(abs(c[0] - fb[0]), abs(c[1] - fb[1])) * 111)))
        elif title in FALLBACK_COORDS:
            c, src = FALLBACK_COORDS[title], "wiki-" + RETRIEVED
            used_fallback += 1
        else:
            print("!! %s 既没取到也不在兜底表里，跳过（宁可少一个点，也不猜位置）" % title)
            continue
        if not (bbox[0] <= c[1] <= bbox[2] and bbox[1] <= c[0] <= bbox[3]):
            print("!! %s 坐标 %s 落在龙南边界外，跳过" % (title, c))
            continue
        places.append({"name": label, "kind": kind, "lat": c[0], "lon": c[1],
                       "wiki": title, "src": src})
    return places, used_fallback


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ring = outline_ring()
    print("边界 %d 点，简化后" % len(ring), end=" ")
    ring = simplify(ring, 160)
    print("%d 点" % len(ring))
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    bbox = [min(lons), min(lats), max(lons), max(lats)]
    print("bbox", bbox)

    places, used_fallback = collect_places(bbox)
    print("点位 %d 个（其中 %d 个走兜底表）" % (len(places), used_fallback))
    if len(places) < MIN_PLACES:
        raise SystemExit("只拿到 %d 个点，低于 %d 个的下限，先别写文件" % (len(places), MIN_PLACES))

    payload = {
        "outline": ring,
        "bbox": [round(v, 4) for v in bbox],
        "retrieved": RETRIEVED,
        "source": {
            "outline": "阿里云 DataV.GeoAtlas 行政区划数据（国家基础地理信息中心公开底图），adcode 360783",
            "points": "中文维基百科各条目 infobox 坐标（WGS84）",
        },
        "places": places,
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    text = (
        "/* 「家乡」地图数据：龙南市真实行政边界 + 乡镇与文保点真实坐标（WGS84）。"
        "由 scripts/build_hometown_map.py 生成，请勿手改；改点位清单改那个脚本里的 PLACES。"
        "底图来源：" + payload["source"]["outline"] + "；坐标来源：" + payload["source"]["points"]
        + "。取数日期：" + RETRIEVED + "；边界 " + str(len(ring)) + " 点，点位 " + str(len(places)) + " 个。 */\n"
        "window.HOMETOWN = " + body + ";\n")
    tmp = OUT.parent / (OUT.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")     # 先写临时文件再改名，避免中途出错留下半截数据
    os.replace(str(tmp), str(OUT))
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
