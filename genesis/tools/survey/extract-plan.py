"""Extracts the Viva Lago Country masterplan from the surveyor's vector PDF.

The plan (Proyecto de Loteamiento Georreferenciado, scale 1/1.000) is drawn in
PDF points. Its four boundary monuments carry UTM 21S (WGS 84) coordinates, so a
least-squares similarity transform maps the drawing into metres. Lot polygons
are recovered by polygonizing the drawing's line work and identified by the lot
numbers printed inside them.

usage: python3 tools/survey/extract-plan.py plan.pdf > out.json
"""
import json
import sys

import numpy as np
import pdfplumber
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

# Monuments (mojones) from the plan's UTM table, and their drawn positions.
MOJONES_UTM = {1: (733230.41, 7181952.74), 2: (733149.65, 7182042.06), 3: (732945.87, 7182064.35), 4: (732937.16, 7181984.83)}


def similarity(src, dst):
    """Least-squares similarity (scale, rotation, translation) src -> dst."""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    # complex-number formulation: z' = c * z + t
    zs = a[:, 0] + 1j * a[:, 1]
    zd = b[:, 0] + 1j * b[:, 1]
    c = (np.conj(zs) @ zd) / (np.conj(zs) @ zs)
    def f(p):
        z = (p[0] - ms[0]) + 1j * (p[1] - ms[1])
        w = c * z
        return (w.real + md[0], w.imag + md[1])
    return f, abs(c)


# Drawn lines often stop a hair short of the line they meet; extending each
# end by ~0.3 m lets polygonize close the lot faces.
EXTEND_PT = 0.9


def extend(ls, d):
    c = list(ls.coords)
    def push(a, b):
        v = np.subtract(a, b)
        n = np.hypot(*v)
        return tuple(np.add(a, v / n * d)) if n > 1e-9 else a
    c[0] = push(c[0], c[1])
    c[-1] = push(c[-1], c[-2])
    return LineString(c)


def main(path):
    page = pdfplumber.open(path).pages[0]
    red = [o for o in page.curves if o.get('stroking_color') == (1.0, 0.0, 0.0)]
    # The plan's boundary is the red outline with corners in the left drawing.
    boundary = min(red, key=lambda o: o['pts'][0][0])['pts'][:4]
    # PDF 'top' grows downwards; flip so north is +y before fitting.
    flip = lambda p: (p[0], -p[1])
    # Corner order in the drawing: 2 (NE), 3 (NW), 4 (SW), 1 (SE).
    drawn = {2: boundary[0], 3: boundary[1], 4: boundary[2], 1: boundary[3]}
    keys = [1, 2, 3, 4]
    to_utm, scale = similarity([flip(drawn[k]) for k in keys], [MOJONES_UTM[k] for k in keys])
    residuals = {k: float(np.hypot(*(np.subtract(to_utm(flip(drawn[k])), MOJONES_UTM[k])))) for k in keys}

    outline = Polygon([flip(p) for p in boundary])
    region = outline.buffer(2)
    segs = []
    for o in page.lines + page.curves:
        if o.get('stroking_color') not in (0.0, (1.0, 0.0, 0.0)) and o.get('stroking_color') != [0.0]:
            continue
        pts = [flip(p) for p in o['pts']]
        if len(pts) < 2:
            continue
        ls = extend(LineString(pts), EXTEND_PT)
        if ls.length < 0.5 or not region.intersects(ls):
            continue
        segs.append(ls.intersection(region))
    segs.append(outline.exterior)
    faces = [f for f in polygonize(unary_union(segs)) if f.area > 50 and outline.buffer(0.5).contains(f)]

    labels = []
    for w in page.extract_words(keep_blank_chars=False, extra_attrs=['size']):
        t = w['text']
        x, y = (w['x0'] + w['x1']) / 2, -(w['top'] + w['bottom']) / 2
        if outline.contains(Point(x, y)):
            labels.append({'text': t, 'x': x, 'y': y, 'size': w['size']})

    # The river's edge (Río Acaray) is the long blue line in the plan drawing.
    blue = [o for o in page.curves if isinstance(o.get('stroking_color'), tuple) and o['stroking_color'][:2] in ((0.0, 0.0), (0.0, 0.246094)) and o['stroking_color'][2] == 1.0]
    river = max((o for o in blue if o['pts'][0][0] < 1000), key=lambda o: np.ptp(np.array(o['pts']), axis=0).sum())
    out = {'scale_m_per_pt': scale, 'residuals_m': residuals, 'faces': [], 'labels': [], 'river': [to_utm(flip(p)) for p in river['pts']]}
    # Keep only what identifies blocks and lots: lot numbers inside their
    # circles and the block letters. Other texts on the sheet (neighbours'
    # names, title block) are not needed and are not stored.
    for f in faces:
        ring = [to_utm(p) for p in list(f.exterior.coords)[:-1]]
        inside = [l['text'] for l in labels if l['text'].isdigit() and f.contains(Point(l['x'], l['y']))]
        out['faces'].append({'utm': ring, 'area_m2': Polygon(ring).area, 'labels': inside})
    for l in labels:
        if l['text'] in ('A', 'B', 'C', 'D', 'E') and l['size'] > 12:
            e, n = to_utm((l['x'], l['y']))
            out['labels'].append({**l, 'e': e, 'n': n})
    json.dump(out, sys.stdout, indent=1)


if __name__ == '__main__':
    main(sys.argv[1])
