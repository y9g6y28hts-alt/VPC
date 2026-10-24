#!/usr/bin/env python3
"""Generates the tileable PBR textures used by the Viva Lago experience.

Every texture is synthesised here from seeded noise (no third-party imagery), so
the output is original work. Each material gets an sRGB albedo map and a
tangent-space normal map (OpenGL convention, +Y up), written as WebP.

    python3 tools/generate-textures.py

Requires numpy and Pillow. The real-world size each tile represents is listed in
TEXTURE_SIZES_M and mirrored in js/experience/house/materials.js.
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "textures"
TREE_SRC = ROOT / "assets" / "trees" / "source"
TREE_OUT = ROOT / "assets" / "trees"

# Metres covered by one tile (documentation; consumed by materials.js).
TEXTURE_SIZES_M = {
    "plaster": 2.0, "concrete": 2.4, "brick": 1.0, "stone": 2.0, "timber": 0.6, "cladding": 0.6,
    "grass": 4.0, "soil": 4.0, "asphalt": 4.0, "gravel": 1.5, "pavers": 2.4,
    "deck": 1.12, "sand": 2.0, "plywood": 2.44,
}


# ---------------------------------------------------------------- noise helpers

def rng_for(name):
    # Deterministic per material so regenerating produces identical files.
    return np.random.default_rng(sum(ord(c) * (i + 1) for i, c in enumerate(name)))


def blur(img, sigma):
    """Periodic gaussian blur via FFT (keeps textures tileable)."""
    if sigma <= 0:
        return img
    h, w = img.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    if img.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(img[..., c]) * g)) for c in range(img.shape[2])], -1)
    return np.real(np.fft.ifft2(np.fft.fft2(img) * g))


def noise(size, sigma, rng, aspect=(1.0, 1.0)):
    """Band-limited tileable noise normalised to roughly [-1, 1].
    aspect stretches the features (sy, sx) for grain-like patterns."""
    h, w = (size, size) if isinstance(size, int) else size
    white = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    sy, sx = aspect
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * ((fx * sx) ** 2 + (fy * sy) ** 2))
    n = np.real(np.fft.ifft2(np.fft.fft2(white) * g))
    return n / (np.abs(n).max() + 1e-9)


def fbm(size, base_sigma, rng, octaves=5, gain=0.5, aspect=(1.0, 1.0)):
    total, amp, norm, sigma = 0.0, 1.0, 0.0, base_sigma
    for _ in range(octaves):
        total = total + amp * noise(size, sigma, rng, aspect)
        norm += amp
        amp *= gain
        sigma /= 2.0
    return total / norm


def worley(size, cells, rng, jitter=0.85):
    """Periodic F1/F2 cellular noise with per-pixel cell id (jittered grid)."""
    h = w = size
    pts = (rng.random((cells, cells, 2)) - 0.5) * jitter + 0.5  # in cell units
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = xx * cells / w
    cy = yy * cells / h
    ix = np.floor(cx).astype(int)
    iy = np.floor(cy).astype(int)
    f1 = np.full((h, w), 1e9, np.float32)
    f2 = np.full((h, w), 1e9, np.float32)
    cid = np.zeros((h, w), np.int64)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx = ix + dx
            ny = iy + dy
            px = nx + pts[ny % cells, nx % cells, 0]
            py = ny + pts[ny % cells, nx % cells, 1]
            d = np.hypot(px - cx, py - cy)
            ids = (ny % cells) * cells + (nx % cells)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, ids, cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def normal_map(height, strength):
    """Tangent-space normal map from a height field (periodic finite differences)."""
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    nx = -dx * strength
    ny = dy * strength  # image rows run downward, texture V runs upward
    nz = np.ones_like(height)
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def to_srgb_img(rgb):
    return Image.fromarray(np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")


def save(name, albedo, normal=None, rough=None, q=86, size=None, normal_size=None):
    """normal_size downsizes noisy (high-entropy) normal maps that compress poorly."""
    OUT.mkdir(parents=True, exist_ok=True)
    img = to_srgb_img(albedo)
    if size:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(OUT / f"{name}_albedo.webp", quality=q, method=6)
    if normal is not None:
        nimg = to_srgb_img(normal)
        if normal_size or size:
            n = normal_size or size
            nimg = nimg.resize((n, n), Image.LANCZOS)
        nimg.save(OUT / f"{name}_normal.webp", quality=82, method=6)
    if rough is not None:
        rimg = Image.fromarray(np.clip(rough * 255 + 0.5, 0, 255).astype(np.uint8), "L")
        if size:
            rimg = rimg.resize((size, size), Image.LANCZOS)
        rimg.save(OUT / f"{name}_rough.webp", quality=88, method=6)
    print("wrote", name)


def tint(base_hex, variation, amounts=(1.0, 1.0, 1.0)):
    base = hex_rgb(base_hex)
    return base[None, None, :] * (1.0 + variation[..., None] * np.array(amounts)[None, None, :])


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- materials

def plaster(S=1024):
    r = rng_for("plaster")
    mott = fbm(S, 90, r, 4) * 0.035
    fine = noise(S, 0.9, r) * 0.025
    trowel = fbm(S, 40, r, 3, aspect=(1.0, 0.35))
    alb = tint("#EDEBE6", mott + fine * 0.6)
    h = noise(S, 0.8, r) * 0.6 + noise(S, 2.0, r) * 0.4 + trowel * 0.6
    save("plaster", alb, normal_map(h, 1.6), normal_size=512)


def concrete(S=1024):
    r = rng_for("concrete")
    # Board-formed: 16 horizontal boards per tile (2.4 m -> 15 cm boards)
    boards = 16
    y = np.arange(S)[:, None] * boards / S
    board_id = np.floor(y).astype(int) % boards
    board_tone = (r.random(boards) - 0.5) * 0.06
    grain = fbm(S, 6, r, 3, aspect=(0.08, 1.0)) * 0.03  # grain runs along boards
    mott = fbm(S, 120, r, 4) * 0.06
    pores_n = noise(S, 0.7, r)
    pores = (pores_n > 0.82).astype(np.float32)
    edge = np.abs((y % 1.0) - 0.0)
    seam = 1 - smoothstep(0.0, 0.025, np.minimum(edge, 1 - edge))
    var = board_tone[board_id] + grain + mott - pores * 0.10 - seam * 0.05
    alb = tint("#A9A59D", np.broadcast_to(var, (S, S)))
    h = grain * 6 - pores * 0.6 - seam * 0.8 + noise(S, 1.2, r) * 0.25
    save("concrete", alb, normal_map(np.broadcast_to(h, (S, S)).copy(), 1.3))


def brick(S=1024):
    """Paraguayan 'ladrillo común' (~25 x 6 cm) in running bond, raw (unrendered)."""
    r = rng_for("brick")
    courses, per_row = 14, 4
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    cy = yy * courses / S
    row = np.floor(cy).astype(int)
    fy = cy - row
    cx = xx * per_row / S + (row % 2) * 0.5
    col = np.floor(cx).astype(int) % per_row
    fx = cx - np.floor(cx)
    mortar_x = 0.012 / 0.25   # joint width relative to brick length
    mortar_y = 0.012 / 0.0714
    jx = np.minimum(fx, 1 - fx) / mortar_x
    jy = np.minimum(fy, 1 - fy) / mortar_y
    in_brick = smoothstep(0.35, 0.75, np.minimum(jx, jy))
    bid = row * per_row + col
    tone = r.random(courses * per_row)
    hue = r.random(courses * per_row)
    base_a, base_b, burnt = hex_rgb("#B25C3B"), hex_rgb("#C77A52"), hex_rgb("#7E3B27")
    bcol = base_a[None, :] * (1 - tone[:, None]) + base_b[None, :] * tone[:, None]
    bcol = np.where((hue > 0.86)[:, None], bcol * 0.55 + burnt * 0.45, bcol)
    col_img = bcol[bid]
    surf = fbm(S, 3, r, 3) * 0.08 + noise(S, 0.8, r) * 0.05
    col_img = col_img * (1 + surf[..., None])
    mortar = tint("#9E968A", fbm(S, 4, r, 3) * 0.12)
    alb = col_img * in_brick[..., None] + mortar * (1 - in_brick[..., None])
    h = in_brick * 1.0 + surf * 2.0 + (1 - in_brick) * fbm(S, 2, r, 2) * 0.3
    save("brick", alb, normal_map(h, 4.0))


def stone(S=1024):
    """Random-ashlar natural stone cladding with recessed joints."""
    r = rng_for("stone")
    palette = [hex_rgb(c) for c in ("#B5A386", "#9C8B73", "#C8BAA0", "#857565", "#D3C6AC", "#A89480", "#7E7468", "#B9A27E", "#9A928A")]
    alb = np.zeros((S, S, 3), np.float32)
    height = np.zeros((S, S), np.float32)
    joint = 0.009 / 2.0 * S  # 9 mm joints in a 2 m tile
    y = 0.0
    xs = np.arange(S, dtype=np.float32)
    while y < S - 1:
        ch = r.choice([0.08, 0.1, 0.13, 0.16, 0.2, 0.24]) / 2.0 * S
        if S - y < ch * 1.6:
            ch = S - y
        y0, y1 = int(round(y)), int(round(y + ch))
        offset = r.random() * S
        lengths = []
        total = 0.0
        while total < S:
            l = r.uniform(0.25, 0.95) / 2.0 * S
            lengths.append(l)
            total += l
        lengths[-1] -= total - S
        bounds = np.cumsum([0.0] + lengths)
        rel = (xs - offset) % S
        sid = np.clip(np.searchsorted(bounds, rel, side="right") - 1, 0, len(lengths) - 1)
        left = rel - bounds[sid]
        right = bounds[sid + 1] - rel
        dx = np.minimum(left, right)
        rows = np.arange(y0, y1, dtype=np.float32)
        dy = np.minimum(rows - y0, (y1 - 1) - rows)
        d = np.minimum(dx[None, :], dy[:, None])
        inside = smoothstep(joint * 0.5, joint * 1.6, d)
        cols = np.array([palette[r.integers(len(palette))] * r.uniform(0.86, 1.12) for _ in lengths])
        alb[y0:y1] = cols[sid][None, :, :]
        bevel = smoothstep(joint * 0.5, joint * 6, d)
        dome = r.uniform(0.6, 1.0, len(lengths))[sid][None, :]
        height[y0:y1] = inside * (0.6 + 0.4 * bevel * dome)
        alb[y0:y1] *= (0.55 + 0.45 * inside)[..., None]
        y = y1
    rough = fbm(S, 2.5, r, 4)
    alb *= (1 + rough[..., None] * 0.10 + fbm(S, 30, r, 3)[..., None] * 0.05)
    height += rough * 0.35 * (height > 0.3)
    save("stone", alb, normal_map(height, 6.0))


def timber(S=1024):
    """Warm tropical hardwood (ipê/cumarú-like); grain runs along V (image columns)."""
    r = rng_for("timber")
    # aspect (sy, sx): features long along y, very narrow along x -> vertical streaks
    grain = fbm(S, 60, r, 4, aspect=(1.0, 0.025))
    wander = fbm(S, 160, r, 3)
    x = np.arange(S)[None, :] / S
    figure = np.sin(2 * np.pi * (x * 11 + wander * 0.7))
    pores = noise(S, 8, r, aspect=(1.0, 0.05))
    var = grain * 0.16 + figure * 0.06 + (pores > 0.55) * -0.06 + fbm(S, 200, r, 2) * 0.05
    alb = tint("#6E5038", var, (1.0, 0.95, 0.9))
    h = grain * 0.5 + (pores > 0.55) * -0.4
    save("timber", alb, normal_map(h, 1.2), normal_size=512)


def cladding(S=1024):
    """Vertical tongue-and-groove timber cladding: 5 boards of 12 cm per 0.6 m tile."""
    r = rng_for("cladding")
    boards = 5
    x = np.arange(S)[None, :] * boards / S
    bid = np.floor(x).astype(int) % boards
    fx = x - np.floor(x)
    joint = smoothstep(0.0, 0.035, np.minimum(fx, 1 - fx))
    grain = fbm(S, 60, r, 4, aspect=(1.0, 0.025))
    tone = (r.random(boards) - 0.5) * 0.14
    var = np.broadcast_to(tone[bid], (S, S)) + grain * 0.14 + noise(S, 0.6, r, aspect=(1.0, 0.1)) * 0.04
    alb = tint("#634A37", var, (1.0, 0.95, 0.9)) * (0.45 + 0.55 * np.broadcast_to(joint, (S, S)))[..., None]
    h = np.broadcast_to(joint, (S, S)) * 1.0 + grain * 0.2
    save("cladding", alb, normal_map(h, 3.0), normal_size=512)


def deck(S=1024):
    """Decking boards: 8 boards of 13 cm + 1 cm gaps per 1.12 m, along V."""
    r = rng_for("deck")
    boards = 8
    x = np.arange(S)[None, :] * boards / S
    bid = np.floor(x).astype(int) % boards
    fx = x - np.floor(x)
    gap = 0.01 / 0.14
    inb = smoothstep(0.0, gap, np.minimum(fx, 1 - fx))
    grain = fbm(S, 4, r, 4, aspect=(0.03, 1.0))
    tone = (r.random(boards) - 0.5) * 0.16
    var = np.broadcast_to(tone[bid], (S, S)) + grain * 0.16 + noise(S, 0.6, r, aspect=(0.1, 1.0)) * 0.05
    alb = tint("#8A5A38", var) * (0.35 + 0.65 * np.broadcast_to(inb, (S, S)))[..., None]
    h = np.broadcast_to(inb, (S, S)) + grain * 0.3
    save("deck", alb, normal_map(h, 3.0))


def grass(S=1024):
    r = rng_for("grass")
    blades = noise(S, 0.6, r, aspect=(1.0, 0.45))
    clumps = fbm(S, 14, r, 4)
    patches = fbm(S, 120, r, 3)
    dry = smoothstep(0.25, 0.7, fbm(S, 60, r, 3))
    g1, g2, g3 = hex_rgb("#4F6B2C"), hex_rgb("#6E8A38"), hex_rgb("#8C8A4A")
    t = np.clip(0.5 + clumps * 0.6 + blades * 0.35, 0, 1)[..., None]
    alb = g1 * (1 - t) + g2 * t
    alb = alb * (1 - dry[..., None] * 0.35) + g3 * dry[..., None] * 0.35
    alb *= (1 + patches[..., None] * 0.10 + blades[..., None] * 0.10)
    h = blades * 0.7 + clumps * 0.6
    save("grass", alb, normal_map(h, 2.2), normal_size=512)


def soil(S=1024):
    """Red laterite soil typical of Alto Paraná, compacted with scattered stones."""
    r = rng_for("soil")
    base = fbm(S, 40, r, 5)
    fine = noise(S, 0.8, r)
    f1, f2, cid = worley(S, 48, r)
    sizes = r.uniform(0.08, 0.30, 48 * 48)
    keep = r.random(48 * 48) < 0.35
    peb = smoothstep(sizes[cid], sizes[cid] * 0.4, f1) * keep[cid]
    c1, c2, c3 = hex_rgb("#8A4329"), hex_rgb("#A3583A"), hex_rgb("#6E3522")
    t = np.clip(0.5 + base * 0.8, 0, 1)[..., None]
    alb = c1 * (1 - t) + c2 * t
    damp = smoothstep(0.2, 0.6, fbm(S, 90, r, 3))[..., None]
    alb = alb * (1 - damp * 0.3) + c3 * damp * 0.3
    alb *= (1 + fine[..., None] * 0.08)
    pc = hex_rgb("#9C8C7A") * (0.8 + 0.4 * r.random(48 * 48))[cid][..., None]
    alb = alb * (1 - peb[..., None] * 0.7) + pc * peb[..., None] * 0.7
    h = base * 0.5 + fine * 0.3 + peb * 1.0
    save("soil", alb, normal_map(h, 3.0), normal_size=512)


def asphalt(S=1024):
    r = rng_for("asphalt")
    f1, _, cid = worley(S, 160, r)
    agg = smoothstep(0.38, 0.12, f1)
    tone = r.random(160 * 160)[cid]
    base = fbm(S, 50, r, 4)
    alb = tint("#3B3B3D", base * 0.10 + noise(S, 0.7, r) * 0.06)
    stones = (0.35 + 0.35 * tone)[..., None] * np.array([1.0, 0.98, 0.95])
    alb = alb * (1 - agg[..., None] * 0.55) + stones * agg[..., None] * 0.55 * 0.55
    h = agg * 1.0 + noise(S, 0.7, r) * 0.3
    save("asphalt", alb, normal_map(h, 2.5), normal_size=512)


def gravel(S=1024):
    r = rng_for("gravel")
    f1, f2, cid = worley(S, 70, r, jitter=0.95)
    edge = smoothstep(0.0, 0.18, f2 - f1)
    dome = np.clip(1 - f1 * 1.4, 0, 1) * edge
    tone = r.random(70 * 70)[cid]
    cols = np.stack([hex_rgb("#B9B2A6"), hex_rgb("#8F887E"), hex_rgb("#CFC8BB"), hex_rgb("#A39686")])
    pick = (tone * 4).astype(int).clip(0, 3)
    alb = cols[pick] * (0.75 + 0.35 * dome[..., None]) * (0.6 + 0.4 * edge[..., None])
    alb *= (1 + noise(S, 0.8, r)[..., None] * 0.06)
    save("gravel", alb, normal_map(dome * 1.2, 5.0), normal_size=512)


def pavers(S=1024):
    """Large-format concrete slabs 60 x 60 cm with 5 mm joints (4 x 4 per tile)."""
    r = rng_for("pavers")
    n = 4
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) * n / S
    fx, fy = xx - np.floor(xx), yy - np.floor(yy)
    sid = (np.floor(yy).astype(int) % n) * n + (np.floor(xx).astype(int) % n)
    joint = 0.005 / 0.6
    d = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    ins = smoothstep(joint * 0.5, joint * 1.5, d)
    tone = (r.random(n * n) - 0.5) * 0.08
    var = tone[sid] + fbm(S, 25, r, 4) * 0.05 + noise(S, 0.7, r) * 0.04
    alb = tint("#B7B0A4", var) * (0.5 + 0.5 * ins[..., None])
    h = ins + noise(S, 0.8, r) * 0.15
    save("pavers", alb, normal_map(h, 3.0))


def sand(S=512):
    r = rng_for("sand")
    fine = noise(S, 0.6, r)
    ripples = fbm(S, 12, r, 3)
    alb = tint("#C2A27A", fine * 0.08 + ripples * 0.06)
    save("sand", alb, normal_map(fine * 0.5 + ripples, 2.0), normal_size=512)


def plywood(S=512):
    """Phenolic film-faced formwork plywood ('fenólico'), 1.22 x 2.44 m sheets."""
    r = rng_for("plywood")
    x = np.arange(S)[None, :] * 2 / S
    fx = x - np.floor(x)
    seam = 1 - smoothstep(0.0, 0.006, np.minimum(fx, 1 - fx))
    var = fbm(S, 30, r, 4) * 0.10 + noise(S, 1.0, r, aspect=(0.2, 1)) * 0.05 - np.broadcast_to(seam, (S, S)) * 0.3
    alb = tint("#6A3A26", var)
    save("plywood", alb, normal_map(np.broadcast_to(seam, (S, S)) * -1.0 + fbm(S, 3, r, 2) * 0.2, 2.0))


def water_normal(S=512):
    r = rng_for("water")
    h = fbm(S, 10, r, 5, gain=0.55, aspect=(1.0, 0.6))
    n = normal_map(h, 7.0)
    Image.fromarray(np.clip(n * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(OUT / "water_normal.webp", quality=90, method=6)
    print("wrote water_normal")


def macro_variation(S=512):
    """Large-scale (about 200 m per tile) luminance/hue variation for the terrain."""
    r = rng_for("macro")
    a = fbm(S, 30, r, 5)
    b = fbm(S, 12, r, 4)
    c = fbm(S, 60, r, 3)
    img = np.stack([a, b, c], -1) * 0.5 + 0.5
    Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8), "RGB").save(OUT / "macro_variation.webp", quality=90, method=6)
    print("wrote macro_variation")


def tree_textures():
    """Converts the ez-tree bark (Poly Haven, CC0) and leaf cards (ez-tree, MIT) to WebP."""
    if not TREE_SRC.exists():
        print("skip trees: run `npm run vendor` first")
        return
    TREE_OUT.mkdir(parents=True, exist_ok=True)
    for name in ("oak_color_1k", "oak_normal_1k", "willow_color_1k", "willow_normal_1k"):
        im = Image.open(TREE_SRC / f"{name}.jpg").convert("RGB").resize((512, 512), Image.LANCZOS)
        im.save(TREE_OUT / f"bark_{name.replace('_1k', '')}.webp", quality=84, method=6)
    for name in ("oak_color", "ash_color", "aspen_color"):
        im = Image.open(TREE_SRC / f"{name}.png").convert("RGBA").resize((512, 512), Image.LANCZOS)
        im.save(TREE_OUT / f"leaf_{name.replace('_color', '')}.webp", quality=88, method=6)
    print("wrote tree textures")


if __name__ == "__main__":
    plaster(); concrete(); brick(); stone(); timber(); cladding(); deck(); grass(); soil()
    asphalt(); gravel(); pavers(); sand(); plywood(); water_normal(); macro_variation()
    tree_textures()
