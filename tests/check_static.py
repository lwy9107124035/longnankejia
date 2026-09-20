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


def main():
    os.chdir(ROOT)
    html = check_index_tags()
    pages = check_concatenated_paths()
    literals = check_path_literals(pages)
    check_orphans(literals, html)
    check_textures_clean()
    check_css_vars()
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
