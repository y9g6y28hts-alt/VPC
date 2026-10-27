"""Tone-maps a linear EXR render to PNG: exposure, ACES fitted, warmth, contrast.

Shared by render.py and usable on its own to re-grade without re-rendering:
  python3 tools/cinematic/grade.py in.exr out.png [--exposure -1] [--warmth 0.04]
"""
import argparse
import sys

import numpy as np


def load_exr(path):
    import bpy  # noqa: F401 — Blender's image loader reads EXR without extra deps
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3]
    bpy.data.images.remove(img)
    return px


def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)


def grade(rgb, exposure=-1.0, warmth=0.04, contrast=1.06, saturation=1.08, balance=(1.0, 1.0, 1.0), shadow_sat=0.85):
    x = rgb * (2.0 ** exposure)
    # Optional white balance (the render's fill light is already near neutral).
    x = x * np.array(balance, np.float32)
    # Late-afternoon warmth in the highlights only.
    lum = (x * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    t = np.clip(lum / (lum + 0.6), 0, 1)
    x = x * (1 + warmth * t * np.array([1.0, 0.35, -0.9], np.float32))
    m = aces(np.maximum(x, 0))
    lum = (m * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    # Shadows carry less colour than midtones (as on film), highlights keep it.
    sat = shadow_sat + (saturation - shadow_sat) * np.clip(lum / 0.35, 0, 1)
    m = np.clip(lum + (m - lum) * sat, 0, 1)
    m = np.clip(0.5 + (m - 0.5) * contrast, 0, 1)
    return np.where(m <= 0.0031308, 12.92 * m, 1.055 * np.power(m, 1 / 2.4) - 0.055)


def save(srgb, path):
    from PIL import Image

    Image.fromarray((np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--exposure', type=float, default=-1.0)
    ap.add_argument('--warmth', type=float, default=0.04)
    ap.add_argument('--contrast', type=float, default=1.06)
    a = ap.parse_args(sys.argv[1:])
    save(grade(load_exr(a.src), a.exposure, a.warmth, a.contrast), a.dst)
