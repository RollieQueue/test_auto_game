"""Cuts the paper-coloured rim off finished cut-outs (assets/art/<group>/*.webp), in place.

cutout.py removes the paper that bleeds through half-transparent edge pixels, but a thin sliver of the sheet itself can
survive the cut as a solid cream line along a cap (a light halo on grass or soil). This pass looks only at the outer
RIM px of the silhouette: a rim pixel that is paper-coloured, much lighter than the nearest body colour further in,
takes that body colour. White stalks and dark ink outlines are not touched (no lighter-than-the-body paper there).
Alpha and size stay as they are, so the manifest anchors stay valid. Safe to run twice.

  python tools/artgen/defringe.py                      # every mushroom
  python tools/artgen/defringe.py --group decor --dry  # report only
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
PAPER = np.array([239, 228, 204], np.float32)  # cutout.py PAPER (#efe4cc)
RIM = 5          # px from the outside that count as the rim
LIGHTER = 14.0   # a rim pixel must beat the body colour behind it by this much luminance to be paper
STEP = 18.0      # luminance a pixel next to a repainted one must beat the body by to follow it
NEAR_PAPER = 90.0  # ... and lie this close (RGB distance) to the sheet colour


def lum(rgb):
    return rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11


def defringe(rgba):
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3].astype(np.float32) / 255
    solid = alpha > 0.5
    depth = ndi.distance_transform_edt(solid)  # 0 outside, 1 on the outermost solid px
    body = solid & (depth > RIM)
    if not body.any():
        return rgba, 0
    _, idx = ndi.distance_transform_edt(~body, return_indices=True)
    inner = rgb[idx[0], idx[1]]  # the nearest body colour behind every pixel
    rim = (alpha > 0) & (depth <= RIM)
    paper = np.sqrt(((rgb - PAPER) ** 2).sum(-1)) < NEAR_PAPER
    lighter = lum(rgb) - lum(inner)
    bad = rim & paper & (lighter > LIGHTER)
    for _ in range(2):  # the soft step between a paper pixel and the ink: lighter than the body and touching a paper pixel
        bad |= ndi.binary_dilation(bad) & rim & (lighter > STEP)
    out = rgba.copy()
    out[..., :3][bad] = np.clip(inner[bad] + 0.5, 0, 255).astype(np.uint8)
    return out, int(bad.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--group', default='mushroom')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--quality', type=int, default=94)
    args = ap.parse_args()
    for f in sorted((ROOT / 'assets' / 'art' / args.group).glob('*.webp')):
        rgba = np.array(Image.open(f).convert('RGBA'))
        out, n = defringe(rgba)
        print(f'{f.name}: {n} rim px repainted')
        if n and not args.dry:
            Image.fromarray(out, 'RGBA').save(f, 'WEBP', quality=args.quality, method=6, exact=False)


if __name__ == '__main__':
    main()
