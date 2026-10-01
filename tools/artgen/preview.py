"""Composite one finished asset on paper and soil for a quick look: preview.py assets/art/frontispiece.webp out.png"""
import sys
from PIL import Image

im = Image.open(sys.argv[1]).convert("RGBA")
w, h = im.size
out = Image.new("RGB", (w, h * 2))
for i, col in enumerate(((0xEF, 0xE4, 0xCC), (0x3F, 0x2C, 0x20))):
    bg = Image.new("RGBA", im.size, col + (255,))
    bg.alpha_composite(im)
    out.paste(bg.convert("RGB"), (0, i * h))
out.save(sys.argv[2])
