"""Cut generated illustrations out of their white paper, grade them toward the game palette, trim, downscale, save.

Cut-out = flood fill from the image border by colour distance (connectivity from the border, NOT a global
threshold, so pale watercolour that is enclosed by the outline survives), thin leaks are sealed by a small
opening, soft alpha ramp at the boundary, colour de-fringing, specks removed.

  python tools/artgen/cutout.py --set mushrooms --sheets          # candidate contact sheets (raw + cut-out) for picking
  python tools/artgen/cutout.py --set mushrooms --build           # picked seeds -> assets/art/*.webp + manifest.json
"""
import argparse, json, os, pathlib

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TOOLS = pathlib.Path(os.environ.get("ARTGEN_TOOLS", r"C:\Users\Roman Andreevich\Desktop\test_web_game\test_auto_game\.tools"))
RAW = TOOLS / "raw"
SHEETS = TOOLS / "sheets"
MATTES = TOOLS / "matte"
ISNET = TOOLS / "models" / "isnet-general-use.onnx"

PAPER = np.array([0xEF, 0xE4, 0xCC], np.float32) / 255
INK = np.array([0x3A, 0x2A, 0x1E], np.float32) / 255
SOIL = (0x3F, 0x2C, 0x20)
DEFAULTS = dict(tol=20.0, soft=40.0, sat=0.85, gamma=1.0, speck=0.06, pad=3, sharpen=0.5, holes=False, basecut=0.0, fade=0.06, matte=True, near=10)


def border_color(a, ring=6):
    h, w, _ = a.shape
    px = np.concatenate([a[:ring].reshape(-1, 3), a[-ring:].reshape(-1, 3),
                         a[:, :ring].reshape(-1, 3), a[:, -ring:].reshape(-1, 3)])
    return np.median(px, axis=0)


def bg_field(rgb, ring=6, seg=24):
    """Per-pixel background estimate: medians of border segments, interpolated across the image
    (generated 'white' backgrounds are usually soft gradients with a lighter patch here and there)."""
    h, w, _ = rgb.shape

    def side(strip, n):  # strip: n x ring x 3 -> n x 3 (piecewise-median, interpolated)
        edges = np.linspace(0, n, seg + 1).astype(int)
        mids = (edges[:-1] + edges[1:]) / 2
        meds = np.array([np.median(strip[a:b].reshape(-1, 3), axis=0) for a, b in zip(edges[:-1], edges[1:])])
        return np.stack([np.interp(np.arange(n), mids, meds[:, c]) for c in range(3)], axis=1)

    T, B = side(rgb[:ring].transpose(1, 0, 2), w), side(rgb[-ring:].transpose(1, 0, 2), w)
    L, R = side(rgb[:, :ring], h), side(rgb[:, -ring:], h)
    u = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]
    v = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    tb = T[None, :, :] * (1 - v) + B[None, :, :] * v
    lr = L[:, None, :] * (1 - u) + R[:, None, :] * u
    return ((tb + lr) / 2).astype(np.float32)



_session = None


