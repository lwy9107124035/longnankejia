"""为「典藏检索 / 字→读音 / 家乡地图」三组新断言跑反向用例：每条都必须能失败一次。

    python tests/negative_pron.py                # 全部变异（约 25 分钟）
    python tests/negative_pron.py M3 H1          # 只跑指定编号

做法：把源码里的某一处理智地改坏（或干脆删掉），只跑相关的那一节浏览器测试，
要求对应的断言出现在 FAIL 列表里；然后原样还原。
变异只碰 diancang / pron / hometown / router / index.html / 地图数据，
跑完会逐个文件与进来时比对，确认没留下半截变异。
"""
import io
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

DC = "js/diancang.js"
HT = "js/hometown.js"
HM = "js/data-hometown.js"
RT = "js/router.js"
IDX = "index.html"

# (编号, 说明, 文件, 原文片段, 替换片段, 期望失败的断言名列表, 只跑哪些节)
MUTATIONS = [
    ("M1", "展品名命中不再加分", DC,
     "      if (name === q) score += 100;\n"
     "      else if (name.indexOf(q) !== -1) score += 60;\n"
     "      else if (q.indexOf(name) !== -1 && name.length >= 2) score += 45;",
     "      if (name === q) score += 0;\n"
     "      else if (name.indexOf(q) !== -1) score += 0;\n"
     "      else if (q.indexOf(name) !== -1 && name.length >= 2) score += 0;",
     ["展品名命中的分数远高于正文顺带提到"], "7c"),
    ("M2", "不再回带命中句", DC,
     "return { item: it, chapter: rec.chapter, score: score, sentence: sentence };",
     "return { item: it, chapter: rec.chapter, score: score, sentence: '' };",
     ["每条命中带回到底是哪句话说了它"], "7c"),
    ("M3", "结果不排序", DC,
     ".sort(function (a, b) { return b.score - a.score; });",
     ".sort(function () { return 0; });",
     ["「豆腐」跨条目命中且按分数降序"], "7c"),
    ("M4", "有原声不再标 🔊", DC,
     "esc(h.item.name) + (h.item.videoUrl ? ' 🔊' : '')", "esc(h.item.name)",
     ["有原声的条目标了🔊"], "7c"),
    ("M5", "命中词不再高亮", DC,
     "return esc(sentence.slice(0, at)) + '<mark>' + esc(sentence.substr(at, q.length))\n      + '</mark>' + esc(sentence.slice(at + q.length));",
     "return esc(sentence);",
     ["命中的词在句子里被标记出来"], "7c"),
    ("M6", "查不到时空着手回来", DC,
     "hint.textContent = '42 件展品的正文里没有「' + q + '」。换个说法，或者只打两个字试试。';",
     "hint.textContent = '';",
     ["查不到时说明缺口并给出下一步"], "7c"),
    ("M7", "清空输入仍留着上一次结果", DC,
     "      hint.textContent = '';\n      listEl.innerHTML = '';\n      return;",
     "      return;",
     ["清空输入不留下半截结果"], "7c"),
    ("M8", "结果点了没反应", DC,
     "        showItemDetail(hits[parseInt(btn.getAttribute('data-i'), 10)].item);",
     "        void btn;",
     ["点一条结果翻到那件展品的详情", "打开的正是列表里点的那一条"], "7c"),
    ("M9", "回车不触发检索", DC,
     "    if (input) input.addEventListener('keydown', function (e) {\n      if (e.key === 'Enter') runFind();\n    });",
     "    void input;",
     ["回车等同点按钮"], "7c"),
    ("M10", "片段兜底放宽到单字，什么都能查到", DC,
     "for (var len = Math.min(q.length, 6); len >= 2 && !frag; len--) {",
     "for (var len = Math.min(q.length, 6); len >= 1 && !frag; len--) {",
     ["正文里真没有的词就是 0 条，不硬凑相近字"], "7c"),
    # ---------------- 家乡地图（js/hometown.js 与其数据、入口、路由） ----------------
    ("H1", "标签避让不再起作用", HT,
     "if (Math.abs(dots[i].x - dots[j].x) < 48 && Math.abs(dots[i].ly - dots[j].ly) < 12) {",
     "if (Math.abs(dots[i].x - dots[j].x) < 0 && Math.abs(dots[i].ly - dots[j].ly) < 12) {",
     ["地名标签互不重叠"], "7d"),
    ("H2", "两字撞词也算关联", HT,
     "        if (!dup && mentions(h.item, words[w])) picked.push(h);",
     "        if (!dup) picked.push(h);",
     ["地名关联按字面全名或通名严格取"], "7d"),
    ("H3", "不再标出处件数", HT,
     "esc(p.name) + '<tspan class=\"hm-badge\">' + n + '</tspan></text>'",
     "esc(p.name) + '</text>'",
     ["每个地点的角标都 ≥1（不画没有出处的点）", "角标数字与真实出处数一致"], "7d"),
    ("H4", "没录音也给播放键", HT,
     "    var audio = it.videoUrl\n      ? '<button class=\"hm-item hm-play\" type=\"button\" data-name=\"' + esc(it.name)\n        + '\" data-url=\"' + esc(it.videoUrl) + '\">▶ 听这段客家话讲解</button>'\n      : '';",
     "    var audio = '<button class=\"hm-item hm-play\" type=\"button\" data-name=\"' + esc(it.name)\n      + '\" data-url=\"' + esc(it.videoUrl || '') + '\">▶ 听这段客家话讲解</button>';",
     ["没录音就不给播放键，不假装能听", "有录音的那几段给到可点的播放键"], "7d"),
    ("H5", "点播放键没反应", HT,
     "        if (url && window.Diancang) {", "        if (false && url && window.Diancang) {",
     ["点播放键打开那段客家话讲解"], "7d"),
    ("H6", "键盘选不了地点", HT,
     "      g.addEventListener('keydown', function (e) {\n        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }\n      });",
     "      void pick;",
     ["键盘回车也能选中地点"], "7d"),
    ("H7", "介绍改成补写的话", HT,
     "      + '<p class=\"hm-quote-text\">' + markWord(sent, word) + '</p>'",
     "      + '<p class=\"hm-quote-text\">这个地方是客家先民南迁途中落脚的重镇，值得一看。</p>'",
     ["引文逐字来自《文化典藏》正文"], "7d"),
    ("H8", "不再交代底图来源", HT,
     "'<br><span class=\"hm-src\">底图：' + esc(data.source.outline)",
     "'<br><span class=\"hm-src\">底图：' + '略'",
     ["未点选时先交代底图与坐标来源"], "7d"),
    ("H9", "不写地点坐标", HT,
     "'<div class=\"hm-geo\">' + p.lat.toFixed(4)", "'<div class=\"hm-geo\">' + ''",
     ["地点坐标如实写出"], "7d"),
    ("H10", "县界退化成五边形", HT,
     "return data.outline.map(function (p, i) {", "return data.outline.slice(0, 5).map(function (p, i) {",
     ["地图渲染成真实边界而不是示意图"], "7d"),
    ("H11", "家乡没有路由", RT,
     "    hometown: 'panelHometown',", "",
     ["点家乡 Tab 会写进地址栏"], "7d"),
    ("H12", "家乡 Tab 位置不对", IDX,
     "        <button class=\"main-tab\" data-panel=\"panelDiancang\" type=\"button\">\n"
     "          <span class=\"main-tab-icon\">📖</span>典藏\n"
     "        </button>\n"
     "        <button class=\"main-tab\" data-panel=\"panelHometown\" type=\"button\">\n"
     "          <span class=\"main-tab-icon\">🗺</span>家乡\n"
     "        </button>",
     "        <button class=\"main-tab\" data-panel=\"panelHometown\" type=\"button\">\n"
     "          <span class=\"main-tab-icon\">🗺</span>家乡\n"
     "        </button>\n"
     "        <button class=\"main-tab\" data-panel=\"panelDiancang\" type=\"button\">\n"
     "          <span class=\"main-tab-icon\">📖</span>典藏\n"
     "        </button>",
     ["Tab 顺序是 典藏 → 家乡 → 方言"], "7d"),
    ("H13", "点位被挪到县界外", HM,
     '"lat":24.56609', '"lat":30.56609',
     ["每个点位都落在龙南市范围内", "地名标签没有跑出画布"], "7d"),
    ("H14", "把书里没记的地点画回地图", HM,
     '"places":[{"name":"龙南镇"',
     '"places":[{"name":"临塘乡","kind":"town","lat":24.87846,"lon":114.80563,"wiki":"临塘乡","src":"x"},'
     '{"name":"龙南镇"',
     ["每个地点的角标都 ≥1（不画没有出处的点）"], "7d"),
]


