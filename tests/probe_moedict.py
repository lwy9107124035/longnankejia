"""一次性探测：确认萌典客家语 p 字段的真实字符，验证 js/pron.js 的解析规则。

只在开发时手跑（python tests/probe_moedict.py），不进 CI：
它打的是外网接口，测试套件不该依赖第三方可用性。
"""
import io
import json
import re
import sys
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WORDS = ["客", "米果", "寿", "壽", "茶", "蓝", "藍", "量子计算", "豆腐", "黄元米果"]

# 与 js/pron.js parseReadings 保持一致的清理规则，先在这里验证
STRIP = re.compile(
    "[̀-Ͱ"        # 组合音标（声调号）
    "\u20d0-\u20f0"  # 带圈/加粗类组合符（⃞ 就在这里）
    "\ufe20-\ufe2f"
    "\U000e0100-\U000e01ef"
    "\ufff9-\ufffb"  # 萌典的 ￹…￻ 标记
    "`~]"
)


def parse(p):
    clean = STRIP.sub("", p or "")
    out = []
    for tok in re.split(r"\s+", clean):
        if tok:
            out.append(tok)
    return out


def fetch(word):
    url = "https://www.moedict.tw/h/" + urllib.parse.quote(word)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # noqa: BLE001
        return "err:" + type(e).__name__, None


def main():
    for w in WORDS:
        status, data = fetch(w)
        if status != 200:
            print(f"{w}: HTTP {status}")
            continue
        ps = [e.get("p", "") for e in data.get("h", [])]
        print(f"{w}: 200, {len(ps)} 条")
        for p in ps:
            print("   raw   ", repr(p))
            print("   parsed", parse(p))


if __name__ == "__main__":
    main()
