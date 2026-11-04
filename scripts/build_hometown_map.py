"""生成家乡地图，边界取自 DataV（360783），地点取自已复核的清单。

data/hometown-places.json 保存地图资料、逐点坐标来源和近似定位说明。
不再按有歧义的地名实时查询并覆盖坐标。边界缓存仍放在 C:/tmp/hm。
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "js" / "data-hometown.js"
CACHE = Path("C:/tmp/hm")
PROXY = os.environ.get("HTTPS_PROXY") or "http://127.0.0.1:31181"
UA = {"User-Agent": "longnankejia-museum-demo/1.0"}
PLACES_FILE = ROOT / "data" / "hometown-places.json"
MIN_PLACES = 6
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": PROXY, "http": PROXY}))

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


def collect_places(records, bbox):
    names = set()
    for place in records:
        name, lat, lon = place["name"], place["lat"], place["lon"]
        if name in names:
            raise SystemExit("重复地点：" + name)
        names.add(name)
        if not (math.isfinite(lat) and math.isfinite(lon)
                and bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            raise SystemExit(name + " 落在龙南边界外，请核对地点清单")
        if not place.get("coordinateSource", {}).get("label") or not place.get("desc"):
            raise SystemExit(name + " 缺少坐标来源或地点介绍")
    return records


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

    catalog = json.loads(PLACES_FILE.read_text(encoding="utf-8"))
    places = collect_places(catalog["places"], bbox)
    retrieved = catalog["verified"]
    print("已复核点位 %d 个" % len(places))
    if len(places) < MIN_PLACES:
        raise SystemExit("只拿到 %d 个点，低于 %d 个的下限，先别写文件" % (len(places), MIN_PLACES))

    payload = {
        "outline": ring,
        "bbox": [round(v, 4) for v in bbox],
        "retrieved": retrieved,
        "source": {
            "outline": "阿里云 DataV.GeoAtlas 行政区划数据（国家基础地理信息中心公开底图），adcode 360783",
            "points": catalog["source"],
        },
        "reference": {"title": catalog["reference"]["title"],
                      "published": catalog["reference"]["published"]},
        "places": places,
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    text = (
        "/* 家乡地图数据。由 scripts/build_hometown_map.py 生成，地点清单见 data/hometown-places.json。"
        "底图来源：" + payload["source"]["outline"] + "；坐标来源：" + payload["source"]["points"]
        + "。复核日期：" + retrieved + "；边界 " + str(len(ring)) + " 点，点位 " + str(len(places)) + " 个。 */\n"
        "window.HOMETOWN = " + body + ";\n")
    tmp = OUT.parent / (OUT.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")     # 先写临时文件再改名，避免中途出错留下半截数据
    os.replace(str(tmp), str(OUT))
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
