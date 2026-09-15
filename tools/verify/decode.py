#!/usr/bin/env python3
"""Minimal PNG decoder (zlib/struct, filters 0-4, 8-bit RGB/RGBA) + geometry probe."""
import struct, sys, zlib

def decode(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w, h, ch, bd, ct = 8, b'', 0, 0, 3, 8, 2
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos+8]); pos += 8
        chunk = data[pos:pos+ln]; pos += ln + 4
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', chunk[:10])
            ch = {2: 3, 6: 4}.get(ct)
            assert ch and bd == 8, f'unsupported bd={bd} ct={ct}'
        elif typ == b'IDAT': idat += chunk
        elif typ == b'IEND': break
    raw = zlib.decompress(idat); stride = w * ch
    out = bytearray(w * h * ch); prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]; line = bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
        for x in range(stride):
            a = line[x-ch] if x >= ch else 0; b = prev[x]; c = prev[x-ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[y*stride:(y+1)*stride] = line; prev = line
    return w, h, ch, out

def px(w, ch, buf, x, y):
    o = (y * w + x) * ch
    return tuple(buf[o:o+3])

if __name__ == '__main__':
    w, h, ch, buf = decode(sys.argv[1])
    print(f'{w}x{h} ch={ch}')
    from collections import Counter
    hist = Counter()
    for y in range(0, h, max(1, h // 200)):
        for x in range(0, w, max(1, w // 200)):
            hist[px(w, ch, buf, x, y)] += 1
    for c, n in hist.most_common(8):
        print(f'  color {c}: {n}')
