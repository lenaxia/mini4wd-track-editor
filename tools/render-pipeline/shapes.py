"""tracklib shapes — per-kind recipes producing z-ordered SVG layers.

Extracted verbatim from svg.py's rect_family/arc_family; the output
must remain byte-identical to the reference goldens pinned in
tools/verify/golden (prove with: regenerate, git diff assets/ empty).
Ctx carries the per-file render state that svg.py kept in globals.
"""
import math

from svg_globals import (LANE_W, BED, OUTLINE, DASH,
                         BANK_GRAD, rr, line)


class Ctx:
    """per-file render state (was svg.py module globals)"""
    def __init__(self, fname='', bed_fill=BED, lane_fills=None, bed_defs=''):
        self.fname = fname
        self.bed_fill = bed_fill
        self.lane_fills = lane_fills
        self.bed_defs = bed_defs


def rect_family(defn, rail, ctx):
    """straight/start/slope — Bri2.0's vocabulary: per-lane closed
    stroked rectangles (1.2, miter joins) on the regulation grid over
    one bed fill. No rails, dashes, or chevrons; the start checker
    stays as a marking on top. (jump/wave route to their own art;
    bank keeps its solid block.)"""
    w, h, lanes = defn['w'], defn['h'], defn.get('lanes', 1)
    half = LANE_W * lanes / 2
    if defn['kind'] == 'bank':
        # banked block: variant color as a rip-sampled gradient along x
        grad = BANK_GRAD.get(ctx.fname[:-4])
        if grad:
            gid = 'bankg_' + ctx.fname[:-4].replace('.', '_')
            from svg import _grad_def; ctx.bed_defs += _grad_def(gid, [(int(g[1:3], 16), int(g[3:5], 16), int(g[5:7], 16)) for g in grad])
            fillv = f'url(#{gid})'
        else:
            fillv = rail
        parts = [rr(-w / 2, -h / 2, w, h, min(2.0, h / 4), fill=fillv)]
        for i in range(1, lanes):
            y = -LANE_W * lanes / 2 + LANE_W * i
            parts.append(line(-w / 2 + 2, y, w / 2 - 2, y, DASH, 0.7))
        return parts
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
            fill = (ctx.lane_fills[i] if ctx.lane_fills and i < len(ctx.lane_fills) and ctx.lane_fills[i] else ctx.bed_fill)
            parts.append(f'<path d="{lane_path(i)}" fill="{fill}" stroke="{OUTLINE}" stroke-width="1.2"/>')
        return parts

    for i in range(lanes):
        y0 = -half + LANE_W * i
        fill = (ctx.lane_fills[i] if ctx.lane_fills and i < len(ctx.lane_fills) and ctx.lane_fills[i] else ctx.bed_fill)
        if defn['kind'] == 'slope':
            # slopes are straights with elevation: the rise renders as
            # an automatic base-fill -> bank-gray ramp along travel
            # (the jump carries the same gradient on its ramp lane)
            gid = 'ramp_' + ctx.fname[:-4].replace('.', '_').replace('-', '_') + f'_{i}'
            base = fill.lstrip('#') if not fill.startswith('url') else None
            if base:
                r0, g0, b0 = (int(base[j:j + 2], 16) for j in (0, 2, 4))
                from svg import _grad_def
                ctx.bed_defs += _grad_def(gid, [(r0, g0, b0), (192, 188, 184), (192, 188, 184)])
                fill = f'url(#{gid})'
        parts.append(f'<path d="M {-w/2:.2f} {y0:.2f} H {w/2:.2f} V {y0 + LANE_W:.2f} H {-w/2:.2f} Z" '
                     f'fill="{fill}" stroke="{OUTLINE}" stroke-width="1.2"/>')
    if defn['kind'] == 'start':
        # checkered flag band across ALL lanes (black/white, 2 columns
        # of half-lane cells) at the start end, then a direction arrow
        # per lane pointing along travel
        cell = LANE_W / 2
        rows = lanes * 2
        x0 = w / 2 - 2 - 2 * cell
        for r in range(rows):
            for c in range(2):
                col = '#ffffff' if (r + c) % 2 == 0 else '#1a1a1a'
                parts.append(f'<rect x="{x0 + c*cell:.2f}" y="{-half + r*cell:.2f}" width="{cell:.2f}" height="{cell:.2f}" fill="{col}"/>')
        for i in range(lanes):
            yc = -half + LANE_W * (i + 0.5)
            cx = -w / 4
            parts.append(f'<path d="M {cx-4:.2f} {yc-3:.2f} L {cx+4:.2f} {yc:.2f} L {cx-4:.2f} {yc+3:.2f} Z" fill="{OUTLINE}" stroke="none"/>')
    return parts




def arc_family(defn, rail, ctx):
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
        fill = (ctx.lane_fills[i] if ctx.lane_fills and i < len(ctx.lane_fills) and ctx.lane_fills[i] else ctx.bed_fill)
        parts.append(f'<path d="{band_path(R - half + LANE_W * i, R - half + LANE_W * (i + 1))}" '
                     f'fill="{fill}" stroke="{OUTLINE}" stroke-width="1.2"/>')
    return parts


