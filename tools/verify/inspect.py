#!/usr/bin/env python3
"""Art inspector: rasterize every catalog sprite and check the
invariants (INVARIANTS.md). Exit 1 on any failure.

Usage: python3 tools/verify/inspect.py [--freeze]   # --freeze writes
goldens instead of comparing.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from decode import decode

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ASSETS = os.path.join(ROOT, 'assets')
GOLDEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'golden')
LANE_W = 11.5


def svgs():
    return sorted(f for f in os.listdir(ASSETS) if f.endswith('.svg') and f[0].isupper())


def rasterize(fname):
    out = os.path.join('/tmp', 'm4wd_inspect', fname + '.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rasterize.cjs'),
                    os.path.join(ASSETS, fname), out], capture_output=True, check=True)
    return out


def line_centers(path, x):
    """sub-pixel centers of dark vertical runs at column x"""
    W, H, ch, buf = decode(path)
    out, y = [], 0
    while y < H:
        o = (y * W + x) * ch
        if buf[o + 3] > 120 and sum(buf[o:o + 3]) / 3 < 175:
            acc = cnt = 0
            while y < H:
                o = (y * W + x) * ch
                if buf[o + 3] > 120 and sum(buf[o:o + 3]) / 3 < 175:
                    acc += y * buf[o + 3]
                    cnt += buf[o + 3]
                    y += 1
                else:
                    break
            out.append(acc / cnt - H / 2)
        else:
            y += 1
    return out


def ink_bounds(path):
    W, H, ch, buf = decode(path)
    ys = [y - H / 2 for y in range(H) if any(buf[(y * W + x) * ch + 3] > 150 for x in range(W))]
    return (min(ys), max(ys)) if ys else (0, 0)


def check_lanes(fname, png, failures):
    """lane gaps on the regulation grid where the road is flat-ish"""
    W, H, ch, buf = decode(png)
    for x in (int(W * 0.08), int(W * 0.92)):
        cs = line_centers(png, x)
        gaps = [b - a for a, b in zip(cs, cs[1:])]
        for g in gaps:
            if 5 < g < 20 and abs(g - LANE_W) > 1.2 and abs(g - 2 * LANE_W) > 1.2:
                failures.append(f'{fname}: lane gap {g:.2f} at x={x}')


def check_silhouette(fname, png, failures):
    t, b = ink_bounds(png)
    W, H, ch, buf = decode(png)
    if t < -H / 2 - 0.6 or b > H / 2 - 0.4 + 0.6:
        failures.append(f'{fname}: ink outside canvas ({t:.1f}..{b:.1f} vs +/-{H/2:.0f})')


def compare_golden(fname, png, failures):
    gold = os.path.join(GOLDEN, fname + '.png')
    if not os.path.exists(gold):
        failures.append(f'{fname}: no golden')
        return
    W, H, ch, a = decode(png)
    W2, H2, ch2, g = decode(gold)
    if (W, H) != (W2, H2):
        failures.append(f'{fname}: golden size mismatch')
        return
    diff = 0
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            o1, o2 = (y * W + x) * ch, (y * W + x) * ch2
            l1 = sum(a[o1:o1 + 3]) / 3 if a[o1 + 3] > 60 else 255
            l2 = sum(g[o2:o2 + 3]) / 3 if g[o2 + 3] > 60 else 255
            if abs(l1 - l2) > 60:
                diff += 1
    if diff > (W // 2) * (H // 2) * 0.02:
        failures.append(f'{fname}: golden diff {diff} px')


def main():
    freeze = '--freeze' in sys.argv
    failures = []
    for f in svgs():
        png = rasterize(f)
        if freeze:
            os.makedirs(GOLDEN, exist_ok=True)
            subprocess.run(['cp', png, os.path.join(GOLDEN, f + '.png')], check=True)
            continue
        # lane-gap arithmetic only where the road is flat and undecorated:
        # arcs, humps, weaves, slopes with markings, and variant colors all
        # read as runs — the golden diff covers them. Rainbow-lane variants
        # have intentional non-11.5 color bands; Str2's checker band reads
        # as runs at the 92% column.
        if f.startswith(('Str', 'Ban')) and f != 'Str2.0.svg' and not f.endswith(('1.svg', '2.svg', '5.svg')):
            check_lanes(f, png, failures)
        check_silhouette(f, png, failures)
        compare_golden(f, png, failures)
    if freeze:
        print(f'froze {len(svgs())} goldens')
        return 0
    for f in failures:
        print('FAIL', f)
    print(f'{len(svgs())} sprites checked, {len(failures)} failures')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
