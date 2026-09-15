"""shared palette, constants, and emit helpers (imported by svg.py and shapes.py)"""

LANE_W = 11.5   # regulation Tamiya lane width (115 mm); boundaries
               # sit at +/-(n*LANE_W)/2 + i*LANE_W, centered in the
               # footprint so every piece's lanes align at seams
BANK_GRAY = '#c0bcb8'   # Bri2's ramp-face midtone (same swatch as Ban1 c1)
BED = '#efeae5'
DASH = '#8a8683'   # dark gray separators — white was invisible on the light bed
OUTLINE = '#5d5a57'


def rr(x, y, w, h, r, **kw):
    fill = kw.get('fill', BED)
    stroke = kw.get('stroke', OUTLINE)
    sw = kw.get('stroke_width', 0.8)
    return f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{min(r, w/2, h/2):.2f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def line(x1, y1, x2, y2, color=DASH, w=0.7, dash='2.4,1.8'):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{color}" stroke-width="{w}"{d}/>'


# bank palettes sampled from the original rips (their own palettes, not
# VARIANT_COLORS); keyed per family — Ban2's single tan variant is NOT
# Ban1's green c0. This is only the placeholder shapes.py binds at import;
# svg.py injects the real per-family dict (BANK_GRAD, keyed by output
# filename) via `shapes.BANK_GRAD = ...` before generation starts.
BANK_GRAD = {}
