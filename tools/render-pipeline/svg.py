#!/usr/bin/env python3
"""SVG sprite emitter — the full catalog in the original illustrated style.

Palette sampled from the original Tamiya PNGs: light warm-gray bed,
dark outline, dark-gray lane dashes/chevrons (white was invisible on
the light bed); variants recolor the rails (VARIANT_COLORS), banks use
their own per-family palettes sampled from their rips. Shape logic is a port of art.js
(which encoded every kind's geometry as canvas fallback): rects for
straight-family kinds, annular sectors for corner/hairpin (geometry
from solveGeo via the node dump), with kind-specific markings.

Output: <Name>.<color>.svg per (piece, variant) + shared-family files
for rucdoc sprite: entries. viewBox in cm (1 unit = 1 cm), explicit
width/height for canvas drawImage.

The original PNGs stay in assets/ untouched (provenance); the loader
prefers these redraws. Derived from the MIT-licensed original editor's
artwork (see src/main.js header).
"""
import json, math, os, subprocess, sys

from riptrace import traced_body

BED = '#efeae5'
DASH = '#8a8683'   # dark gray separators — white was invisible on the light bed
OUTLINE = '#5d5a57'
CHEVRON = '#8a8683'
# bank palettes sampled from the original rips (their own palettes, not
# VARIANT_COLORS); keyed per family — Ban2's single tan variant is NOT
# Ban1's green c0
BED_FILL = BED      # whole-piece fallback (bed or gradient url)
LANE_FILLS = None   # per-lane: '#rrggbb' | ('url', gid, stops) | None
BED_DEFS = ""       # accumulated gradient defs


def _near(c, t, tol=48):
    return abs(c[0]-t[0])+abs(c[1]-t[1])+abs(c[2]-t[2]) < tol


def _px(buf, W, H, ch, x, y):
    if not (0 <= x < W and 0 <= y < H):
        return None
    o = (y*W+x)*ch
    if buf[o+3] <= 200:
        return None
    return (buf[o], buf[o+1], buf[o+2])


