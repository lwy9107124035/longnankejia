"""Static integrity checks for the 龙南客家非遗数字助手 site.

Catches the failure modes this project has actually hit: assets moved or renamed
without updating the JS that builds their paths, 典藏 page numbers pointing at PDF
images that were never extracted, and JS files that no longer parse.

Run:  python tests/check_static.py       (exit 1 on any failure)
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Windows consoles default to GBK, which cannot print the Chinese module names.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass
failures = []
notes = []


def rel(*p):
    return os.path.join(ROOT, *p)


def fail(msg):
    failures.append(msg)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def is_local(ref):
    if re.match(r"^(https?:|data:|mailto:|tel:|//)", ref) or ref.startswith("#"):
        return False
    return not ref.startswith("/")


# ---------------------------------------------------------------- JS syntax
def check_js_syntax():
    jsdir = rel("js")
    for name in sorted(os.listdir(jsdir)):
        if not name.endswith(".js") or name == "secrets.js":
            continue
        path = os.path.join(jsdir, name)
        r = subprocess.run(["node", "--check", path], capture_output=True, text=True, shell=False)
        if r.returncode != 0:
            fail("js/%s does not parse: %s" % (name, r.stderr.strip().splitlines()[-1:]))
    for name in sorted(os.listdir(rel("scripts"))) if os.path.isdir(rel("scripts")) else []:
        if name.endswith(".py"):
            r = subprocess.run([sys.executable, "-m", "py_compile", rel("scripts", name)],
                               capture_output=True, text=True)
            if r.returncode:
                fail("scripts/%s does not compile: %s" % (name, r.stderr.strip()[-300:]))


# ------------------------------------------------- index.html script/style tags
def check_index_tags():
    html = read(rel("index.html"))
    refs = re.findall(r'<script[^>]*\ssrc="([^"]+)"', html) + re.findall(r'<link[^>]*\shref="([^"]+)"', html)
    for ref in refs:
        if not is_local(ref):
            continue
        if not os.path.exists(rel(ref)):
            fail("index.html references missing file: %s" % ref)
    # every hand-written app module should actually be loaded
    skip = {"vendor", "secrets.js"}
    for name in sorted(os.listdir(rel("js"))):
        if name.endswith(".js") and name not in skip and "js/" + name not in refs:
            fail("js/%s exists but is not loaded by index.html" % name)
    return html


# --------------------------------------------------------- path strings in JS
PATH_RE = re.compile(r"""['"]((?:assets|js|css|data)/[\w./-]*)['"]""")


def collect_js_path_literals():
    found = {}
    for dirpath, _dirs, files in os.walk(rel("js")):
        for name in files:
            if not name.endswith(".js"):
                continue
            p = os.path.join(dirpath, name)
            for m in PATH_RE.finditer(read(p)):
                found.setdefault(m.group(1), set()).add(os.path.relpath(p, ROOT))
    return found


def check_concatenated_paths():
    """assets/pdf-imgs/page-<NN>.jpg is built at runtime from the 典藏 data."""
    data = read(rel("js", "diancang-data.js"))
    pages = set()
    for m in re.finditer(r"page\s*:\s*['\"]?(\d+)", data):
        pages.add(int(m.group(1)))
    for m in re.finditer(r"['\"](\d+)['\"]\s*:\s*['\"]https", data):
        pages.add(int(m.group(1)))
    for m in re.finditer(r"page-(\d+)\.jpg", data):
        pages.add(int(m.group(1)))
    missing = [p for p in sorted(pages) if not os.path.exists(rel("assets", "pdf-imgs", "page-%02d.jpg" % p))]
    if missing:
        fail("典藏 pages with no extracted image: %s" % ", ".join(str(p) for p in missing))
    notes.append("典藏 references %d PDF pages, all present" % len(pages))
    return pages


def check_path_literals(pages):
    literals = collect_js_path_literals()
    for ref, srcs in sorted(literals.items()):
        if "%" in ref or ref.endswith(("-", "/", "+")):
            continue  # a concatenation prefix, not a complete path
        if not os.path.exists(rel(ref)):
            fail("path literal '%s' (in %s) does not exist" % (ref, ", ".join(sorted(srcs))))
    return literals


