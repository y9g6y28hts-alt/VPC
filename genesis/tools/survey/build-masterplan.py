"""Builds js/data/masterplan.js from the surveyed plan (output of extract-plan.py).

Faces are grouped into blocks (manzanas) by adjacency, identified by the block
letter and lot numbers printed on the plan, and checked against the plan's own
surface table (CUADRO DE SUPERFICIE). Coordinates are converted to the scene's
local metres: origin at the centroid of the four monuments, +x east, +z south.

usage: python3 tools/survey/build-masterplan.py tools/survey/plan-extract.json > js/data/masterplan.js
"""
import json
import sys

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

# Plan table: área propia per lot (m²), and the common areas.
TABLE_TEXT = """
A 01 371,38 227,58 598,96 2,9948
A 02 369,80 226,62 596,42 2,9821
A 03 365,80 224,16 589,96 2,9498
B 01 375,03 229,82 604,85 3,0242
B 02 382,90 234,64 617,54 3,0877
B 03 400,19 245,23 645,42 3,2271
B 04 384,00 235,32 619,32 3,0966
B 05 384,00 235,32 619,32 3,0966
B 06 384,00 235,32 619,32 3,0966
B 07 384,00 235,32 619,32 3,0966
B 08 384,00 235,32 619,32 3,0966
B 09 400,19 245,23 645,42 3,2271
B 10 382,90 234,64 617,54 3,0877
B 11 375,03 229,82 604,85 3,0243
C 01 366,66 224,69 591,35 2,9568
C 02 383,02 234,72 617,74 3,0887
C 03 427,72 262,11 689,83 3,4491
C 04 511,56 313,48 825,04 4,1252
D 02 420,29 257,55 677,84 3,3892
D 03 409,31 250,83 660,14 3,3007
E 01 400,19 245,23 645,42 3,2271
E 02 382,90 234,64 617,54 3,0877
E 03 375,03 229,82 604,85 3,0242
E 04 369,60 226,50 596,10 2,9805
E 05 369,60 226,50 596,10 2,9805
E 06 369,60 226,50 596,10 2,9805
E 07 369,60 226,50 596,10 2,9805
E 08 369,60 226,50 596,10 2,9805
E 09 369,60 226,50 596,10 2,9805
E 10 369,60 226,50 596,10 2,9805
E 11 369,60 226,50 596,10 2,9805
E 12 424,07 259,83 683,89 3,4195
"""  # transcribed from the PDF's text layer (CUADRO DE SUPERFICIE)
num = lambda t: float(t.replace('.', '').replace(',', '.'))
ROWS = {(b, int(n)): {'own': num(o), 'common': num(c), 'total': num(t), 'share': num(pc)} for b, n, o, c, t, pc in (l.split() for l in TABLE_TEXT.strip().splitlines())}
TABLE = {}
for (b, n), r in ROWS.items():
    TABLE.setdefault(b, {})[n] = r['own']
COMMON = {('A', 4): ('administracion', 'Administración', 341.70), ('D', 1): ('club', 'Club Náutico & Deportivo', 2141.96)}
MOJONES = {1: (733230.41, 7181952.74), 2: (733149.65, 7182042.06), 3: (732945.87, 7182064.35), 4: (732937.16, 7181984.83)}
ORIGIN = (sum(p[0] for p in MOJONES.values()) / 4, sum(p[1] for p in MOJONES.values()) / 4)


def local(p):
    return {'x': round(p[0] - ORIGIN[0], 2), 'z': round(-(p[1] - ORIGIN[1]), 2)}


