"""shared palette, constants, and emit helpers (imported by svg.py and shapes.py)"""
import math

CHEVRON = '#8a8683'
BANK_GRAY = '#c0bcb8'   # Bri2's ramp-face midtone (same swatch as Ban1 c1)
LANE_W = 11.5   # regulation Tamiya lane width (115 mm); boundaries
BED = '#efeae5'
DASH = '#8a8683'   # dark gray separators — white was invisible on the light bed
OUTLINE = '#5d5a57'
CHEVRON = '#8a8683'
# bank palettes sampled from the original rips (their own palettes, not
# VARIANT_COLORS); keyed per family — Ban2's single tan variant is NOT
# Ban1's green c0

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



BANK_GRAD = {}