# ----------------------------------------------------------- orphan assets
def check_orphans(literals, html):
    shipped = set()
    for sub in ("textures", "avatar"):
        d = rel("assets", sub)
        if os.path.isdir(d):
            shipped |= {"assets/%s/%s" % (sub, f) for f in os.listdir(d)}
    d = rel("assets", "pdf-imgs")
    if os.path.isdir(d):
        shipped |= {"assets/pdf-imgs/" + f for f in os.listdir(d)}
    used = set(literals)
    for m in re.finditer(r"""['"]?(assets|css|js)/[\w./-]+\.(?:png|jpe?g|svg|js|css)['"]?""", html):
        used.add(m.group(0).strip("'\""))
    # 典藏 thumbnails are assembled by concatenation, so match them by directory
    used |= {p for p in shipped if p.startswith("assets/pdf-imgs/")}
    dead = sorted(p for p in shipped - used)
    if dead:
        fail("shipped but never referenced: %s" % ", ".join(dead))


# ------------------------------------------------------- watermark regression
BADGE_ZONE = (836, 914, 1024, 1024)
BADGE_TEMPLATE = rel("tests", "badge-template.npy")
BADGE_THRESHOLD = 0.40   # measured: watermarked 0.54-0.91, cleaned 0.06-0.25


def check_textures_clean():
    """Correlate each shipped map against the recovered generator badge.

    tests/badge-template.npy holds the badge's glyph pattern, recovered as the median
    of (watermarked - cleaned) across the texture set. Matching it against a map scores
    high only while the mark is still present, so a texture that gets swapped back in
    un-cleaned fails here instead of quietly reappearing on the 3D models.
    """
    try:
        import numpy as np
        import cv2
        from PIL import Image
    except ImportError:
        notes.append("numpy/cv2/PIL unavailable, skipped badge check")
        return
    if not os.path.exists(BADGE_TEMPLATE):
        notes.append("badge template missing, skipped badge check")
        return
    tmpl = np.load(BADGE_TEMPLATE)
    d = rel("assets", "textures")
    if not os.path.isdir(d):
        fail("assets/textures missing")
        return
    for name in sorted(os.listdir(d)):
        if not name.endswith(".png"):
            continue
        rgb = np.asarray(Image.open(os.path.join(d, name)).convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        if gray.shape[0] < tmpl.shape[0] or gray.shape[1] < tmpl.shape[1]:
            fail("assets/textures/%s is smaller than the badge zone" % name)
            continue
        # search only around the corner the generator uses, not the whole canvas
        x0, y0, x1, y1 = BADGE_ZONE
        pad = 60
        win = gray[max(y0 - pad, 0):min(y1, gray.shape[0]), max(x0 - pad, 0):min(x1, gray.shape[1])]
        score = float(cv2.matchTemplate(win, tmpl, cv2.TM_CCOEFF_NORMED).max())
        if score > BADGE_THRESHOLD:
            fail("assets/textures/%s still carries the generator badge (score %.2f)" % (name, score))
    notes.append("badge correlation checked on %d shipped maps" % len(
        [f for f in os.listdir(d) if f.endswith(".png")]))


# ------------------------------------------------------------------- css vars
def check_css_vars():
    """The 护眼配色 rework renamed most palette tokens.

    A leftover var(--bg-card) does not throw — it just resolves to nothing, so the rule
    silently loses its colour. Catch that here rather than in a screenshot review.
    """
    css = read(rel("css", "style.css"))
    defined = set(re.findall(r"(--[\w-]+)\s*:", css))
    used = re.findall(r"var\(\s*(--[\w-]+)\s*(,)?", css)
    for name, has_fallback in used:
        if name not in defined and not has_fallback:
            fail("css/style.css uses var(%s) but never defines it" % name)
    # inline style attributes in the markup too
    html = read(rel("index.html"))
    for name in re.findall(r"var\(\s*(--[\w-]+)\s*\)", html):
        if name not in defined:
            fail("index.html uses var(%s) which css/style.css never defines" % name)
    notes.append("%d css custom properties defined, all references resolve" % len(defined))


# --------------------------------------------------------------- QR entry code
def check_qr_entry():
    """The site must keep a scannable entry QR code.

    Requirement, twice-misread: "no QR codes" applies to the printed codes inside the
    典藏 book pages, NOT to the site's own entry code — museum visitors scan that to
    open the page. An earlier check asserted the opposite and this encoder got deleted
    on the strength of it. Guard the presence instead so it cannot be removed again.
    """
    html = read(rel("index.html"))
    if not os.path.exists(rel("js", "qr.js")):
        fail("js/qr.js 缺失 —— 站点入口二维码没有生成器，馆内观众无法扫码进入")
    else:
        qr = read(rel("js", "qr.js"))
        for needle in ("function encode", "function render", "window.QR"):
            if needle not in qr:
                fail("js/qr.js 缺少 %r，入口二维码不可用" % needle)
        # the adapter only delegates; without the vendored encoder the panel renders blank
        for vend in ("js/vendor/qrcode.js", "js/vendor/qrcode-utf8.js"):
            if not os.path.exists(rel(*vend.split("/"))):
                fail("%s 缺失 —— 入口二维码没有可调用的编码器" % vend)
            elif vend not in html:
                fail("index.html 未加载 %s" % vend)
            elif html.index(vend) > html.index("js/qr.js"):
                fail("%s 必须在 js/qr.js 之前加载" % vend)
        if "window.qrcode" not in qr:
            fail("js/qr.js 不再调用 vendored 编码器")

    if "js/qr.js" not in html:
        fail("index.html 没有加载 js/qr.js")
    if 'id="addrQr"' not in html:
        fail("index.html 缺少二维码容器 #addrQr")
    ui = read(rel("js", "ui.js"))
    if "window.QR.render" not in ui:
        fail("js/ui.js 不再渲染入口二维码")

    # 印展板那张成品图不能和代码里的永久地址脱节：换宿主时最容易忘的就是它
    cfg = read(rel("js", "config.js"))
    m = re.search(r"canonicalUrl:\s*'([^']*)'", cfg)
    canon = m.group(1) if m else ""
    if not canon.startswith("http"):
        fail("js/config.js 的 app.canonicalUrl 不是一个网址，展板地址无处可寻")
    png = rel("docs", "入口二维码.png")
    if os.path.exists(png) and canon.startswith("http"):
        try:
            import cv2
            import numpy as np
            from PIL import Image
            img = np.asarray(Image.open(png).convert("RGB"))
            got, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
        except ImportError:
            got = None
            notes.append("缺 cv2/Pillow，跳过展板成品图核对")
        if got is not None and got != canon:
            fail("docs/入口二维码.png 解出来是 %r，与 canonicalUrl %r 不一致"
                 "（跑 python scripts/make_entry_qr_png.py 重生成）" % (got, canon))
        elif got == canon:
            notes.append("展板成品二维码与 canonicalUrl 一致：%s" % canon)
    notes.append("站点入口二维码：生成器、加载、容器、渲染四处均在位")


# ------------------------------------------ 典藏正文不得残留 PDF 页码残渣
def check_diancang_text_clean():
    """书页码被印在正文同一行，注入时会粘成「21421435迎龙灯…」「hhh大漆…」这类乱码。

    scripts/strip_pdf_furniture.py 负责清；这条守卫保证以后重跑注入脚本、或者从
    PDF 补新条目时，残渣不会再悄悄回到观众眼前。四位年份开头（1929年…）是正文。
    """
    src = read(rel("js", "diancang-data.js"))
    junk = re.compile(r"^(?!19\d\d年|20\d\d年)[0-9a-z]{2,10}(?=[\u4e00-\u9fff])")
    bad = []
    for m in re.finditer(r"(?:text|desc):\s*'((?:[^'\\]|\\.)*)'", src, re.S):
        body = m.group(1).strip()
        if junk.match(body):
            bad.append(body[:18])
    for b in bad[:6]:
        fail("典藏正文以页码残渣开头：%r —— 跑 python scripts/strip_pdf_furniture.py" % b)
    if not bad:
        notes.append("典藏正文无 PDF 页码残渣")


# ------------------------------------------------- 典藏 exhibit ↔ image mapping
def check_diancang_pages():
    """Every exhibit's illustration must be the book page that actually describes it.

    `page` in diancang-data.js is the printed page number while assets/pdf-imgs/page-NN.jpg
    is numbered by PDF sheet index; they drift 2-5 apart through the book, so the images
    were all showing a neighbouring exhibit. data/exhibit-openings.json records, per exhibit,
    the PDF sheet it was matched to plus that sheet's display title and body opening, which
    is what lets us re-verify the match without re-reading the 116 MB PDF.
    """
    fixture = rel("data", "exhibit-openings.json")
    if not os.path.exists(fixture):
        notes.append("exhibit-openings.json missing, skipped page check")
        return
    openings = json.load(open(fixture, encoding="utf-8"))
    data = read(rel("js", "diancang-data.js"))

    checked = 0
    for m in re.finditer(r"name:\s*'([^']+)'([^}]*?)desc:", data, re.S):
        name = m.group(1)
        sm = re.search(r"sheet:\s*(\d+)", m.group(2))
        if not sm:
            continue
        sheet = int(sm.group(1))
        checked += 1
        img = rel("assets", "pdf-imgs", "page-%02d.jpg" % sheet)
        if not os.path.exists(img):
            fail("「%s」配到 page-%02d.jpg，但该图片不存在" % (name, sheet))
        rec = openings.get(name)
        if not rec:
            fail("「%s」有 sheet 字段但没有可核对的 PDF 夹具记录" % name)
            continue
        if rec["sheet"] != sheet:
            fail("「%s」数据里 sheet=%d，夹具里是 %d" % (name, sheet, rec["sheet"]))
            continue
        name_chars = set(re.sub(r"""["“”‘’\s]""", "", name))
        title_chars = set(rec.get("title", ""))
        if not (name_chars <= title_chars or re.sub(r"""["“”‘’]""", "", name) in rec["opening"]):
            fail("「%s」与所配页对不上：标题「%s」正文「%s」" % (name, rec.get("title", ""), rec["opening"][:24]))
    notes.append("典藏 %d 件展品的配图页码已与 PDF 原文核对" % checked)


# ------------------------------------------------------------- deploy workflow
def check_deploy_workflow():
    """Pages is the daily host; Netlify is manual-only; the preview must not carry the key.

    Netlify moved to a credit model and this account is out of credits with no card on
    file, so every production deploy there now fails ("new deploys are blocked until
    credits are added") while the site keeps serving its last good deploy. Daily delivery
    therefore went to GitHub Pages, which has no such gate. Two invariants matter:
    the dev copy served at /dev/ is a second public host and must not embed the live
    SiliconFlow key (this repo leaked it once already), and the published set is an
    allowlist — docs/ holds the competition notices and a résumé, and on Netlify
    publish="." had exposed tests/badge-template.npy and scripts/ to anyone who guessed
    the URL.
    """
    dep = rel(".github", "workflows", "deploy.yml")
    if os.path.exists(dep):
        txt = read(dep)
        if re.search(r"^\s*push:", txt, re.M):
            fail("deploy.yml 仍有 push 触发——Netlify 额度用尽后每次 push 都会红一次，"
                 "日常上线已交给 pages.yml")
        if "exit 1" not in txt:
            fail("deploy.yml 没有拦住非 main 分支：别名部署会在 Netlify 留下永不更新的公开预览站")

    pages = rel(".github", "workflows", "pages.yml")
    if not os.path.exists(pages):
        fail("pages.yml 缺失——GitHub Pages 镜像通道")
        return
    ptxt = read(pages)
    for need in ("ref: main", "ref: dev", "site/dev"):
        if need not in ptxt:
            fail("pages.yml 缺少 %r：生产与 dev 预览必须同时出自一次部署" % need)
    # 预览那份必须是空 key；生产那份才允许引用密钥
    if 'apiKey:""};\' > src-dev/js/secrets.js' not in ptxt:
        fail("pages.yml 里 dev 预览的 secrets.js 不是空密钥，预览站会带上真实 key")
    if "SILICONFLOW_API_KEY" not in ptxt:
        fail("pages.yml 不再注入生产密钥，线上大模型引擎会静默失效")
    # 发布集必须是白名单：pack() 里从源码目录搬的每一项都得是页面真正加载的东西
    allow = {"index.html", "css", "js", "assets/avatar", "assets/pdf-imgs", "assets/textures"}
    moved = set(re.findall(r'"\$src/([A-Za-z0-9_./-]+)"', ptxt))
    for m in sorted(moved - allow):
        fail("pages.yml 把 %s 也搬进了上线目录；白名单只有 %s" % (m, "、".join(sorted(allow))))
    if not moved:
        fail("pages.yml 里找不到 pack() 的 $src/... 搬运语句，白名单守卫失效")

    # Cloudflare Pages 是现在的公开入口，同样两条规矩：dev 不带 key、只上线白名单
    cf = rel(".github", "workflows", "cf-pages.yml")
    if not os.path.exists(cf):
        fail("cf-pages.yml 缺失——Cloudflare Pages 才是公开入口")
        return
    ctxt = read(cf)
    if 'PROJECT=longnankejia-dev; KEY=""' not in ctxt:
        fail("cf-pages.yml 里 dev 分支不是空 key，预览站会带上真实密钥")
    if "SILICONFLOW_API_KEY" not in ctxt:
        fail("cf-pages.yml 不再注入生产密钥，线上大模型引擎会静默失效")
    if "CLOUDFLARE_API_TOKEN" not in ctxt:
        fail("cf-pages.yml 没有用 CLOUDFLARE_API_TOKEN 认证")
    cf_moved = set(re.findall(r'(?:cp -r |cp )"(?:_site/)?([A-Za-z0-9_./-]+)"? _site', ctxt))
    cf_moved |= set(re.findall(r'cp -r ([A-Za-z0-9_./ -]+) _site(?:/assets)?/', ctxt))
    for m in sorted({x for grp in cf_moved for x in grp.split() if x} - allow):
        fail("cf-pages.yml 把 %s 也搬进了上线目录；白名单只有 %s" % (m, "、".join(sorted(allow))))
    notes.append("公开入口 = Cloudflare Pages（main→longnankejia，dev→longnankejia-dev，dev 不带密钥）")
    notes.append("上线走 pages.yml（main → 根，dev → /dev/，预览不带密钥）；Netlify 仅手动")


# --------------------------------------------------------------- git hygiene
def check_gitignore():
    txt = read(rel(".gitignore"))
    if "js/secrets.js" not in txt:
        fail(".gitignore no longer ignores js/secrets.js")
    if "secrets" not in txt:
        fail(".gitignore unreadable")
    # mojibake from the old file would show up as replacement chars
    bad = [ln for ln in txt.splitlines() if "Ã" in ln or "ï»¿" in ln or "\ufffd" in ln]
    if bad:
        fail(".gitignore still contains mis-encoded lines: %s" % bad)


# ------------------------------------------------------- 字→读音（pron.js）
def check_pron_layers():
    """读音查询的三条硬约束：来源必须分层标清、简繁表要先加载、不许假装会念。

    萌典的 p 字段里全是不可见字符（U+20DE 组合符、U+FFF9-FFFB 标记）。这些字符一旦
    以明文写进源码，任何一次"顺手整理"都可能把它们吃掉，而解析只是安静地少几个腔调。
    所以这里要求源码里用 \\u 转义写，明文不可见字符一个都不留。
    """
    html = read(rel("index.html"))
    refs = re.findall(r'<script[^>]*\ssrc="([^"]+)"', html)
    if "js/data-s2t.js" not in refs or "js/pron.js" not in refs:
        fail("pron 模块没有被 index.html 加载：%s" % [r for r in ("js/data-s2t.js", "js/pron.js") if r not in refs])
        return
    if refs.index("js/data-s2t.js") > refs.index("js/pron.js"):
        fail("js/data-s2t.js 必须在 js/pron.js 之前加载，否则简体转繁体永远拿不到表")

    src = read(rel("js", "pron.js"))
    invisible = sorted({ord(c) for c in src
                        if 0x300 <= ord(c) <= 0x36f or 0x20d0 <= ord(c) <= 0x20f0
                        or 0xfe20 <= ord(c) <= 0xfe2f or 0xfff9 <= ord(c) <= 0xfffb})
    if invisible:
        fail("js/pron.js 里残留不可见字符明文（应写成 \\u 转义）：%s" % [hex(c) for c in invisible])
    if "\\u20d0" not in src:
        fail("js/pron.js 的解析正则不再剥 U+20DE，萌典读音会被解析成「四\\u20de...」这种残句")
    # 台湾腔不是龙南腔：这句话是学术诚实的底线，不能被当成装饰删掉
    if "台湾客家语" not in src or "宁龙片" not in src:
        fail("js/pron.js 丢了「这是台湾客家语，不是龙南宁龙片」的来源提醒")
    for fake in ("speechSynthesis", "SpeechSynthesis", " tts", "AudioContext"):
        if fake in src.lower():
            fail("js/pron.js 出现了合成语音（%s）：本站没有客家话 TTS，不许假装会念" % fake.strip())

    s2t = read(rel("js", "data-s2t.js"))
    m = re.search(r"window\.S2T\s*=\s*(\{.*\})", s2t, re.S)
    if not m:
        fail("js/data-s2t.js 没有 window.S2T 赋值")
        return
    table = json.loads(m.group(1))
    if len(table) < 2000:
        fail("简繁表只剩 %d 字，像是生成脚本读错了 Unihan 字段" % len(table))
    for simp, trad in (("寿", "壽"), ("蓝", "藍"), ("黄", "黃")):
        if table.get(simp) is None or trad not in table[simp]:
            fail("简繁表缺「%s→%s」，观众打这个字会被误报成查不到" % (simp, trad))
    if any(k == v for k, v in table.items()):
        fail("简繁表里有自身映射自身的条目，会让 pron 白跑一次请求")
    notes.append("简繁转换表 %d 字，萌典层已具备简体入口" % len(table))

    gen = read(rel("scripts", "build_s2t_table.py"))
    if "Unihan_Variants.txt" not in gen or "kSimplifiedVariant" not in gen:
        fail("build_s2t_table.py 不再从 Unihan_Variants 的 kSimplifiedVariant 取数")
    if "len(table) < 1000" not in gen:
        fail("build_s2t_table.py 丢了「解析到 0 条就报错退出」的守卫，空表会安静地产出")


# ------------------------------------------------------------- 家乡地图
def check_hometown_map():
    """家乡那页的地图必须是真实地理数据，且来源、日期、精度都要留在文件里。

    这一条守的是"不许编"：博物馆里把围屋画错地方就是错信息。所以既检查数据形状
    （点数、点位是否落在县界内），也检查来源标注还在不在——被精简掉时界面就没法自证。
    """
    html = read(rel("index.html"))
    refs = re.findall(r'<script[^>]*\ssrc="([^"]+)"', html)
    for need in ("js/data-hometown.js", "js/hometown.js"):
        if need not in refs:
            fail("家乡模块没有被 index.html 加载：%s" % need)
    if "js/diancang.js" not in refs or refs.index("js/diancang.js") > refs.index("js/hometown.js"):
        fail("js/hometown.js 必须在 js/diancang.js 之后加载，否则展品关联绑不上")
    if 'data-panel="panelHometown"' not in html:
        fail("顶部 Tab 栏没有「家乡」入口")

    src = read(rel("js", "hometown.js"))
    if "speechSynthesis" in src or "AudioContext" in src:
        fail("js/hometown.js 出现了合成语音：本站没有客家话 TTS，不许假装会念")
    for kw in ("国家基础地理信息中心", "没有以这个地方为出处"):
        if kw not in src and kw not in read(rel("js", "data-hometown.js")):
            fail("js/hometown.js 丢了「%s」这句话" % kw)

    raw = read(rel("js", "data-hometown.js"))
    m = re.search(r"window\.HOMETOWN\s*=\s*(\{.*\})", raw, re.S)
    if not m:
        fail("js/data-hometown.js 没有 window.HOMETOWN 赋值")
        return
    data = json.loads(m.group(1))
    ring, places, bbox = data.get("outline") or [], data.get("places") or [], data.get("bbox") or []
    if len(ring) < 80:
        fail("县界只有 %d 个点，不像真实边界（生成脚本大概简化过头）" % len(ring))
    if len(places) < 12:
        fail("地图只有 %d 个点位，取数源大概抖了" % len(places))
    if len(bbox) != 4:
        fail("data-hometown.js 缺 bbox")
        return
    out = [p["name"] for p in places
           if not (bbox[0] <= p["lon"] <= bbox[2] and bbox[1] <= p["lat"] <= bbox[3])]
    if out:
        fail("这些点位落在龙南市边界外，坐标或底图有一方是错的：%s" % "、".join(out))
    if not data.get("source", {}).get("outline") or not data.get("retrieved"):
        fail("data-hometown.js 丢了来源或取数日期")
    if len(set(p["name"] for p in places)) != len(places):
        fail("地图上有重名点位，点击会选错地方")
    notes.append("家乡地图：%d 点县界 + %d 个真实坐标点位（%s 取数）"
                 % (len(ring), len(places), data.get("retrieved")))

    gen = read(rel("scripts", "build_hometown_map.py"))
    if "360783" not in gen or "FALLBACK_COORDS" not in gen:
        fail("build_hometown_map.py 不再取龙南市(360783)边界或缺少坐标兜底表")
    if "落在龙南边界外" not in gen:
        fail("build_hometown_map.py 丢了「点位必须在县界内」的自检")


def main():
    os.chdir(ROOT)
    html = check_index_tags()
    pages = check_concatenated_paths()
    literals = check_path_literals(pages)
    check_orphans(literals, html)
    check_textures_clean()
    check_css_vars()
    check_qr_entry()
    check_diancang_text_clean()
    check_diancang_pages()
    check_pron_layers()
    check_hometown_map()
    check_deploy_workflow()
    check_js_syntax()
    check_gitignore()

    for n in notes:
        print("  note   %s" % n)
    for f in failures:
        print("  FAIL   %s" % f)
    print("\n%s static check(s) failed." % len(failures) if failures else "\nAll static checks passed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
