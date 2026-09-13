#!/usr/bin/env python3
"""SVG sprite emitter — illustrated style matched to the original Tamiya
sprites (sampled: light warm-gray bed #efeae5, dark-gray outline/walls
#7a7674, white dashed lane separators, chevrons on slopes).

Shapes come from the CATALOG (measured geometry), not rasterized meshes:
every downloaded piece is a rectangle in top-down ortho, so catalog-driven
vectors are exact. Corner/hairpin pieces (arcs) render from verts+R when
their downloads arrive; until then art.js covers them procedurally on
canvas — same palette, same rules.

Output: one <Name>.svg per entry, viewBox in cm (1 unit = 1 cm), canvas-
ready (explicit width/height so drawImage scales correctly).
"""
import json, os, sys

BED = '#efeae5'
WALL = '#7a7674'
DASH = '#ffffff'
OUTLINE = '#5d5a57'
RAIL = '#c9d1dc'  # variant-0 rail color (from pieces.js VARIANT_COLORS[0])

CHEVRON = 'rgba(255,255,255,.5)'


def straight_svg(defn):
    w, h = defn['w'], defn['h']
    lanes = defn.get('lanes', 1)
    r = min(2.0, w / 2, h / 2)
    parts = [
        f'<rect x="0" y="0" width="{w}" height="{h}" rx="{r}" fill="{BED}" stroke="{OUTLINE}" stroke-width="0.8"/>',
        # walls: dark bands along the long edges (drawn inside the outline)
        f'<rect x="0.4" y="0.4" width="{w-0.8}" height="1.6" rx="{min(1.2, r)}" fill="{WALL}"/>',
        f'<rect x="0.4" y="{h-2.0}" width="{w-0.8}" height="1.6" rx="{min(1.2, r)}" fill="{WALL}"/>',
    ]
    # lane separators: lanes-1 dashed white lines down the middle
    for i in range(1, lanes):
        y = h * i / lanes
        parts.append(f'<line x1="2" y1="{y:.2f}" x2="{w-2}" y2="{y:.2f}" stroke="{DASH}" stroke-width="0.7" stroke-dasharray="2.4,1.8"/>')
    if defn.get('kind') == 'slope':
        # chevrons pointing +x (travel direction, downhill-to-uphill read)
        n = max(2, round(w / 9))
        for i in range(n):
            x = 3 + (w - 6) * i / n
            parts.append(f'<path d="M {x:.1f} {h*0.28} L {x+2.2:.1f} {h/2} L {x:.1f} {h*0.72}" fill="none" stroke="{CHEVRON}" stroke-width="0.9"/>')
    return parts


def emit(name, defn):
    w, h = defn['w'], defn['h']
    body = straight_svg(defn)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
           f'viewBox="0 0 {w} {h}">\n  ' + '\n  '.join(body) + '\n</svg>\n')
    return svg


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '../../src/pieces.js'
    out = sys.argv[2] if len(sys.argv) > 2 else '../../assets'
    os.makedirs(out, exist_ok=True)
    # pull the rucdoc drawer's real-data pieces from the JS catalog via node
    import subprocess
    js = ('import { PIECES, PALETTE } from "./src/pieces.js"; '
          'const out = {}; '
          'for (const n of PALETTE.rucdoc) { const d = PIECES[n]; if (!d.procedural) out[n] = d; } '
          'console.log(JSON.stringify(out));')
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    proc = subprocess.run(['node', '--input-type=module', '-e', js],
                          capture_output=True, text=True, cwd=root)
    if proc.returncode != 0:
        sys.exit('node catalog dump failed: ' + proc.stderr[:300])
    data = json.loads(proc.stdout)
    for name, defn in data.items():
        sprite = defn.get('sprite') or name
        path = os.path.join(out, f'{sprite}.svg')
        with open(path, 'w') as f:
            f.write(emit(name, defn))
        print(f'{sprite}.svg ({defn["w"]}x{defn["h"]}cm, lanes={defn.get("lanes")})')


if __name__ == '__main__':
    main()
