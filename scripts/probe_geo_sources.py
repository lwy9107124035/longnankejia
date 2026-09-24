"""探一下这台机器上还有哪些地理编码源可用（家乡地图要点真实坐标，不能靠手绘）。

背景：本机所有 HTTPS 都走 127.0.0.1:31181 加速器，绕过表里没有 github.io，
nominatim / overpass 这类站点不一定通。这里逐个试，把能用的记下来。
"""
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROXY = os.environ.get("HTTPS_PROXY") or "http://127.0.0.1:31181"
UA = {"User-Agent": "longnankejia-museum-demo/1.0 (research; contact via repo)"}


def get(url, timeout=25):
    req = urllib.request.Request(url, headers=UA)
    handler = urllib.request.ProxyHandler({"https": PROXY, "http": PROXY})
    opener = urllib.request.build_opener(handler)
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200]
    except Exception as e:  # noqa: BLE001
        return None, ("%s: %s" % (type(e).__name__, e))[:160]


TESTS = {
    "datav-outline": "https://geo.datav.aliyun.com/areas_v3/bound/360783.json",
    "datav-towns": "https://geo.datav.aliyun.com/areas_v3/bound/360783_full.json",
    "nominatim": "https://nominatim.openstreetmap.org/search?format=json&limit=2&q=" + urllib.parse.quote("杨村镇 龙南"),
    "nominatim-mirror": "https://nominatim.osm.uk/search?format=json&limit=2&q=" + urllib.parse.quote("杨村镇 龙南"),
    "wikidata-claims": "https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=Q1336164&property=P625&format=json",
    "wikipedia-coords": "https://zh.wikipedia.org/w/api.php?action=query&prop=coordinates&titles=" + urllib.parse.quote("杨村镇|程龙镇|龙南镇") + "&format=json&redirects=1",
}

for name, url in TESTS.items():
    code, body = get(url)
    size = len(body) if isinstance(body, (bytes, str)) else 0
    print("%-18s %s  %s bytes" % (name, code, size))
    if isinstance(body, bytes) and code == 200:
        path = os.path.join("C:/tmp/hm", name + ".json")
        os.makedirs("C:/tmp/hm", exist_ok=True)
        open(path, "wb").write(body)
        try:
            d = json.loads(body.decode("utf-8"))
            keys = list(d)[:6] if isinstance(d, dict) else type(d).__name__
            print("       json ok, top keys:", keys)
        except Exception as e:  # noqa: BLE001
            print("       not json:", str(e)[:80], body[:80])
    else:
        print("       ", str(body)[:150])

print("\nDNS 直连测试（不走代理）:")
for host in ["nominatim.openstreetmap.org", "geo.datav.aliyun.com", "query.wikidata.org"]:
    try:
        print("  %-32s %s" % (host, socket.gethostbyname(host)))
    except Exception as e:  # noqa: BLE001
        print("  %-32s %s" % (host, e))