def front_quad(poly, roads):
    """Street-facing frame of a lot as [front-left, front-right, back-right, back-left].

    The lot's minimum rotated rectangle gives its long axis; the front is the
    short side whose neighbourhood touches the roads most."""
    rect = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    edges = [(rect[i], rect[(i + 1) % 4]) for i in range(4)]
    length = lambda e: ((e[1][0] - e[0][0]) ** 2 + (e[1][1] - e[0][1]) ** 2) ** 0.5
    edge_road = roads.exterior.buffer(0.4)

    def contact(i):
        # Middle half of the side, swept 5 m each way with flat ends: catches a
        # curved street front without counting the adjoining sides at a corner.
        a, b = edges[i]
        m0 = (a[0] + (b[0] - a[0]) * 0.25, a[1] + (b[1] - a[1]) * 0.25)
        m1 = (a[0] + (b[0] - a[0]) * 0.75, a[1] + (b[1] - a[1]) * 0.75)
        band = LineString([m0, m1]).buffer(5.0, cap_style=2)
        return poly.exterior.intersection(band).intersection(edge_road).length

    # Among the sides on a street, take the one that leaves the most room for a
    # house: frontage and depth relative to a 20 x 40 m reference plot.
    # A side counts as a street front when most of its middle half is on a street.
    frac = lambda i: contact(i) / (length(edges[i]) / 2)
    on_street = [i for i in range(4) if frac(i) >= 0.75] or [max(range(4), key=frac)]
    room = lambda i: min(length(edges[i]) / 20, length(edges[(i + 1) % 4]) / 40)
    best = max(on_street, key=room)
    f0, f1 = edges[best]
    b1, b0 = edges[(best + 2) % 4]
    # On curved street fronts the rectangle's front edge lies outside the lot:
    # move it inward to where the lot actually starts across its width.
    ix, iy = (b0[0] - f0[0]), (b0[1] - f0[1])
    il = (ix * ix + iy * iy) ** 0.5
    ix, iy = ix / il, iy / il
    inner = poly.buffer(-0.02)
    shift = 0.0
    for t in [0.2 + 0.6 * k / 8 for k in range(9)]:
        px, py = f0[0] + (f1[0] - f0[0]) * t, f0[1] + (f1[1] - f0[1]) * t
        d = 0.0
        while d < 5 and not inner.contains(Point(px + ix * d, py + iy * d)):
            d += 0.05
        shift = max(shift, d)
    f0 = (f0[0] + ix * shift, f0[1] + iy * shift)
    f1 = (f1[0] + ix * shift, f1[1] + iy * shift)
    quad = [f0, f1, b1, b0]
    # Order so that quad[0] is front-left for someone on the street looking in.
    mid = ((f0[0] + f1[0]) / 2, (f0[1] + f1[1]) / 2)
    back = ((b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2)
    inward = (back[0] - mid[0], back[1] - mid[1])
    # In UTM (north up) 'right' of the inward direction is (in_y, -in_x).
    right = (inward[1], -inward[0])
    if (f0[0] - mid[0]) * right[0] + (f0[1] - mid[1]) * right[1] > 0:
        quad = [f1, f0, b0, b1]
    return quad, contact(best)


def corners(ring, angle_deg=25):
    """Vertices where the outline turns sharply (survey markers), not arc samples."""
    import math
    out = []
    n = len(ring)
    for i in range(n):
        a, b, c = ring[i - 1], ring[i], ring[(i + 1) % n]
        u = (b[0] - a[0], b[1] - a[1])
        v = (c[0] - b[0], c[1] - b[1])
        lu, lv = math.hypot(*u), math.hypot(*v)
        if lu < 1e-6 or lv < 1e-6:
            continue
        cos = max(-1, min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))
        if math.degrees(math.acos(cos)) > angle_deg:
            out.append(b)
    return out


