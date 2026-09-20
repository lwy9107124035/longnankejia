"""Find printed QR codes in the 典藏 page scans by their finder patterns.

cv2.QRCodeDetector is unusable here: detect() fires on photo rectangles (it flagged a
chapter title page that has no code), and detectAndDecode() misses the app's own
rendered code. Both fail because a scanned code is small and degraded.

A QR always carries three concentric square rings, so every horizontal or vertical
scanline through a finder pattern crosses five bands in a 1:1:3:1:1 dark-light-dark-
light-dark ratio. That geometry survives printing, scaling and JPEG noise, so it is a
far steadier signal than decoding.
"""
import numpy as np
import cv2
import os
import sys

RATIOS = np.array([1, 1, 3, 1, 1], dtype=np.float64)


def _runs(line):
    """Return (start, length, is_dark) for each run-length segment of a binary line."""
    if line.size == 0:
        return []
    change = np.flatnonzero(np.diff(line)) + 1
    starts = np.concatenate(([0], change))
    ends = np.concatenate((change, [line.size]))
    return [(int(s), int(e - s), bool(line[s])) for s, e in zip(starts, ends)]


def _ratio_ok(lengths):
    total = sum(lengths)
    if total < 21:
        return False
    unit = total / 7.0
    tol = max(1.0, unit * 0.6)
    return all(abs(l - u * unit) <= tol for l, u in zip(lengths, RATIOS))


def _finder_along(runs):
    """First 1:1:3:1:1 dark-led crossing in a run-length list, or None.

    Returns (centre_offset_from_start, module_unit) so callers can locate the crossing.
    """
    for i in range(len(runs) - 4):
        seg = runs[i:i + 5]
        if not seg[0][2]:
            continue
        lengths = [s[1] for s in seg]
        if _ratio_ok(lengths):
            centre = lengths[0] + lengths[1] + lengths[2] / 2.0
            start = sum(r[1] for r in runs[:i])
            return start + centre, sum(lengths) / 7.0
    return None


def find_finder_patterns(gray, sample_step=2):
    """Locate finder-pattern centres: (cx, cy, module_size) tuples."""
    h, w = gray.shape
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dark = binary < 128
    candidates = []

    for y in range(0, h, sample_step):
        runs = _runs(dark[y])
        hit = _finder_along(runs)
        if not hit:
            continue
        centre_x, unit = hit
        cx = int(centre_x)
        if cx <= 0 or cx >= w:
            continue
        # confirm the same ratio crossing vertically through that point
        col_runs = _runs(dark[:, cx])
        if _finder_along(col_runs):
            candidates.append((cx, y, unit))

    # merge hits that belong to the same corner
    kept = []
    used = np.zeros(len(candidates), bool)
    for i, (cx, cy, u) in enumerate(candidates):
        if used[i]:
            continue
        gx, gy, us = [cx], [cy], [u]
        used[i] = True
        for j in range(i + 1, len(candidates)):
            if used[j]:
                continue
            if abs(candidates[j][0] - cx) < 8 * u and abs(candidates[j][1] - cy) < 8 * u:
                gx.append(candidates[j][0])
                gy.append(candidates[j][1])
                us.append(candidates[j][2])
                used[j] = True
        kept.append((int(np.mean(gx)), int(np.mean(gy)), float(np.median(us))))
    return kept


def qr_regions(path):
    """Bounding boxes of images that show a QR code, or [] when there is none."""
    gray = cv2.cvtColor(cv2.imread(str(path), cv2.IMREAD_COLOR), cv2.COLOR_BGR2GRAY)
    corners = find_finder_patterns(gray)
    if len(corners) < 3:
        return []
    # three finder corners that sit within a couple of symbol widths of each other
    width = np.median([c[2] for c in corners]) * 4
    groups = []
    for cx, cy, u in corners:
        placed = False
        for g in groups:
            if any(abs(cx - o[0]) < 3.5 * width and abs(cy - o[1]) < 3.5 * width for o in g):
                g.append((cx, cy))
                placed = True
                break
        if not placed:
            groups.append([(cx, cy)])
    out = []
    for g in groups:
        if len(g) < 3:
            continue
        xs = [o[0] for o in g]
        ys = [o[1] for o in g]
        span = max(max(xs) - min(xs), max(ys) - min(ys))
        out.append((min(xs) - span * 0.15, min(ys) - span * 0.15,
                    max(xs) + span * 0.15, max(ys) + span * 0.15))
    return out


def main():
    targets = sys.argv[1:] or ["assets/pdf-imgs"]
    files = []
    for t in targets:
        if os.path.isdir(t):
            files += [os.path.join(t, f) for f in sorted(os.listdir(t)) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        else:
            files.append(t)
    total = 0
    for f in files:
        regions = qr_regions(f)
        if regions:
            total += 1
            print("QR  %s  %d region(s): %s" % (f, len(regions),
                  ["(%d,%d,%d,%d)" % tuple(int(v) for v in r) for r in regions]))
    print("\n%d / %d images contain a QR code." % (total, len(files)))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
