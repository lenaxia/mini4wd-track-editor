#!/usr/bin/env python3
"""SVG sprite emitter — the full catalog in the original illustrated style.

Palette sampled from the original Tamiya PNGs (light warm-gray bed,
dark-gray walls/outline, white dashed lane markings; color variants
recolor the rails — VARIANT_COLORS). Shape logic is a port of art.js
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

BED = '#efeae5'
DASH = '#8a8683'   # dark gray separators — white was invisible on the light bed
OUTLINE = '#5d5a57'
CHEVRON = '#8a8683'
# bank palettes sampled from the original rips (their own palettes, not
# VARIANT_COLORS); keyed per family — Ban2's single tan variant is NOT
# Ban1's green c0
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
    """straight/start/slope/jump/bank/wave/changer share the rect footprint."""
    w, h, lanes = defn['w'], defn['h'], defn.get('lanes', 1)
    kind = defn['kind']
    parts = [rr(-w / 2, -h / 2, w, h, min(2.0, h / 4), fill=BED)]
    # rails (variant color) inside the top/bottom edges
    rail_h = min(1.8, h * 0.14)
    parts.append(rr(-w / 2 + 0.4, -h / 2 + 0.4, w - 0.8, rail_h, 1.0, fill=rail, stroke='none'))
    parts.append(rr(-w / 2 + 0.4, h / 2 - 0.4 - rail_h, w - 0.8, rail_h, 1.0, fill=rail, stroke='none'))
    # lane separators: straight kinds (wave/changer override below)
    if kind in ('straight', 'start', 'slope', 'jump', 'bank'):
        for i in range(1, lanes):
            y = -h / 2 + h * i / lanes
            parts.append(line(-w / 2 + 2, y, w / 2 - 2, y, DASH, 0.7))
    if kind == 'straight':
        n = max(1, round(w / 54))
        for i in range(n):
            parts.append(chevron(-w / 4 + (w / 2 / n) * i + 2.2, 0, h / 8, 2.2, 'rgba(0,0,0,.18)'))
    elif kind == 'start':
        cell = h / 4
        parts.append('<g>')
        for r in range(4):
            for c in range(2):
                if (r + c) % 2 == 0:
                    parts.append(f'<rect x="{-w/6 + c*cell:.2f}" y="{-h/2 + r*cell:.2f}" width="{cell:.2f}" height="{cell:.2f}" fill="#ffffff"/>')
        parts.append('</g>')
    elif kind == 'slope':
        n = max(2, round(w / 9))
        for i in range(n):
            parts.append(chevron((w - 6) * i / n + 3, 0, h / 3))
    elif kind == 'jump':
        n = max(1, round(w / 54))
        for i in range(n):
            parts.append(chevron(-w / 4 + (w / 2 / n) * i + 2.2, 0, h / 8, 2.2, 'rgba(0,0,0,.18)'))
    elif kind == 'bank':
        # the original bank is a solid variant-colored banked block
        parts = [rr(-w / 2, -h / 2, w, h, min(2.0, h / 4), fill=rail)]
        parts.append(rr(-w / 2 + 0.4, -h / 2 + 0.4, w - 0.8, min(1.6, h * 0.12), 1.0, fill=OUTLINE, stroke='none'))
        parts.append(rr(-w / 2 + 0.4, h / 2 - 0.4 - min(1.6, h * 0.12), w - 0.8, min(1.6, h * 0.12), 1.0, fill=OUTLINE, stroke='none'))
        for i in range(1, lanes):
            y = -h / 2 + h * i / lanes
            parts.append(line(-w / 2 + 2, y, w / 2 - 2, y, DASH, 0.7))
        return parts
    elif kind == 'wave':
        # chicane: the lane SEPARATORS are thick sine bands (alternating
        # phase per lane) that pinch and swell the lanes edge to edge
        amp, n = h / 7, max(2, round(w / 27))
        for li in range(1, lanes):
            y0 = -h / 2 + h * li / lanes
            phase = 0.0 if li % 2 == 1 else math.pi
            d = []
            for k in range(0, 101):
                x = -w / 2 + 2 + (w - 4) * k / 100
                y = y0 + math.sin((x + w / 2) / w * 2 * math.pi * n + phase) * amp
                d.append(f'{"M" if k == 0 else "L"} {x:.2f} {y:.2f}')
            parts.append(f'<path d="{" ".join(d)}" fill="none" stroke="{DASH}" stroke-width="2.2" stroke-linecap="round"/>')
    elif kind == 'changer':
        for i in range(lanes + 1):
            y1 = -h / 2 + (i * h) / lanes
            y2 = -h / 2 + ((lanes - i) * h) / lanes
            parts.append(line(-w / 2 + 3, y1, w / 2 - 3, y2, DASH, 0.8, dash=None))
        parts.append(chevron(-w / 6, 0, 6, 2.2))
        parts.append(chevron(w / 6, 0, 6, -2.2))
    return parts


def arc_family(defn, rail):
    """corner/hairpin: annular sector from solveGeo geometry."""
    geo = defn['_geo']
    lanes = defn.get('lanes', 3)
    band = defn['band']
    cx, cy = geo['cx'], geo['cy']
    a1, sweep = geo['a1'], geo['sweep']
    R = geo['R']
    P = lambda r, a: (cx + r * math.cos(a), cy + r * math.sin(a))

    ro, ri = R + band / 2, R - band / 2
    large = 1 if abs(sweep) > math.pi else 0
    sflag = 1 if sweep > 0 else 0
    x1, y1 = P(ro, a1); x2, y2 = P(ro, a1 + sweep)
    x3, y3 = P(ri, a1 + sweep); x4, y4 = P(ri, a1)
    parts = [
        f'<path d="M {x1:.2f} {y1:.2f} A {ro:.2f} {ro:.2f} 0 {large} {sflag} {x2:.2f} {y2:.2f} '
        f'L {x3:.2f} {y3:.2f} A {ri:.2f} {ri:.2f} 0 {large} {1-sflag} {x4:.2f} {y4:.2f} Z" '
        f'fill="{BED}" stroke="{OUTLINE}" stroke-width="0.8"/>'
    ]
    # rails: thin arcs at the band edges
    for r, col in ((ro - 0.9, rail), (ri + 0.9, rail)):
        xa, ya = P(r, a1); xb, yb = P(r, a1 + sweep)
        parts.append(f'<path d="M {xa:.2f} {ya:.2f} A {r:.2f} {r:.2f} 0 {large} {sflag} {xb:.2f} {yb:.2f}" fill="none" stroke="{col}" stroke-width="1.6"/>')
    # lane separators: dashed arcs
    for i in range(1, lanes):
        r = ri + band * i / lanes
        xa, ya = P(r, a1); xb, yb = P(r, a1 + sweep)
        parts.append(f'<path d="M {xa:.2f} {ya:.2f} A {r:.2f} {r:.2f} 0 {large} {sflag} {xb:.2f} {yb:.2f}" fill="none" stroke="{DASH}" stroke-width="0.7" stroke-dasharray="2.4,1.8"/>')
    # direction chevron at mid-arc
    am = a1 + sweep / 2
    rm = R
    px, py = P(rm, am)
    tang = am + (math.pi / 2 if sweep > 0 else -math.pi / 2)
    parts.append(f'<path d="M {px - 1.6*math.cos(tang):.2f} {py - 1.6*math.sin(tang) - band/6:.2f} L {px + 1.6*math.cos(tang):.2f} {py + 1.6*math.sin(tang):.2f} L {px - 1.6*math.cos(tang):.2f} {py - 1.6*math.sin(tang) + band/6:.2f}" fill="none" stroke="{CHEVRON}" stroke-width="0.9" transform="rotate({math.degrees(tang):.1f} {px:.2f} {py:.2f})"/>')
    return parts


def emit(defn, rail):
    if defn['kind'] in ('corner', 'hairpin'):
        body = arc_family(defn, rail)
    else:
        body = rect_family(defn, rail)
    w, h = defn['w'], defn['h']
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="{-w/2} {-h/2} {w} {h}">\n  ' + '\n  '.join(body) + '\n</svg>\n')


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
            with open(os.path.join(out, fname), 'w') as f:
                f.write(emit(defn, rail))
            n += 1
    print(f'emitted {n} svg files (deduped)')


if __name__ == '__main__':
    main()