def main(path):
    d = json.load(open(path))
    faces = [Polygon(f['utm']) for f in d['faces']]
    circles = [(Polygon(f['utm']).centroid, ''.join(f['labels'])) for f in d['faces'] if f['area_m2'] < 10 and ''.join(f['labels']).isdigit()]
    big = [f for f in faces if f.area >= 10]
    letters = [l for l in d['labels'] if l['text'] in 'ABCDE' and l['size'] > 12]
    roads = max(big, key=lambda f: f.area)  # avenue + both streets: one face
    nautical = None
    entrance = None
    parcels = []
    for f in big:
        if f is roads:
            continue
        nums = [t for c, t in circles if Polygon(f.exterior).contains(c)]
        if not nums:
            # Unnumbered faces: the nautical access (≈517 m²) and the small
            # entrance pad marked "ACCESO" next to the administration.
            if f.area > 100:
                if nautical is not None:
                    raise SystemExit('more than one large unnumbered face besides the roads')
                nautical = f
            else:
                entrance = f
            continue
        if len(nums) != 1:
            raise SystemExit(f'face {f.area:.1f} has labels {nums}')
        parcels.append({'poly': f, 'number': int(nums[0])})
    # Blocks: parcels connected by shared edges.
    groups = []
    for p in parcels:
        hit = [g for g in groups if any(q['poly'].buffer(0.05).intersects(p['poly']) for q in g)]
        merged = [p] + [q for g in hit for q in g]
        groups = [g for g in groups if g not in hit] + [merged]
    for g in groups:
        u = unary_union([q['poly'] for q in g]).buffer(0.1)
        inside = [l['text'] for l in letters if u.contains(Point(l['e'], l['n']))]
        if len(inside) != 1:
            raise SystemExit(f'block with {len(g)} parcels has letters {inside}')
        for q in g:
            q['block'] = inside[0]

    lots, common = [], []
    worst = 0
    for q in sorted(parcels, key=lambda q: (q['block'], q['number'])):
        key = (q['block'], q['number'])
        ring = [local(p) for p in list(q['poly'].exterior.simplify(0.05).coords)[:-1]]
        area = q['poly'].area
        if key in COMMON:
            cid, name, official = COMMON[key]
            common.append({'id': cid, 'name': name, 'block': q['block'], 'number': q['number'], 'areaM2': official, 'polygon': ring})
            worst = max(worst, abs(area - official) / official)
            continue
        official = TABLE[q['block']][q['number']]
        worst = max(worst, abs(area - official) / official)
        quad, touch = front_quad(q['poly'], roads)
        if touch < 1.0:
            raise SystemExit(f"{q['block']}-{q['number']} has no street frontage")
        utm_ring = list(q['poly'].exterior.simplify(0.05).coords)[:-1]
        row = ROWS[key]
        lots.append({'id': f"{q['block']}-{q['number']:02d}", 'block': q['block'], 'number': q['number'], 'areaM2': official, 'commonAreaM2': row['common'], 'totalAreaM2': row['total'], 'sharePct': row['share'], 'drawnAreaM2': round(area, 1),
                     'polygon': ring, 'frameQuad': [local(p) for p in quad], 'corners': [local(p) for p in corners(utm_ring)]})
    expected = sum(len(v) for v in TABLE.values())
    if len(lots) != expected:
        raise SystemExit(f'found {len(lots)} lots, plan lists {expected}')
    if worst > 0.03:
        raise SystemExit(f'drawn area differs from the table by {worst:.1%}')

    data = {
        'roads': [local(p) for p in list(roads.exterior.simplify(0.05).coords)[:-1]],
        'roadHoles': [[local(p) for p in list(h.coords)[:-1]] for h in roads.interiors],
        'nauticalAccess': [local(p) for p in list(nautical.exterior.simplify(0.05).coords)[:-1]],
        'entrance': [local(p) for p in list(entrance.exterior.simplify(0.05).coords)[:-1]] if entrance else [],
        'boundary': {str(k): local(v) for k, v in MOJONES.items()},
        'river': [local(p) for p in d['river']],
    }
    out = sys.stdout
    out.write('// GENERATED by tools/survey/build-masterplan.py from the surveyed plan\n')
    out.write('// "Proyecto de Loteamiento Georreferenciado" (Finca 18.485, scale 1/1.000,\n')
    out.write('// UTM 21S / WGS 84). Do not edit by hand: re-run the survey tools instead.\n')
    out.write(f'// Local metres: origin at the monuments\' centroid (E {ORIGIN[0]:.2f}, N {ORIGIN[1]:.2f}), +x east, +z south.\n')
    out.write(f'// Largest difference between drawn and tabulated areas: {worst:.2%}.\n\n')
    out.write(f'export const UTM_ORIGIN = Object.freeze({{ zone: \'21S\', easting: {ORIGIN[0]:.2f}, northing: {ORIGIN[1]:.2f} }});\n\n')
    for name, value in (('MONUMENTS', data['boundary']), ('ROADS', data['roads']), ('NAUTICAL_ACCESS', data['nauticalAccess']), ('ENTRANCE_PAD', data['entrance']), ('RIVER_EDGE', data['river']), ('COMMON_PARCELS', common), ('SURVEYED_LOTS', lots)):
        out.write(f'export const {name} = {json.dumps(value, separators=(",", ":"), ensure_ascii=False)};\n\n')
    out.write(f'export const ROAD_ISLANDS = {json.dumps(data["roadHoles"], separators=(",", ":"))};\n')
    print(f'{len(lots)} lots, {len(common)} common parcels, worst area diff {worst:.2%}, road holes {len(data["roadHoles"])}', file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1])