def read(p):
    return io.open(os.path.join(ROOT, p), encoding="utf-8").read()


def write(p, s):
    io.open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n").write(s)


def run_only(sections):
    """跑一节并取回 FAIL 列表。

    端口被上一轮残留进程占住时，浏览器套件会直接 RUNNER ERROR 退出（rc=2、没有任何
    断言行）。那种情况下"期望的断言没失败"是假的结论——本文件曾被这个坑骗出 13 条
    误报。所以崩了就重试一次，再崩明确标注为跑挂了而不是断言不敏感。
    """
    proc = None
    for attempt in (1, 2):
        proc = subprocess.run(["node", "tests/run_site_tests.mjs", "--only=" + sections],
                              cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                              errors="replace")
        lines = re.findall(r"^\s*(?:pass|FAIL)\s+", proc.stdout or "", re.M)
        if lines:
            break
        if attempt == 1:
            print("   (第 %d 次跑挂了 rc=%s，重试一次)" % (attempt, proc.returncode))
            time.sleep(3)
    fails = re.findall(r"^\s*FAIL\s+(.+?)(?: — |$)", proc.stdout or "", re.M)
    crashed = not re.findall(r"^\s*(?:pass|FAIL)\s+", proc.stdout or "", re.M)
    return proc, fails, crashed


