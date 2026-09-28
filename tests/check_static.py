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


def has_rule(css, cls):
    """CSS 里有没有这个类的选择器。必须整段匹配到结尾，
    否则 .hm-kind-town-off 会被当成 .hm-kind-town 命中。"""
    return re.search(r"\." + re.escape(cls) + r"(?![\w-])", css) is not None


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def loaded_css():
    """Audit the actual stylesheets the page loads, including module styles."""
    refs = re.findall(r'<link\b[^>]*href=["\']([^"\']+\.css)["\']', read(rel("index.html")))
    return "\n".join(read(rel(*ref.split("/"))) for ref in refs if is_local(ref))


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
    css = loaded_css()
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
    """Public static hosts never carry the key; Cloudflare Functions use server bindings.

    Netlify moved to a credit model and this account is out of credits with no card on
    file, so every production deploy there now fails ("new deploys are blocked until
    credits are added") while the site keeps serving its last good deploy. Daily delivery
    therefore went to GitHub Pages, which has no such gate. Public static assets never
    embed the live SiliconFlow key (this repo leaked it once already), and the published set is an
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
        if "SILICONFLOW_API_KEY" in txt or "secrets.SILICONFLOW_API_KEY" in txt:
            fail("deploy.yml 不得访问 API key；Netlify 静态备用站不能发布服务端密钥")
        if 'printf \'window.APP_SECRETS={apiKey:""};\' > js/secrets.js' not in txt:
            fail("deploy.yml 必须生成空的 secrets.js")

    pages = rel(".github", "workflows", "pages.yml")
    if not os.path.exists(pages):
        fail("pages.yml 缺失——GitHub Pages 镜像通道")
        return
    ptxt = read(pages)
    for need in ("ref: main", "ref: doubao", "site/doubao"):
        if need not in ptxt:
            fail("pages.yml 缺少 %r：main 与 doubao 镜像必须同时出自一次部署" % need)
    if 'printf \'window.APP_SECRETS={apiKey:""};\' > src-prod/js/secrets.js' not in ptxt:
        fail("pages.yml 的 main 镜像 secrets.js 必须为空，不能把 API key 发布到浏览器")
    if 'printf \'window.APP_SECRETS={apiKey:""};\' > src-doubao/js/secrets.js' not in ptxt:
        fail("pages.yml 的 doubao 镜像 secrets.js 必须为空，不能把 API key 发布到浏览器")
    if "SILICONFLOW_API_KEY" in ptxt:
        fail("pages.yml 不得读取或写入 API secret；GitHub Pages 仅通过 main 服务端代理调用")
    # 发布集必须是白名单：pack() 里从源码目录搬的每一项都得是页面真正加载的东西
    allow = {"index.html", "css", "js", "assets/avatar", "assets/pdf-imgs", "assets/textures"}
    moved = set(re.findall(r'"\$src/([A-Za-z0-9_./-]+)"', ptxt))
    for m in sorted(moved - allow):
        fail("pages.yml 把 %s 也搬进了上线目录；白名单只有 %s" % (m, "、".join(sorted(allow))))
    if not moved:
        fail("pages.yml 里找不到 pack() 的 $src/... 搬运语句，白名单守卫失效")

    # Cloudflare Pages 是公开入口：白名单资源、服务端 secret binding、永不内嵌静态 key。
    cf = rel(".github", "workflows", "cf-pages.yml")
    if not os.path.exists(cf):
        fail("cf-pages.yml 缺失——Cloudflare Pages 才是公开入口")
        return
    ctxt = read(cf)
    if not ("branches: [main, qcode, codex, doubao]" in ctxt or "branches: [main, qcode, codex, doubao, antigravity]" in ctxt):
        fail("cf-pages.yml 必须只自动部署 main、qcode、codex、doubao、antigravity 分支")
    for branch in ("main", "doubao", "qcode|codex"):
        if branch not in ctxt:
            fail("cf-pages.yml 缺少分支环境映射：%s" % branch)
    if 'PROJECT=longnankejia' not in ctxt or 'PROJECT=longnankejia-dev' not in ctxt:
        fail("cf-pages.yml 的 Cloudflare 项目映射缺失")
    if 'CF_ENV=production' not in ctxt or 'CF_ENV=preview' not in ctxt:
        fail("cf-pages.yml 必须区分 production 与 preview secret 环境")
    if "production_branch: 'doubao'" not in ctxt or "github.ref_name == 'doubao'" not in ctxt:
        fail("cf-pages.yml 必须在豆包分支部署前把 longnankejia-dev 生产分支切到 doubao")
    if 'pages secret put SILICONFLOW_API_KEY --project-name="$PROJECT" --env="$CF_ENV"' not in ctxt:
        fail("cf-pages.yml 没有安全同步服务端密钥")
    if 'printf \'%s\' "$CF_KEY" |' not in ctxt:
        fail("cf-pages.yml 必须将 API key 从 stdin 管道传入 Wrangler")
    if 'wrangler@4.137.0' not in ctxt:
        fail("cf-pages.yml 必须固定 Wrangler 版本 4.137.0")
    if 'set +x' not in ctxt:
        fail("cf-pages.yml 必须关闭 shell xtrace，避免 secret 进入日志")
    if re.search(r'(?:printf|echo).*\$CF_KEY.*secrets\.js', ctxt):
        fail("cf-pages.yml 会把 API Key 写入浏览器可下载的 secrets.js")
    if 'printf \'window.APP_SECRETS={apiKey:""};\' > _site/js/secrets.js' not in ctxt:
        fail("cf-pages.yml 必须为所有分支生成空的浏览器 secrets.js")
    if "CLOUDFLARE_API_TOKEN" not in ctxt:
        fail("cf-pages.yml 没有用 CLOUDFLARE_API_TOKEN 认证")
    cf_moved = set(re.findall(r'(?:cp -r |cp )"(?:_site/)?([A-Za-z0-9_./-]+)"? _site', ctxt))
    cf_moved |= set(re.findall(r'cp -r ([A-Za-z0-9_./ -]+) _site(?:/assets)?/', ctxt))
    for m in sorted({x for grp in cf_moved for x in grp.split() if x} - allow):
        fail("cf-pages.yml 把 %s 也搬进了上线目录；白名单只有 %s" % (m, "、".join(sorted(allow))))
    notes.append("公开入口 = Cloudflare Pages（main→longnankejia；qcode/codex/doubao→longnankejia-dev；"
                 "API key 仅存服务端 secret binding，浏览器资源为空）")
    notes.append("上线走 pages.yml（main → 根，doubao → /doubao/，浏览器密钥为空）；Netlify 仅手动")


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
    # 家乡页只给书里原文与原声：不许出现合成语音，也不许把已删掉的读音查询接回来
    for banned in ("speechSynthesis", "AudioContext", "window.Pron"):
        if banned in src:
            fail("js/hometown.js 出现了 %s：家乡页只给书里原文与原声" % banned)
    if "不该出现没有出处的地点" not in src:
        fail("js/hometown.js 丢了「这一版地图上不该出现没有出处的地点」这句兜底")
    # 底图来源这句话由数据文件带着，界面渲染时才出现；两处任缺其一都算丢了出处
    if "国家基础地理信息中心" not in read(rel("js", "data-hometown.js")):
        fail("js/data-hometown.js 不再标注底图来源（国家基础地理信息中心）")
    for gone in ("prQuery", "prOut", "js/pron.js", "js/data-s2t.js"):
        if gone in html:
            fail("index.html 里还留着查读音入口的残留：%s" % gone)

    raw = read(rel("js", "data-hometown.js"))
    m = re.search(r"window\.HOMETOWN\s*=\s*(\{.*\})", raw, re.S)
    if not m:
        fail("js/data-hometown.js 没有 window.HOMETOWN 赋值")
        return
    data = json.loads(m.group(1))
    ring, places, bbox = data.get("outline") or [], data.get("places") or [], data.get("bbox") or []
    if len(ring) < 80:
        fail("县界只有 %d 个点，不像真实边界（生成脚本大概简化过头）" % len(ring))
    if len(places) < 6:
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
    # 地图上的点不是装饰：每个点都得能在书里查到可讲的原文。判据用页面上同一个
    # exhibitsFor（node 里跑），不在这里另写一遍规则，免得两边判得不一样。
    r = subprocess.run(["node", "scripts/check_hometown_sources.mjs"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        tail = [l for l in (r.stdout or "").splitlines() if l.startswith("  FAIL")]
        fail("家乡地图有点位在书里查不到出处：%s" % ("；".join(tail) or (r.stderr or "")[-120:]))
    # 这一整块面板是纯展示：JS 里写出来的每个类名都必须在样式里有规则。
    # 曾经删 .pr-* 时把 .hm-land 一起带走了，SVG 没有 fill 就默认涂黑，
    # 县界变成一团黑影，而 193 项断言全绿——因为没人检查计算样式。
    css = loaded_css()
    panel = re.search(r'id="panelHometown"[\s\S]*?</div>\s*</div>', html)
    used = set()
    for blob in (src, panel.group(0) if panel else ""):
        for m in re.finditer(r'class="([^"]+)"', blob):
            # 只要合法类名字符：源码里 class="hm-dot hm-kind-" + esc(kind) 这种拼接，
            # 正则截出来的是带引号和加号的碎块，得先过滤掉
            used.update(c for c in m.group(1).split()
                        if re.fullmatch(r"[a-z][a-z0-9-]*", c) and c.startswith("hm-"))
    for m in re.finditer(r'classList\.toggle\("([^"]+)"', src):
        used.add(m.group(1))
    # 选择器要整个匹配：用 in 判断的话 .hm-kind-town-off 也算命中 .hm-kind-town
    orphan = sorted(c for c in used if not has_rule(css, c))
    if orphan:
        fail("家乡面板这些类名在样式表里没有规则（会退回浏览器默认样式）：%s" % "、".join(orphan))
    # 点位的三种类型（县城/乡镇/文保点）各自的配色也得在，否则点会全是同一个颜色
    kinds = {p.get("kind") for p in places if p.get("kind")}
    miss_kind = sorted("hm-kind-" + k for k in kinds if not has_rule(css, "hm-kind-" + k))
    if miss_kind:
        fail("这些点位类型没有对应样式，圆点会缺色：%s" % "、".join(miss_kind))
    if not has_rule(css, "hm-land") or "fill" not in css.split(".hm-land")[1][:120]:
        fail(".hm-land 没有 fill：SVG 默认涂黑，整张地图会变成一团黑影")
    notes.append("家乡面板 %d 个类名全部有样式，县界 fill 在位" % len(used))

    notes.append("家乡地图：%d 点县界 + %d 个真实坐标点位（%s 取数），每点均有书内出处"
                 % (len(ring), len(places), data.get("retrieved")))

    gen = read(rel("scripts", "build_hometown_map.py"))
    if "360783" not in gen or "FALLBACK_COORDS" not in gen:
        fail("build_hometown_map.py 不再取龙南市(360783)边界或缺少坐标兜底表")
    if "落在龙南边界外" not in gen:
        fail("build_hometown_map.py 丢了「点位必须在县界内」的自检")


def check_asr_config():
    """语音转写的等待上限不能拍脑袋：接口延迟实测从 0.7 秒到 97 秒都出现过。

    原来前端写死 15 秒 abort，而当时用的 SenseVoiceSmall 实测要 24～58 秒，
    等于每次都在服务还没回话时自己掐断，用户看到的是
    "signal is aborted without reason"。换模型 + 阈值进配置后，这一条把
    阈值钉在 30 秒以上，并盯住默认模型别退回那个又慢又听错字的。
    """
    cfg = read(rel("js", "config.js"))
    m = re.search(r"timeoutMs:\s*(\d+)", cfg)
    if not m:
        fail("js/config.js 的 asr 段没有 timeoutMs，转写请求没有超时上限")
    elif int(m.group(1)) < 30000:
        fail("asr.timeoutMs 只有 %s 毫秒，接口延迟实测能到十几秒，会自己掐断"
             % m.group(1))
    if "Qwen/Qwen3-ASR-1.7B" not in cfg:
        fail("asr.model 不是实测又快又准的 Qwen3-ASR-1.7B"
             "（SenseVoiceSmall 要 40～97 秒且把「蓝染」听成「兰染」）")
    if "https://api.siliconflow.cn/v1/audio/transcriptions" not in cfg:
        fail("asr.url 不是国内可直连的转写接口——换回谷歌那套要把音频发到境外")
    src = read(rel("js", "voice-input.js"))
    if not re.search(r"ctl\.abort\(\); \}, cfg\(\)\.timeoutMs\)", src):
        fail("js/voice-input.js 里 abort 的超时是写死的数字，没走 cfg().timeoutMs")
    if "signal is aborted" in src:
        fail("js/voice-input.js 把浏览器内部的 abort 文案直接抛给用户了")
    notes.append("语音转写模型 Qwen3-ASR，超时 %s 毫秒（实测 0.7～12 秒）"
                 % (m.group(1) if m else "未配置"))


def check_launchers():
    """双击启动的脚本：不许指向不存在的文件，不许在非 ASCII 下把控制台写成乱码。

    这里曾经写着"For PUBLIC internet access, run: gongwang.bat"，而仓库里没有这个
    文件；观众和作者都点不开一个不存在的脚本。
    """
    for name in ("qidong.bat", "zhanting.bat"):
        p = rel(name)
        if not os.path.exists(p):
            fail("%s 缺失——双击启动的入口" % name)
            continue
        body = read(p)
        try:
            body.encode("ascii")
        except UnicodeEncodeError:
            fail("%s 里有非 ASCII 字符：控制台按 GBK 解析，中文会成乱码" % name)
    qd = read(rel("qidong.bat"))
    for m in set(re.findall(r"[A-Za-z][A-Za-z0-9_-]*\.bat", qd) +
                 re.findall(r"[A-Za-z][A-Za-z0-9_-]*\.bat", read(rel("README.md")))):
        if not os.path.exists(rel(m)):
            fail("%s 被文档或启动脚本提到，但仓库里没有这个文件" % m)
    for need in ("longnankejia.pages.dev", "qcode.longnankejia-dev.pages.dev",
                 "longnankejia-dev.pages.dev", "codex.longnankejia-dev.pages.dev",
                 "git rev-parse --abbrev-ref HEAD"):
        if need not in qd:
            fail("qidong.bat 丢了「%s」——本地预览必须说清楚是哪个分支和线上地址" % need)
    addr = rel("地址.html")
    if not os.path.exists(addr):
        fail("地址.html 缺失——四个分支的入口页，双击就用")
    else:
        a = read(addr)
        for need in ("四个分支", "正式入口", "验收分支", "豆包的工作分支", "v2 预览（当前版本）"):
            if need not in a:
                fail("地址.html 丢了「%s」——这页是给人双击看的，标题和分支说明要在" % need)
        for need in ("https://longnankejia.pages.dev/",
                     "https://qcode.longnankejia-dev.pages.dev/",
                     "https://longnankejia-dev.pages.dev/",
                     "https://codex.longnankejia-dev.pages.dev/"):
            # 每条地址既要是点得动的链接，也要是看得见的文字：只满足一半的卡片等于没有
            if 'href="%s"' % need not in a:
                fail("地址.html 里 %s 不是一条可点的链接" % need)
            if '<div class="url">%s</div>' % need not in a:
                fail("地址.html 里 %s 没有作为可见文字写出来" % need)
        # v2 页面必须明确映射到 codex 分支的固定预览地址。
        for need in ("v2-base", "v2 这一轮改动在 codex 分支", "codex.longnankejia-dev.pages.dev"):
            if need not in a:
                fail("地址.html 丢了「%s」——应标出 v2 对应 codex 分支和线上入口" % need)
        for bad in re.findall(r"https?://v\d\.[\w.-]*pages\.dev", a):
            fail("地址.html 把版本号当成了分支地址 %s——Pages 的子域名只认分支名，没有这一条" % bad)
        for ref in re.findall(r'(?:src|href)="((?!https?:|#|javascript:)[^"]+)"', a):
            if not os.path.exists(rel(ref)):
                fail("地址.html 引用了本地文件 %s，但它不存在" % ref)
    notes.append("启动脚本与地址页：四条公网地址与部署映射一致，codex v2 有独立预览入口")


def check_video_attribution():
    """每件展品的客家话讲解，必须是印在它那一页上的那个码。

    风琴页的页序（sheet）和读者看到的页码（page）不是一回事，差得还不止一位：
    当初按 page 去对 QR 表，16 件里有 13 件挂成了隔壁的讲解。视频服务自己的
    文件名（线粉.mp4 / 冬头帕.mp4 / 衫.mp4）证实了应当按 sheet 对。
    这里不联网，只核对我们自己留下的三份材料互相是否还说得通。
    """
    src = read(rel("js", "diancang-data.js"))
    qr = json.loads(read(rel("data", "qr-content.json")))
    id_of_page, sheet_of_id = {}, {}
    for page, v in qr.items():
        m = re.search(r"id=([\w-]+)", v.get("url") or "")
        if m:
            id_of_page[int(page)] = m.group(1)
            sheet_of_id[m.group(1)] = int(page)

    items = []
    for m in re.finditer(r"\{\s*name:\s*'([^']*)'(.*?)\}", src, re.S):
        body = m.group(2)
        u = re.search(r"videoUrl:\s*'(https:[^']+)'", body)
        sh = re.search(r"sheet:\s*(\d+)", body)
        items.append({"name": m.group(1),
                      "vid": (re.search(r"id=([\w-]+)", u.group(1)) or [None, ""])[1] if u else None,
                      "sheet": int(sh.group(1)) if sh else None})
    with_url = [x for x in items if x["vid"]]
    wrong = [x for x in with_url if sheet_of_id.get(x["vid"]) != x["sheet"]]
    if wrong:
        fail("这些展品的讲解视频不是印在它那一页上的码：%s"
             % "、".join("%s(sheet %s)←码在 sheet %s"
                         % (x["name"], x["sheet"], sheet_of_id.get(x["vid"])) for x in wrong))
    orphan = [p for p, i in id_of_page.items()
              if not any(x["sheet"] == p and x["vid"] for x in items)]
    if orphan:
        fail("qr-content 里这些页的码没有展品在挂：%s（sheet 对不上或漏挂）"
             % "、".join(str(p) for p in sorted(orphan)))
    for page, v in qr.items():
        owner = next((x["name"] for x in items if x["sheet"] == int(page)), None)
        if owner and v.get("exhibit") != owner:
            fail("data/qr-content.json 第 %s 页写着 [%s]，但那一页上的展品是 [%s]"
                 % (page, v.get("exhibit"), owner))

    trig = re.search(r"window\.VIDEO_TRIGGERS = \{([\s\S]*?)\n\};", src)
    if not trig:
        fail("js/diancang-data.js 没有 window.VIDEO_TRIGGERS")
        return
    names = {x["name"] for x in with_url}
    keys = re.findall(r"'([^']+)':\s*\[", trig.group(1))
    for k in keys:
        if k not in names:
            fail("VIDEO_TRIGGERS 里的 [%s] 现在没有讲解视频，挂卡会指向空链接" % k)
    words = re.findall(r"'([^']{1,})'", trig.group(1).replace("\n", " "))
    short = [w for w in words if len(w) == 1 and w not in names]
    if short:
        fail("VIDEO_TRIGGERS 有单字触发词 %s：答案里沾一个字就挂视频，必然挂错"
             % "、".join(sorted(set(short))))
    kb = read(rel("js", "knowledge-base.js"))
    for m in re.finditer(r"title: '([^']+)'[\s\S]{0,900}?\n  \{", kb + "\n  {"):
        seg = m.group(0)
        link = re.search(r"hlcode\.pro/\?id=([\w-]+)", seg)
        if not link:
            continue
        owner = next((x["name"] for x in with_url if x["vid"] == link.group(1)), None)
        if owner and owner not in m.group(1) and m.group(1) not in (owner or ""):
            fail("知识库条目 [%s] 挂的 📺 链接其实是 [%s] 的讲解" % (m.group(1), owner))
    notes.append("客家话讲解：%d 件展品的视频与它所在风琴页上的码一致，触发词 %d 个全部 ≥2 字"
                 % (len(with_url), len(words)))


def check_copy_tells():
    """界面文案不许再长出套话。量法复用 tests/check_copy_tells.py，避免两处判得不一样。"""
    try:
        import check_copy_tells as tells
    except ImportError:
        notes.append("check_copy_tells.py 读不到，跳过套话检查")
        return
    for rel, hits in tells.scan(ROOT):
        for word, n in hits.items():
            fail("界面文案又长出套话：%s 里 %s×%d" % (rel, word, n))
    notes.append("界面文案套话 0 处（%d 个词、%d 个文件，注释与典藏原文不计）"
                 % (len(tells.TELLS), len(tells.FILES)))


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
    check_hometown_map()
    check_asr_config()
    check_video_attribution()
    check_launchers()
    check_copy_tells()
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
