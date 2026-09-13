#!/usr/bin/env python3
"""Measured sprite extraction: rip PNG -> palette-mapped SVG paths.

Decodes a rip (8-bit RGB/RGBA PNG, 1 px = 1 cm), classifies pixels into
palette classes (outline / marking / bank-gray ramp / solid), traces each
class mask's contours along the pixel-edge lattice (marching squares),
simplifies with Douglas-Peucker, and emits <path> bodies in the centered
verts frame. Deterministic: sprites are a pure function of the rip.
"""
import struct, zlib

BED = '#efeae5'
DASH = '#8a8683'
OUTLINE = '#5d5a57'
BANK_GRAY = '#c0bcb8'


def decode(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w, h, ch = 8, b'', 0, 0, 3
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8]); pos += 8
        chunk = data[pos:pos + ln]; pos += ln + 4
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', chunk[:10])
            ch = {2: 3, 6: 4}.get(ct)
            assert ch and bd == 8, f'unsupported bitdepth={bd} colortype={ct}'
        elif typ == b'IDAT': idat += chunk
        elif typ == b'IEND': break
    raw = zlib.decompress(idat); stride = w * ch
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


def classify(w, h, ch, buf):
    """pixel -> 'solid' | 'gray' | 'mark' | 'outline' | None (transparent)"""
    cls = []
    for y in range(h):
        for x in range(w):
            o = (y * w + x) * ch
            if ch == 4 and buf[o + 3] <= 40:
                cls.append(None); continue
            r, g, b = buf[o], buf[o + 1], buf[o + 2]
            luma = (r + g + b) / 3
            if luma < 125:
                cls.append('outline')
            elif luma < 165:
                cls.append('mark')
            elif abs(r - 192) + abs(g - 188) + abs(b - 184) < 40:
                cls.append('gray')
            else:
                cls.append('solid')
    return cls


def mask_of(cls, w, h, kind):
    return [cls[y * w + x] == kind for y in range(h) for x in range(w)]


def contours(mask, w, h):
    """Closed polygons on the corner lattice; interior on the left, so
    outer rings and hole rings fall out of the same walk (evenodd)."""
    def inside(x, y):
        return 0 <= x < w and 0 <= y < h and mask[y * w + x]
    edges = {}   # start vertex -> list of end vertices
    def add(a, b): edges.setdefault(a, []).append(b)
    for y in range(h):
        for x in range(w):
            if not inside(x, y): continue
            if not inside(x, y - 1): add((x + 1, y), (x, y))
            if not inside(x, y + 1): add((x, y + 1), (x + 1, y + 1))
            if not inside(x - 1, y): add((x, y), (x, y + 1))
            if not inside(x + 1, y): add((x + 1, y + 1), (x + 1, y))
    polys = []
    while edges:
        start = next(iter(edges))
        v, poly = start, []
        while True:
            ends = edges.get(v)
            if not ends:
                break
            nv = ends.pop()
            if not ends: del edges[v]
            poly.append(v)
            v = nv
            if v == start:
                break
        if len(poly) >= 4:
            polys.append(poly)
    return polys


def simplify(pts, eps):
    if len(pts) < 3:
        return pts
    def rdp(a, b):
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = (dx * dx + dy * dy) ** .5 or 1e-9
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L
            if d > best: best, bi = d, i
        if best > eps:
            return rdp(a, bi)[:-1] + rdp(bi, b)
        return [pts[a], pts[b]]
    return rdp(0, len(pts) - 1)


def traced_body(rip, w, h, colors, eps=0.5):
    """colors: sequence of (class, fill) in paint order."""
    pw, ph, ch, buf = decode(rip)
    assert (pw, ph) == (w, h), f'{rip}: {pw}x{ph} != catalog {w}x{h}'
    cls = classify(pw, ph, ch, buf)
    body = []
    for klass, color in colors:
        mask = mask_of(cls, pw, ph, klass)
        subs = []
        for poly in contours(mask, pw, ph):
            pts = simplify(poly, eps)
            if len(pts) < 3:
                continue
            d = ' '.join(f'{"M" if i == 0 else "L"} {x - w / 2:.1f} {y - h / 2:.1f}' for i, (x, y) in enumerate(pts))
            subs.append(d + ' Z')
        if subs:
            body.append(f'<path d="{" ".join(subs)}" fill="{color}" fill-rule="evenodd"/>')
    return body


if __name__ == '__main__':
    import sys
    print('\n'.join(traced_body(sys.argv[1], *decode(sys.argv[1])[:2],
                                (('solid', BED), ('gray', BANK_GRAY), ('mark', DASH), ('outline', OUTLINE)))))