def salient_mask(path):
    """Salient-object matte (IS-Net general use, ONNX on CPU), cached in <tools>/matte. It tells the colour cut where the
    specimen is, so printed frames, paper vignettes and grey margins around it are never mistaken for the object."""
    global _session
    cache = MATTES / pathlib.Path(path).resolve().relative_to(RAW.resolve())
    if cache.exists():
        return np.asarray(Image.open(cache), np.float32) / 255
    import onnxruntime as ort
    if _session is None:
        _session = ort.InferenceSession(str(ISNET), providers=["CPUExecutionProvider"])
    im = Image.open(path).convert("RGB")
    a = np.asarray(im.resize((1024, 1024), Image.BILINEAR), np.float32)
    a = a / max(a.max(), 1e-6)
    a = (a - np.array([0.485, 0.456, 0.406], np.float32)).transpose(2, 0, 1)[None]
    pred = _session.run(None, {_session.get_inputs()[0].name: a.astype(np.float32)})[0][0, 0]
    pred = (pred - pred.min()) / max(pred.max() - pred.min(), 1e-6)
    m = np.asarray(Image.fromarray((pred * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR), np.float32) / 255
    cache.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((m * 255).astype(np.uint8)).save(cache)
    return m


def grow(mask, px):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0


def local_bg(rgb, obj, sigma=30, margin=14):
    """Paper colour around the specimen: normalised blur of everything that is clearly not the object."""
    w = (~grow(obj, margin)).astype(np.float32)
    num = cv2.GaussianBlur(rgb * w[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(w, (0, 0), sigma)[..., None]
    field = bg_field(rgb)
    return np.where(den > 0.02, num / np.maximum(den, 1e-3), field).astype(np.float32)


def cut_base(alpha, frac, fade):
    """Slice the lowest `frac` of the specimen off (grass, wash splashes around the stem base) and fade the new
    edge out, so the mushroom grows out of the soil it is drawn into."""
    if frac <= 0:
        return alpha
    ys = np.where((alpha > 0.04).any(1))[0]
    y0, y1 = ys.min(), ys.max() + 1
    cut_y = int(round(y1 - frac * (y1 - y0)))
    band = max(2, int(fade * (y1 - y0)))
    ramp = np.ones(alpha.shape[0], np.float32)
    ramp[cut_y:] = 0
    ramp[cut_y - band:cut_y] = np.linspace(1, 0, band, dtype=np.float32)
    return alpha * ramp[:, None]


def cut(rgb, o, matte=None):
    """rgb: float32 HxWx3 in 0..1 -> (straight rgb, alpha) both float32."""
    if matte is not None and (matte > 0.4).sum() > 0.005 * matte.size:
        obj = matte > 0.4
        bg = local_bg(rgb, obj)
        dist = np.sqrt(((rgb - bg) ** 2).sum(-1)) * 255.0
        cand = (dist < o["tol"]) | ~grow(obj, o["near"])  # everything away from the specimen is background
    else:
        bg = bg_field(rgb)
        dist = np.sqrt(((rgb - bg) ** 2).sum(-1)) * 255.0
        cand = dist < o["tol"]
    # open: cuts hairline leaks through gaps of the ink outline, then regrow the boundary (2 px) inside cand
    opened = ndi.binary_erosion(cand, iterations=2, border_value=1)
    lab, n = ndi.label(opened)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge > 0]
    core = np.isin(lab, edge)
    bgreg = ndi.binary_dilation(core, iterations=2) & cand
    if o["holes"]:  # enclosed, near-pure paper regions (loops of twigs, gaps between legs)
        pure = dist < 7
        lab2, n2 = ndi.label(pure & ~bgreg)
        if n2:
            areas = ndi.sum(np.ones_like(lab2), lab2, index=np.arange(1, n2 + 1))
            keep = np.where(areas > 0.01 * rgb.shape[0] * rgb.shape[1])[0] + 1
            bgreg |= np.isin(lab2, keep)
    zone = ndi.binary_dilation(bgreg, iterations=3)
    ramp = np.clip((dist - o["tol"]) / o["soft"], 0, 1)
    alpha = np.where(bgreg, 0.0, np.where(zone, ramp, 1.0)).astype(np.float32)

    alpha = cut_base(alpha, o["basecut"], o["fade"])

    # remove specks and stray blobs, keep the main body (+ pieces that are a sizeable part of it)
    solid = alpha > 0.5
    lab, n = ndi.label(solid, structure=np.ones((3, 3)))
    if n > 1:
        areas = ndi.sum(solid, lab, index=np.arange(1, n + 1))
        keep = np.where(areas >= o["speck"] * areas.max())[0] + 1
        near = ndi.binary_dilation(np.isin(lab, keep), iterations=4)
        alpha = np.where(near, alpha, 0).astype(np.float32)

    # de-fringe: remove the white paper that bleeds through semi-transparent edge pixels
    a3 = np.maximum(alpha, 0.04)[..., None]
    fg = np.clip((rgb - (1 - alpha[..., None]) * bg) / a3, 0, 1)
    fg = np.where(alpha[..., None] < 0.999, fg, rgb)
    return fg.astype(np.float32), alpha


def grade(rgb, o):
    """Ink black -> #3a2a1e, paper white -> #efe4cc, colours muted a little."""
    lum = (rgb * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    rgb = lum + (rgb - lum) * o["sat"]
    rgb = np.clip(rgb, 0, 1) ** o["gamma"]
    return INK + rgb * (PAPER - INK)


def trim_resize(rgb, alpha, height, o):
    ys, xs = np.where(alpha > 0.04)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    p = o["pad"]
    h, w = alpha.shape
    y0, y1, x0, x1 = max(0, y0 - p), min(h, y1 + p), max(0, x0 - p), min(w, x1 + p)
    rgb, alpha = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
    scale = height / alpha.shape[0]
    nw, nh = max(1, round(alpha.shape[1] * scale)), height
    pm = np.dstack([rgb * alpha[..., None], alpha])  # premultiplied resize = no halos
    pm = cv2.resize(pm, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    if o["sharpen"] and scale < 0.6:
        blur = cv2.GaussianBlur(pm, (0, 0), 0.8)
        pm = np.clip(pm + o["sharpen"] * (pm - blur), 0, 1)
    a = np.clip(pm[..., 3], 0, 1)
    pm[..., :3] = np.minimum(pm[..., :3], a[..., None])
    rgb = np.where(a[..., None] > 1e-3, pm[..., :3] / np.maximum(a[..., None], 1e-3), 0)
    return np.clip(rgb, 0, 1), a


def anchor_of(alpha, mode):
    h, w = alpha.shape
    if mode == "center":
        ys, xs = np.mgrid[0:h, 0:w]
        s = alpha.sum()
        return int(round((xs * alpha).sum() / s)), int(round((ys * alpha).sum() / s))
    rows = np.where((alpha > 0.3).any(1))[0]
    bottom = rows.max()
    band = alpha[max(rows.min(), bottom - max(2, int(0.06 * (bottom - rows.min())))): bottom + 1]
    cols = np.arange(w)
    cx = (band.sum(0) * cols).sum() / band.sum()
    return int(round(cx)), int(bottom + 1)


def to_rgba_image(rgb, a):
    out = np.dstack([np.clip(rgb * 255 + 0.5, 0, 255), np.clip(a * 255 + 0.5, 0, 255)]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def process(path, asset, o):
    rgb = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255
    fg, alpha = cut(rgb, o, salient_mask(path) if o["matte"] else None)
    fg = grade(fg, o)
    rgb, a = trim_resize(fg, alpha, asset.get("height", 256), o)
    return rgb, a


def options(asset):
    return {**DEFAULTS, **asset.get("cut", {})}


# ---------------------------------------------------------------- frontispiece

def process_plate(path, asset, o):
    rgb = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255
    bg = border_color(rgb, 12)
    rgb = np.clip(rgb / np.maximum(bg, 1e-3), 0, 1)  # paper -> white
    rgb = grade(rgb, o)  # white -> exact game paper
    h, w = rgb.shape[:2]
    l, t, r, b = asset.get("crop", [0, 0, 1, 1])  # drop the printed frame and inscription of the generated plate
    rgb = rgb[int(t * h):int(b * h), int(l * w):int(r * w)]
    h, w = rgb.shape[:2]
    tw = asset["target"][0]
    th = round(h * tw / w)
    rgb = cv2.resize(rgb, (tw, th), interpolation=cv2.INTER_CUBIC if tw > w else cv2.INTER_AREA)
    # vignette (rounded square, ragged watercolour edge) fading to transparent
    yy, xx = np.mgrid[0:th, 0:tw].astype(np.float32)
    x, y = (xx / tw - 0.5) * 2, (yy / th - 0.5) * 2
    rr = (np.abs(x) ** 3.5 + np.abs(y) ** 3.5) ** (1 / 3.5)
    rng = np.random.default_rng(7)
    noise = cv2.GaussianBlur(rng.standard_normal((th, tw)).astype(np.float32), (0, 0), 28)
    noise = noise / (np.abs(noise).max() + 1e-6)
    fine = cv2.GaussianBlur(rng.standard_normal((th, tw)).astype(np.float32), (0, 0), 4)
    fine = fine / (np.abs(fine).max() + 1e-6)
    rr = rr + 0.06 * noise + 0.02 * fine
    v0, v1 = o.get("vig0", 0.80), o.get("vig1", 1.0)
    t_ = np.clip((rr - v0) / (v1 - v0), 0, 1)
    alpha = 1 - t_ * t_ * (3 - 2 * t_)
    return np.clip(rgb, 0, 1), alpha.astype(np.float32)


# ---------------------------------------------------------------- sheets / build

def font(size=14):
    for f in ("arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def candidates(set_name, asset):
    d = RAW / set_name / asset["id"]
    return sorted(d.glob("*.png"), key=lambda p: int(p.stem)) if d.exists() else []


def composite_cell(img, cw, ch, bgcol):
    cell = Image.new("RGB", (cw, ch), bgcol)
    k = min((cw - 8) / img.width, (ch - 8) / img.height)
    im = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)
    cell.paste(im, ((cw - im.width) // 2, (ch - im.height) // 2), im if im.mode == "RGBA" else None)
    return cell


def make_sheets(set_name, st, only, per_page=3):
    SHEETS.mkdir(parents=True, exist_ok=True)
    cw, ch = 250, 300
    f = font(14)
    plate = st["assets"][0].get("group") == "plate"
    rows = []
    for a in st["assets"]:
        if only and a["id"] not in only:
            continue
        cands = candidates(set_name, a)
        if not cands:
            continue
        o = options(a)
        raw_cells, cut_cells = [], []
        for p in cands:
            raw = Image.open(p).convert("RGB")
            if plate:
                rgb, al = process_plate(p, a, o)
                cut = to_rgba_image(rgb, al)
            else:
                a2 = dict(a, height=min(a.get("height", 256), 320))
                rgb, al = process(p, a2, o)
                cut = to_rgba_image(rgb, al)
            rc = composite_cell(raw, cw, ch, (255, 255, 255))
            cc = Image.new("RGB", (cw, ch))
            cc.paste(composite_cell(cut, cw // 2, ch, (0xEF, 0xE4, 0xCC)), (0, 0))
            cc.paste(composite_cell(cut, cw - cw // 2, ch, SOIL), (cw // 2, 0))
            for c, name in ((rc, p.stem), (cc, p.stem)):
                ImageDraw.Draw(c).text((6, 4), name, fill=(200, 0, 0), font=f)
            raw_cells.append(rc)
            cut_cells.append(cc)
        row = Image.new("RGB", (cw * len(cands), ch * 2 + 22), (30, 30, 30))
        ImageDraw.Draw(row).text((6, 3), a["id"], fill=(255, 255, 255), font=font(15))
        for i, (r_, c_) in enumerate(zip(raw_cells, cut_cells)):
            row.paste(r_, (i * cw, 22))
            row.paste(c_, (i * cw, 22 + ch))
        rows.append((a["id"], row))
    pages = []
    for i in range(0, len(rows), per_page):
        chunk = rows[i:i + per_page]
        W = max(r.width for _, r in chunk)
        page = Image.new("RGB", (W, sum(r.height for _, r in chunk)), (30, 30, 30))
        y = 0
        for _, r in chunk:
            page.paste(r, (0, y))
            y += r.height
        out = SHEETS / f"{set_name}-{i // per_page + 1}.png"
        page.save(out)
        pages.append(out)
        print("sheet:", out, [n for n, _ in chunk])
    return pages


def build(set_name, st, only):
    manifest_path = ROOT / "assets" / "art" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"version": 1, "assets": []}
    by_id = {a["id"]: a for a in manifest["assets"]}
    for a in st["assets"]:
        if only and a["id"] not in only:
            continue
        if a.get("picked") is None:
            print("skip (no picked seed):", a["id"])
            continue
        src = RAW / set_name / a["id"] / f"{a['picked']}.png"
        if not src.exists():
            print("missing raw image (run generate.py --picked):", src)
            continue
        o = options(a)
        if a["group"] == "plate":
            rgb, al = process_plate(src, a, o)
            rel = a["file"]
            anchor = {"x": rgb.shape[1] // 2, "y": rgb.shape[0] // 2}
            world = a.get("worldSize", 1080)
        else:
            rgb, al = process(src, a, o)
            rel = f"assets/art/{a['group']}/{a['id'].split('.', 1)[1]}.webp"
            x, y = anchor_of(al, a.get("anchor", "bottom"))
            anchor = {"x": x, "y": y}
            world = a.get("worldSize", 32)
        out = ROOT / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        to_rgba_image(rgb, al).save(out, "WEBP", quality=o.get("quality", 90), method=6, exact=False)
        by_id[a["id"]] = dict(id=a["id"], group=a["group"], type=a["type"], file=rel,
                              w=rgb.shape[1], h=rgb.shape[0], anchor=anchor, worldSize=world)
        print(f"{a['id']}: {rgb.shape[1]}x{rgb.shape[0]} anchor {anchor} -> {rel} ({out.stat().st_size // 1024} KB)")
    order = {"plate": 0, "mushroom": 1, "decor": 2, "tree": 3}
    manifest["assets"] = sorted(by_id.values(), key=lambda a: (order.get(a["group"], 9), a["id"]))
    manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True)
    ap.add_argument("--only")
    ap.add_argument("--sheets", action="store_true")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--per-page", type=int, default=3)
    args = ap.parse_args()
    cfg = json.loads((HERE / "prompts.json").read_text(encoding="utf-8"))
    st = cfg["sets"][args.set]
    only = set(args.only.split(",")) if args.only else None
    if args.sheets:
        make_sheets(args.set, st, only, args.per_page)
    if args.build:
        build(args.set, st, only)


if __name__ == "__main__":
    main()