def main():
    pick = set(sys.argv[1:])
    todo = [m for m in MUTATIONS if not pick or m[0] in pick]
    ok = bad = 0
    untouched = {}
    for mid, desc, path, old, new, expect, sections in todo:
        src = read(path)
        untouched.setdefault(path, src)
        if src.count(old) != 1:
            print("%s SKIP 锚点命中 %d 次：%s" % (mid, src.count(old), desc))
            bad += 1
            continue
        write(path, src.replace(old, new, 1))
        try:
            proc, fails, crashed = run_only(sections)
            hit = [e for e in expect if any(e in f for f in fails)]
            if crashed:
                print("%s CRASH %-26s → 这一跑没出任何断言（rc=%s），结论不作数"
                      % (mid, desc, proc.returncode))
                bad += 1
            elif len(hit) == len(expect):
                print("%s ok   %-26s → %s" % (mid, desc, "、".join(hit)))
                ok += 1
            else:
                print("%s BAD  %-26s → 期望失败未出现：缺 %s；实际 FAIL：%s"
                      % (mid, desc, "、".join(e for e in expect if e not in hit),
                         "、".join(fails) or "（无 FAIL，进程 exit=%d）" % proc.returncode))
                bad += 1
        finally:
            write(path, src)
    # 和进来时比，不是和 HEAD 比：工作区本来就带着本次改动
    for path, before in untouched.items():
        if read(path) != before:
            print("!! 变异未还原干净：", path)
            bad += 1
    print("\n%d 条变异按预期失败，%d 条有问题" % (ok, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