def _lane_samples(rip, w, h, lanes, vy):
    """colors per lane at start/mid/end; None where only bed/lines"""
    pw, ph, pch, pbuf = _decode_png(rip)
    OUT, DSH, BD = (93,90,87), (138,134,131), (239,234,229)
    res = []
    for i in range(lanes):
        yc = vy - (LANE_W*lanes)/2 + LANE_W*(i+0.5)
        y = int(round(yc + ph/2))
        st = []
        for fx in (0.06, 0.5, 0.94):
            x = int(pw*fx)
            from collections import Counter
            cs = Counter()
            for dy in (-1,0,1):
                for dx in (-1,0,1):
                    c = _px(pbuf, pw, ph, pch, x+dx, y+dy)
                    if c and not _near(c, OUT) and not _near(c, DSH) and not _near(c, BD, 60) and (max(c) - min(c) > 40 or min(c) > 225):
                        cs[(c[0]//16*16, c[1]//16*16, c[2]//16*16)] += 1
            st.append(cs.most_common(1)[0][0] if cs else None)
        res.append(st)
    return res


def _whole_stops(rip):
    """dominant color at 3 stations across the whole rip (fallback)"""
    pw, ph, pch, pbuf = _decode_png(rip)
    OUT, DSH, BD = (93,90,87), (138,134,131), (239,234,229)
    from collections import Counter
    stops = []
    for fx in (0.06, 0.5, 0.94):
        x = int(pw*fx)
        cs = Counter()
        for y in range(2, ph-2):
            c = _px(pbuf, pw, ph, pch, x, y)
            if c and not _near(c, OUT) and not _near(c, DSH) and not _near(c, BD, 60) and (max(c) - min(c) > 40 or min(c) > 225):
                cs[(c[0]//16*16, c[1]//16*16, c[2]//16*16)] += 1
        best, n = (cs.most_common(1)[0][0], cs.most_common(1)[0] and 1) if cs else (None, 0)
        n = cs[best] if best else 0
        stops.append(best if n >= 6 else None)
    return stops


def _hex(c):
    return '#%02x%02x%02x' % (min(c[0]+8, 255), min(c[1]+8, 255), min(c[2]+8, 255))


def _grad_def(gid, stops):
    return ('<defs><linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" '
            'x1="{X1}" y1="0" x2="{X2}" y2="0" spreadMethod="pad">'
            + ''.join(f'<stop offset="{o:.2f}" stop-color="{_hex(c)}"/>'
                      for o, c in zip((0, 0.5, 1), stops))
            + '</linearGradient></defs>')


BANK_COLORS = {
  'Ban1': ['#2e966f', '#c0bcb8', '#004282', '#9a0400'],
  'Ban2': ['#dabc90'],
}

def _decode_png(path):
    import struct as _st, zlib as _zl
    data = open(path, 'rb').read()
    pos, idat, w, h, ch = 8, b'', 0, 0, 3
    while pos < len(data):
        ln, typ = _st.unpack('>I4s', data[pos:pos + 8]); pos += 8
        chunk = data[pos:pos + ln]; pos += ln + 4
        if typ == b'IHDR':
            w, h, bd, ct = _st.unpack('>IIBB', chunk[:10]); ch = {2: 3, 6: 4}.get(ct)
        elif typ == b'IDAT': idat += chunk
        elif typ == b'IEND': break
    raw = _zl.decompress(idat); stride = w * ch
    out = bytearray(w * h * ch); prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]; line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0; b = prev[x]; c = prev[x - ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[y * stride:(y + 1) * stride] = line; prev = line
    return w, h, ch, out


def _set_overrides(rip, fname, defn):
    """sample the rip and set BED_FILL / LANE_FILLS / BED_DEFS"""
    global BED_FILL, LANE_FILLS, BED_DEFS
    BED_FILL, LANE_FILLS = BED, None
    lanes = defn.get('lanes', 1)
    vy = defn['verts'][0][1] if defn.get('verts') else 0
    if defn['kind'] in ('corner', 'hairpin'):
        vy = 0  # arc pieces: sample lane bands by radius later; whole for now
    lanesamp = _lane_samples(rip, defn['w'], defn['h'], lanes, vy) if defn['kind'] not in ('corner','hairpin') else None
    gid_n = [0]
    def mkgrad(stops):
        global BED_DEFS
        gid_n[0] += 1
        gid = 'g_%s_%d' % (fname.replace('.','_').replace('-','_'), gid_n[0])
        BED_DEFS += _grad_def(gid, stops)
        return f'url(#{gid})'

    fills = []
    any_lane = False
    if lanesamp:
        for st in lanesamp:
            real = [c for c in st if c]
            if not real:
                fills.append(None); continue
            any_lane = True
            if len(set(real)) == 1:
                fills.append(_hex(real[0]))
            else:
                base = real[0]
                fills.append(mkgrad([c if c else base for c in st]))
    if any_lane:
        LANE_FILLS = fills
        # whole-piece fallback from lane 0
        st = lanesamp[0]
        real = [c for c in st if c]
        if real:
            if len(set(real)) == 1:
                BED_FILL = _hex(real[0])
            else:
                base = real[0]
                BED_FILL = mkgrad([c if c else base for c in st])
        return
    # fallback: whole-rip dominant (rails/blocks — banks, Str1.3 style)
    stops = _whole_stops(rip)
    real = [c for c in stops if c]
    if real:
        if len(set(real)) == 1:
            BED_FILL = _hex(real[0])
        else:
            base = real[0]
            BED_FILL = mkgrad([c if c else base for c in stops])


LANE_W = 11.5   # regulation Tamiya lane width (115 mm); boundaries
               # sit at +/-(n*LANE_W)/2 + i*LANE_W, centered in the
               # footprint so every piece's lanes align at seams
BANK_GRAY = '#c0bcb8'   # Bri2's ramp-face midtone (same swatch as Ban1 c1)
BANK_COLORS = {
  'Ban1': ['#2e966f', '#c0bcb8', '#004282', '#9a0400'],
  'Ban2': ['#dabc90'],
}


def rr(x, y, w, h, r, **kw):
    fill = kw.get('fill', BED)
    stroke = kw.get('stroke', OUTLINE)
    sw = kw.get('stroke_width', 0.8)
    return f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{min(r, w/2, h/2):.2f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def line(x1, y1, x2, y2, color=DASH, w=0.7, dash='2.4,1.8'):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{color}" stroke-width="{w}"{d}/>'


def chevron(x, y, h, dx=2.2, color=CHEVRON, w=0.9):
    return f'<path d="M {x:.2f} {y-h/2:.2f} L {x+dx:.2f} {y:.2f} L {x:.2f} {y+h/2:.2f}" fill="none" stroke="{color}" stroke-width="{w}"/>'


def rect_family(defn, rail):
    """straight/start/slope — Bri2.0's vocabulary: per-lane closed
    stroked rectangles (1.2, miter joins) on the regulation grid over
    one bed fill. No rails, dashes, or chevrons; the start checker
    stays as a marking on top. (jump/wave route to their own art;
    bank keeps its solid block.)"""
    w, h, lanes = defn['w'], defn['h'], defn.get('lanes', 1)
    half = LANE_W * lanes / 2
    parts = []
    if defn['kind'] == 'wave':
        # Chicane = Bri2.0's vocabulary riding the confirmed hump:
        # closed stroked lane rectangles (1.2, miter joins) on the
        # regulation grid, per-lane bed fills, nothing else. The
        # centerline runs through the verts (+vy flat, -vy mid) so
        # joints align with the straights.
        band = LANE_W * lanes
        vy = defn['verts'][0][1]
        if defn['verts'][1][1] != vy or vy + band / 2 + 0.6 > h / 2:
            raise ValueError(f'{defn.get("label", "wave")}: hump does not fit')
        n = int(round(w))
        xs = [-w / 2 + w * i / n for i in range(n + 1)]

        def c(x):
            t = (x + w / 2) / w
            return vy * (2 * math.cos(math.pi * t) ** 2 - 1)

        def lane_path(i):
            top = lambda x: c(x) - band / 2 + LANE_W * i
            d = ' '.join(f'{"M" if k == 0 else "L"} {xs[k]:.2f} {top(xs[k]):.2f}' for k in range(n + 1))
            d += ' ' + ' '.join(f'L {x:.2f} {top(x) + LANE_W:.2f}' for x in reversed(xs))
            return d + ' Z'

        # bed: whole humped band
        bed = ' '.join(f'{"M" if k == 0 else "L"} {xs[k]:.2f} {c(xs[k]) - band / 2:.2f}' for k in range(n + 1))
        bed += ' ' + ' '.join(f'L {x:.2f} {c(x) + band / 2:.2f}' for x in reversed(xs))
        for i in range(lanes):
            fill = (LANE_FILLS[i] if LANE_FILLS and i < len(LANE_FILLS) and LANE_FILLS[i] else BED_FILL)
            parts.append(f'<path d="{lane_path(i)}" fill="{fill}" stroke="{OUTLINE}" stroke-width="1.2"/>')
        return parts

    for i in range(lanes):
        y0 = -half + LANE_W * i
        fill = (LANE_FILLS[i] if LANE_FILLS and i < len(LANE_FILLS) and LANE_FILLS[i] else BED_FILL)
        parts.append(f'<path d="M {-w/2:.2f} {y0:.2f} H {w/2:.2f} V {y0 + LANE_W:.2f} H {-w/2:.2f} Z" '
                     f'fill="{fill}" stroke="{OUTLINE}" stroke-width="1.2"/>')
    if defn['kind'] == 'start':
        cell = LANE_W / 2
        rows = lanes * 2
        for r in range(rows):
            for c in range(2):
                if (r + c) % 2 == 0:
                    parts.append(f'<rect x="{-w/6 + c*cell:.2f}" y="{-half + r*cell:.2f}" width="{cell:.2f}" height="{cell:.2f}" fill="#ffffff"/>')
    return parts


def changer_art(defn):
    """Lan1 lane changer: the same weave Lan2 carries into its turn —
    the top two lanes step down one slot. The top of lane 1, the lane
    1/2 divider, and the bottom of lane 2 are IDENTICAL smooth S
    curves (one shape offset by one lane, chicane-style), so both
    lanes hold regulation width through the weave; the bottom lane
    bridges OVER them into the vacated top slot. The bed is a single
    path that traces the road's boundary exactly — wall runs, the
    weave S-curves, and the bridge's lower edge (split at the point
    where it crosses the lowest S) — so no fill escapes the lines.
    Section delineators are the vertical lines measured in the rip."""
    def s_cmd(x0, y0, x1, y1):
        dx = (x1 - x0) / 3
        return f'C {x0+dx:.1f} {y0:.1f} {x1-dx:.1f} {y1:.1f} {x1:.1f} {y1:.1f}'
    def b_cmd(x0, y0, x1, y1):
        """bridge edge: rounder than s_cmd — the controls stay at the
        endpoint levels but span 38% of the run each, so the flat ends
        hold longer and the middle climbs steeply"""
        dx = (x1 - x0) * 0.38
        return f'C {x0+dx:.1f} {y0:.1f} {x1-dx:.1f} {y1:.1f} {x1:.1f} {y1:.1f}'
    def stroke(d, color, width):
        return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
    def line2(pts, color, width):
        d = f'M {pts[0][0]:.1f} {pts[0][1]:.1f} ' + ' '.join(f'L {x:.1f} {y:.1f}' for x, y in pts[1:])
        return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="butt"/>'

    # the shared S-step, one regulation lane (LANE_W)
    X0, X1 = -22, 16
    def stepped(y):
        # .2f: the tail must land exactly on its level
        return f'M -81 {y:.2f} L {X0} {y:.2f} {s_cmd(X0, y, X1, y + LANE_W)} L 81 {y + LANE_W:.2f}'

    # split point where the bridge's lower edge crosses the lowest S;
    # de Casteljau halves keep the bed boundary on the exact curves
    def bez_split(p, t):
        p0, c1, c2, p3 = p
        f = lambda a, b: a + (b - a) * t
        m1 = (f(p0[0], c1[0]), f(p0[1], c1[1]))
        m2 = (f(c1[0], c2[0]), f(c1[1], c2[1]))
        m3 = (f(c2[0], p3[0]), f(c2[1], p3[1]))
        m4 = (f(m1[0], m2[0]), f(m1[1], m2[1]))
        m5 = (f(m2[0], m3[0]), f(m2[1], m3[1]))
        m6 = (f(m4[0], m5[0]), f(m4[1], m5[1]))
        return (p0, m1, m4, m6), (m6, m5, m3, p3)
    def at(p, t):
        w = ((1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3)
        return (sum(p[i][0] * w[i] for i in range(4)), sum(p[i][1] * w[i] for i in range(4)))
    sB = ((-22.0, 5.75), (-22 + 38 / 3, 5.75), (16 - 38 / 3, 17.25), (16.0, 17.25))
    bB = ((-43.5, 17.25), (-43.5 + 0.38 * 86, 17.25), (42.5 - 0.38 * 86, -5.75), (42.5, -5.75))
    # true intersection: curves cross at DIFFERENT parameters — scan ts,
    # solve bB's parameter for matching x, watch the y difference
    # change sign (crossing near (-8.4, 9.1))
    ts = tb = None
    prev = None
    for i in range(2001):
        ts_ = i / 2000
        ps = at(sB, ts_)
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if at(bB, mid)[0] < ps[0]: lo = mid
            else: hi = mid
        tb_ = (lo + hi) / 2
        d = ps[1] - at(bB, tb_)[1]
        if prev is not None and prev[2] * d <= 0:
            ts, tb = (prev[0] + ts_) / 2, (prev[1] + tb_) / 2
            break
        prev = (ts_, tb_, d)
    assert ts is not None, 'curves do not cross'
    _, sR = bez_split(sB, ts)      # crossing -> (16, 17.25)
    bL, _ = bez_split(bB, tb)      # (-43.5, 17.25) -> crossing
    def cseg_r(q):
        return f'C {q[2][0]:.2f} {q[2][1]:.2f} {q[1][0]:.2f} {q[1][1]:.2f} {q[0][0]:.2f} {q[0][1]:.2f}'
    # bed: one path tracing the road boundary exactly — top wall,
    # weave S down, settled line, bridge landing face, right edge,
    # bottom wall, lowest S back up to the crossing, bridge lower
    # edge back down to the wall, left edge
    bed = ('M -81 -17.25 '
           f'L {X0} -17.25 {s_cmd(X0, -17.25, X1, -5.75)} '
           'L 42.5 -5.75 L 42.5 -17.25 L 81 -17.25 '
           'L 81 17.25 L 16 17.25 '
           f'{cseg_r(sR)} '
           f'{cseg_r(bL)} '
           'L -81 17.25 Z')

    # z-order (owner-calibrated): bed, then the lane S-curves and the
    # under-bridge delineators (the band's end sections tuck over the
    # +5.75/-5.75 lines), then the dark band, and finally everything
    # that reads on top of it — the bridge's own edges, the walls, and
    # all remaining delineators. Lan1.0 and Lan1.1 emit identical art
    # by owner decision: rails render in the wall color, so the
    # variant color has no surface in this piece.
    parts = [
        f'<path d="{bed}" fill="{BED_FILL}"/>',
        f'<defs><linearGradient id="approach" gradientUnits="userSpaceOnUse" x1="-81" y1="0" x2="-44" y2="0">'
        f'<stop offset="0" stop-color="{BED}"/><stop offset="1" stop-color="{BANK_GRAY}"/></linearGradient>'
        f'<linearGradient id="exit" gradientUnits="userSpaceOnUse" x1="42.5" y1="0" x2="81" y2="0">'
        f'<stop offset="0" stop-color="{BANK_GRAY}"/><stop offset="1" stop-color="{BED}"/></linearGradient></defs>'
        f'<path d="M -81 5.75 H -44 V 17.25 H -81 Z" fill="url(#approach)"/>',
        f'<path d="M 42.5 -17.25 H 81 V -5.75 H 42.5 Z" fill="url(#exit)"/>',

        stroke(stepped(-17.25), OUTLINE, 1.2),
        stroke(stepped(-5.75), OUTLINE, 1.2),
        stroke(stepped(5.75), OUTLINE, 1.2),
        line2([(-27.5, -17.25), (-27.5, 5.75)], OUTLINE, 1.2),
        line2([(27, -5.75), (27, 17.25)], OUTLINE, 1.2),
        # bridge fill above the lane lines (its end sections tuck
        # the approach/exit gradients are lane-surface shading: under
        # every line, like the bed. The bridge band stays solid and
        # keeps its calibrated layer (above the lane lines, below its
        # edges/walls/delineators)
        f'<defs><linearGradient id="approach" gradientUnits="userSpaceOnUse" x1="-81" y1="0" x2="-44" y2="0">'
        f'<stop offset="0" stop-color="{BED}"/><stop offset="1" stop-color="{BANK_GRAY}"/></linearGradient>'
        f'<linearGradient id="exit" gradientUnits="userSpaceOnUse" x1="42.5" y1="0" x2="81" y2="0">'
        f'<stop offset="0" stop-color="{BANK_GRAY}"/><stop offset="1" stop-color="{BED}"/></linearGradient></defs>'
        f'<path d="M -44 5.75 {b_cmd(-44, 5.75, 42.5, -17.25)} L 42.5 -5.75 {b_cmd(42.5, -5.75, -43.5, 17.25)} Z" fill="{BANK_GRAY}"/>',
        stroke(f'M -44 5.75 {b_cmd(-44, 5.75, 42.5, -17.25)}', OUTLINE, 1.2),
        stroke(f'M -43.5 17.25 {b_cmd(-43.5, 17.25, 42.5, -5.75)}', OUTLINE, 1.2),
        line2([(42.5, -17.25), (81, -17.25)], OUTLINE, 1.2),
        line2([(-81, 17.25), (-43.5, 17.25)], OUTLINE, 1.2),
        line2([(15, 17.25), (81, 17.25)], OUTLINE, 1.2),
        line2([(42.5, -17.25), (42.5, -5.75)], OUTLINE, 1.2),
        line2([(-43.5, 5.75), (-43.5, 17.25)], OUTLINE, 1.2),
        # end rails, wall color
        rr(-81, -17.25, 1.2, 34.5, 0, fill=OUTLINE, stroke='none'),
        rr(79.8, -17.25, 1.2, 34.5, 0, fill=OUTLINE, stroke='none'),
    ]
    return parts


def bri2_art(defn):
    """Bri2.0 (jump): per owner, the entry straight of the Lan1 weave —
    the same lane rectangles, wall lines, and end rails — except the
    bottom lane runs shorter, ending on a vertical face at x=+15 with
    the corner beyond it cut transparent (measured on the rip)."""
    def line2(pts, color, width):
        d = f'M {pts[0][0]:.1f} {pts[0][1]:.1f} ' + ' '.join(f'L {x:.1f} {y:.1f}' for x, y in pts[1:])
        return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="butt"/>'
    parts = [
        # bed with the bottom-right corner cut (beyond the ramp face)
        # closed stroked rectangles: miter joins give crisp corners
        # (separate butt-capped lines left notches where they met).
        # Top and middle lanes run full width; the bottom lane is its
        # own rectangle ending on the face at x=+15 — shared divider
        # strokes double, same color.
        # bed: full width for the top two lanes, to the face for the
        # bottom — the cut corner stays transparent
        '<defs><linearGradient id="bri2ramp" gradientUnits="userSpaceOnUse" x1="-25" y1="0" x2="-7" y2="0">'
        '<stop offset="0" stop-color="' + BED + '"/><stop offset="1" stop-color="' + BANK_GRAY + '"/></linearGradient></defs>'
        # top two lanes: flat bed; the ramp lane carries the rip's
        # rise gradient (bed -> bank-gray, measured stops 2..20 cm
        # from the left edge, flat gray to the face)
        '<path d="M -27 -17.25 H 27 V 5.75 H -27 Z" fill="' + BED_FILL + '"/>',
        '<path d="M -27 5.75 H 15 V 17.25 H -27 Z" fill="url(#bri2ramp)"/>',
        '<path d="M -27 -17.25 H 27 V -5.75 H -27 Z" fill="none" stroke="' + OUTLINE + '" stroke-width="1.2"/>',
        '<path d="M -27 -5.75 H 27 V 5.75 H -27 Z" fill="none" stroke="' + OUTLINE + '" stroke-width="1.2"/>',
        '<path d="M -27 5.75 H 15 V 17.25 H -27 Z" fill="none" stroke="' + OUTLINE + '" stroke-width="1.2"/>',
        rr(-27, -17.25, 1.2, 34.5, 0, fill=OUTLINE, stroke='none'),
        rr(25.8, -17.25, 1.2, 23.0, 0, fill=OUTLINE, stroke='none'),
    ]
    return parts


def lan2_art(defn, rail):
    """Lan2 'Rainbow': an entry straight where the top two lanes step
    down one lane position, then a 180-degree sweep into the exit
    straight. The three boundaries — the top of lane 1, the lane 1/2
    divider, and the bottom of lane 2 — are IDENTICAL smooth S curves
    (one shape offset by one lane, chicane-style), so both lanes hold
    regulation width through the weave; the vacated top slot becomes
    the transparent notch. After the weave each boundary settles into
    its exact semicircle about (18,0) (r 59.75/48.25/36.75 on the
    11.5 grid; walls r 71.25/36.75) — the 180x144 canvas bounds the
    swept path (the -90 edge comes from the entry/exit straights). A gray delineator at
    x=-35.5 marks the sections in the rip."""
    def S(x0, y0, x1, y1):
        """flat-ended cubic: leaves and arrives horizontally"""
        dx = (x1 - x0) / 3
        return f'C {x0+dx:.1f} {y0:.1f} {x1-dx:.1f} {y1:.1f} {x1:.1f} {y1:.1f}'
    def stroke(d, color, width):
        return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
    def line2(pts, color, width):
        d = f'M {pts[0][0]:.1f} {pts[0][1]:.1f} ' + ' '.join(f'L {x:.1f} {y:.1f}' for x, y in pts[1:])
        return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="butt"/>'

    # the shared S-step: measured zone x in [-27, 10] (where the rip's
    # lines leave and rejoin their levels), stepping down one
    # regulation lane (LANE_W)
    X0, X1 = -27, 10
    def stepped(y):
        # .2f: the tail must land exactly on its level — a 0.05-off
        # arc endpoint shifts the semicircle's center ~1.5 cm
        return f'M -90 {y:.2f} L {X0} {y:.2f} {S(X0, y, X1, y + LANE_W)} L 18 {y + LANE_W:.2f}'

    parts = [
        # bed: entry rect + exact semicircular band + exit rect, with
        # the weave notch (the vacated top slot) cut transparent
        f'<path d="M -90 -72 H 18 V -36 H -90 Z '
        f'M 18 -72 A 72 72 0 0 1 18 72 '
        f'L 18 36 A 36 36 0 0 0 18 -36 Z '
        f'M -90 36 H 18 V 72 H -90 Z '
        f'M -27 -72 L -2 -72 L -9 -67.5 Z '
        f'M 2 -72 L 17 -72 L 10 -68.5 Z" fill="{BED_FILL}" fill-rule="evenodd"/>',
        # the three identical S boundaries, each settling into its arc:
        # top of lane 1 -> r 59.75 (it runs the full sweep to the exit)
        stroke(stepped(-71.25) + ' A 59.75 59.75 0 0 1 18 59.75 L -90 59.75', OUTLINE, 1.2),
        # lane 1/2 divider -> r 48.25
        stroke(stepped(-59.75) + ' A 48.25 48.25 0 0 1 18 48.25 L -90 48.25', OUTLINE, 1.1),
        # bottom of lane 2 settles onto the bottom wall (-36.75)
        stroke(stepped(-48.25), OUTLINE, 1.1),
        # walls: top wall's left run; outer r 71.25 (from the notch); the
        # bottom wall continues into the exact r 36.75 inner semicircle
        stroke('M -90 -71.25 H -27', OUTLINE, 1.2),
        stroke('M 18 -71.25 A 71.25 71.25 0 0 1 18 71.25 H -90', OUTLINE, 1.2),
        stroke('M -90 -36.75 H 18 A 36.75 36.75 0 0 1 18 36.75 H -90', OUTLINE, 1.2),
        # delineator: spans the weaved lanes of both entry straights
        line2([(-35.5, -71.25), (-35.5, -48.25)], OUTLINE, 1.2),
        line2([(-35.5, 36.75), (-35.5, 71.25)], OUTLINE, 1.2),
        # delineators: sections are separate pieces — the weave ends at
        # the turn's tangent (x=18, measured), and the turn itself is
        # 4x45-degree pieces (boundaries at -45/0/+45 degrees)
        line2([(18, -71.25), (18, -36.75)], OUTLINE, 1.2),
        line2([(18, 36.75), (18, 71.25)], OUTLINE, 1.2),
        line2([(43.99, -25.99), (68.38, -50.38)], OUTLINE, 1.2),
        line2([(54.75, 0.0), (89.25, 0.0)], OUTLINE, 1.2),
        line2([(43.99, 25.99), (68.38, 50.38)], OUTLINE, 1.2),
        # left-edge rails on both straights
        rr(-90, -72, 1.2, 36, 0, fill=rail, stroke='none'),
        rr(-90, 36, 1.2, 36, 0, fill=rail, stroke='none'),
    ]
    return parts


def arc_family(defn, rail):
    """corner/hairpin: Bri2.0's vocabulary on annular geometry — each
    lane a closed annular band (arc out, radial end, arc back, close)
    stroked 1.2 on the regulation grid, one sector bed fill. No rails
    or dashes; the mid-arc direction chevron stays as a marking."""
    geo = defn['_geo']
    lanes = defn.get('lanes', 3)
    cx, cy = geo['cx'], geo['cy']
    a1, sweep = geo['a1'], geo['sweep']
    R = geo['R']
    P = lambda r, a: (cx + r * math.cos(a), cy + r * math.sin(a))
    half = LANE_W * lanes / 2
    large = 1 if abs(sweep) > math.pi else 0
    sflag = 1 if sweep > 0 else 0

    def band_path(r0, r1):
        x1, y1 = P(r0, a1); x2, y2 = P(r0, a1 + sweep)
        x3, y3 = P(r1, a1 + sweep); x4, y4 = P(r1, a1)
        return (f'M {x1:.2f} {y1:.2f} A {r0:.2f} {r0:.2f} 0 {large} {sflag} {x2:.2f} {y2:.2f} '
                f'L {x3:.2f} {y3:.2f} A {r1:.2f} {r1:.2f} 0 {large} {1-sflag} {x4:.2f} {y4:.2f} Z')

    parts = []
    for i in range(lanes):
        fill = (LANE_FILLS[i] if LANE_FILLS and i < len(LANE_FILLS) and LANE_FILLS[i] else BED_FILL)
        parts.append(f'<path d="{band_path(R - half + LANE_W * i, R - half + LANE_W * (i + 1))}" '
                     f'fill="{fill}" stroke="{OUTLINE}" stroke-width="1.2"/>')
    return parts


def emit(defn, rail, rip=None):
    global BED_DEFS
    # Lan1's changer art is hand-modeled from measurements; Lan4 and the
    # hairpin rips still route through the measured tracer until their
    # hand models land (3/4-view illustrations: flyover corridors,
    # spiral rainbows)
    if defn['kind'] == 'changer' and (defn['w'], defn['h']) == (162, 36):
        body = changer_art(defn)
    elif defn['kind'] == 'hairpin' and (defn['w'], defn['h']) == (180, 144):
        body = lan2_art(defn, rail)
    elif defn['kind'] == 'jump':
        body = bri2_art(defn)
    elif rip:
        body = traced_body(rip, defn['w'], defn['h'],
                           (('solid', BED), ('gray', BANK_GRAY), ('mark', DASH), ('outline', OUTLINE)))
    elif defn['kind'] in ('corner', 'hairpin'):
        body = arc_family(defn, rail)
    else:
        body = rect_family(defn, rail)
    w, h = defn['w'], defn['h']
    if not rip and defn['kind'] in ('corner', 'hairpin'):
        # wide-band arcs (Cor5: band 60 on a 210 footprint) overhang the
        # catalog dims at the arc ends — clip to the drawn footprint so
        # nothing escapes (catalog-size viewBox is load-bearing: the app
        # draws sprites at def.w x def.h)
        body = [f'<clipPath id="vb"><rect x="{-w/2}" y="{-h/2}" width="{w}" height="{h}"/></clipPath>',
                '<g clip-path="url(#vb)">'] + body + ['</g>']
    defs = BED_DEFS.replace('{X1}', f'{-w/2:.2f}').replace('{X2}', f'{w/2:.2f}')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="{-w/2} {-h/2} {w} {h}">\n  ' + defs + '\n  '.join(body) + '\n</svg>\n')


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'assets'
    os.makedirs(out, exist_ok=True)
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    js = (
        "import { PIECES, PALETTE, VARIANT_COLORS } from './src/pieces.js';\n"
        "import { solveGeo } from './src/geometry.js';\n"
        "const out = {};\n"
        "for (const [n, d] of Object.entries(PIECES)) {\n"
        "  const e = { ...d, colors: d.colors || 1 };\n"
        "  if (d.kind === 'corner' || d.kind === 'hairpin') e._geo = solveGeo(n);\n"
        "  out[n] = e;\n"
        "}\n"
        "console.log(JSON.stringify({ pieces: out, palette: PALETTE, variantColors: VARIANT_COLORS }));"
    )
    proc = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, cwd=root)
    if proc.returncode != 0:
        sys.exit('node catalog dump failed: ' + proc.stderr[:400])
    data = json.loads(proc.stdout)
    pieces, vc = data['pieces'], data['variantColors']

    n, seen = 0, set()
    for name, defn in pieces.items():
        if defn.get('procedural'):
            continue
        if defn.get('sprite'):
            base = defn['sprite'][:-4] if defn['sprite'].endswith('.svg') else defn['sprite']
            files, rails = [f'{base}.svg'], [vc[0]]
        else:
            files = [f'{name}.{c}.svg' for c in range(defn['colors'])]
            if defn['kind'] == 'bank':
                pal = BANK_COLORS.get(name, vc)
                rails = [pal[c % len(pal)] for c in range(defn['colors'])]
            else:
                rails = [vc[c % len(vc)] for c in range(defn['colors'])]
        for fname, rail in zip(files, rails):
            if fname in seen:
                continue  # shared families: one file, first write wins
            seen.add(fname)
            # non-Lan1 measured kinds trace their rips (Lan4.0.svg <- Lan4.0.png)
            rip = os.path.join(root, 'assets', fname[:-4] + '.png') \
                if defn['kind'] in ('changer', 'hairpin') else None
            if rip and not os.path.exists(rip):
                rip = None  # fall through to modeled art instead of crashing
            global BED_FILL, LANE_FILLS, BED_DEFS
            BED_FILL, LANE_FILLS, BED_DEFS = BED, None, ''
            rip_any = os.path.join(root, 'assets', fname[:-4] + '.png')
            if os.path.exists(rip_any) and defn['kind'] not in ('bank', 'changer', 'hairpin'):
                _set_overrides(rip_any, fname, defn)
            with open(os.path.join(out, fname), 'w') as f:
                f.write(emit(defn, rail, rip))
            n += 1
    print(f'emitted {n} svg files (deduped)')


if __name__ == '__main__':
    main()
