"""Writes prompts.json (the single source of truth for every prompt/seed/setting).
Edit this table (PICKS = seeds chosen from the contact sheets) and re-run it; it overwrites prompts.json."""
import json, pathlib

M = lambda id_, typ, subject, **kw: dict(id=f"mushroom.{typ}.{id_}", group="mushroom", type=typ, subject=subject, **kw)
D = lambda id_, typ, subject, anchor="center", ws=26, h=144: dict(id=f"decor.{typ}.{id_}", group="decor", type=typ, subject=subject, anchor=anchor, worldSize=ws, height=h)

mushrooms = [
    M(1, "common", "a single lone forest mushroom, side view, domed chestnut brown cap, slender pale stem"),
    M(2, "common", "a single lone forest mushroom, side view, wide flat tan cap, thin cream stem"),
    M(3, "common", "a single lone forest mushroom, side view, convex russet cap, short thick curved stem"),
    M(1, "fly_agaric", "a single lone fly agaric mushroom, side view, red cap with white warts, white stem with ring"),
    M(2, "fly_agaric", "a single lone young fly agaric mushroom, side view, rounded red cap with white warts, bulbous base"),
    M(1, "porcini", "a single lone porcini mushroom, side view, bun-shaped brown cap, thick swollen pale bulbous stem"),
    M(2, "porcini", "a single lone porcini mushroom, side view, wide dark brown cap, short stout cream stem"),
    M(1, "chanterelle", "a single lone chanterelle mushroom, side view, golden yellow funnel-shaped wavy cap, ridges running down the stem"),
    M(2, "chanterelle", "a single lone chanterelle mushroom, side view, apricot yellow wavy cap, tapering stem"),
    M(1, "saffron_milk_cap", "a single lone saffron milk cap mushroom, side view, orange concave cap with concentric rings, short stout stem, standing upright"),
    M(2, "saffron_milk_cap", "a single lone saffron milk cap mushroom, side view, orange funnel cap with darker rings"),
]
for m in mushrooms:
    m.update(anchor="bottom", height=320, worldSize=46 if m["type"] == "common" else 52)

decor = [
    D(1, "acorn", "one oak acorn, glossy brown nut with a textured scaly cap, side view", ws=20, h=128),
    D(2, "acorn", "one acorn standing upright, brown nut in its rough scaly cup", "bottom", 20, 128),
    D(1, "leaf", "one fallen oak leaf, brown autumn colours, lying flat", ws=30, h=160),
    D(2, "leaf", "one fallen birch leaf, yellow, lying flat", ws=24, h=112),
    D(1, "snail", "one garden snail with a spiral shell, side view, crawling", "bottom", 24, 144),
    D(1, "beetle", "one ground beetle, dorsal view, glossy dark body, six legs", ws=22, h=128),
    D(2, "beetle", "one stag beetle, dorsal view, large mandibles, six legs", ws=26, h=144),
    D(1, "seed", "one single sunflower seed, small striped seed, oval", ws=22, h=128),
    D(2, "seed", "one pine cone seed with a thin wing", ws=18, h=112),
    D(1, "twig", "one bare dry fallen twig with a few small side branches, lying horizontally", ws=34, h=112),
    D(1, "pebble", "one smooth rounded pebble with a pale mineral vein", ws=22, h=128),
    D(2, "pebble", "one small angular flint stone, chipped", ws=22, h=128),
    D(1, "bone", "one single long bone, a weathered animal femur with knobbed ends", ws=30, h=128),
    D(1, "shell", "one fossil clam shell, oval bivalve with concentric growth rings", ws=24, h=128),
    D(2, "shell", "one fossil scallop shell, fan shaped with ridges", ws=24, h=128),
    D(1, "potsherd", "one fragment of ancient pottery, potsherd, with a painted pattern", ws=26, h=128),
    D(1, "ammonite", "one fossil ammonite, spiral ribbed shell", ws=28, h=144),
]

NEG = ("beige, cream background, gradient, grass, moss, fern, leaves, twigs, insects, several mushrooms, cluster, group, splatter, stains, ground, soil, "
       "shadow, text, signature, watermark, border, frame, page, photograph, 3d render, cropped")

NEG_EXTRA = {"decor.twig.1": "leaves, foliage", "decor.bone.1": "skull, skeleton, teeth, head", "decor.seed.1": "flower, leaves, insect, wings",
             "decor.acorn.1": "leaves, branch, twig, plate, bowl, stalk, pine cone", "decor.acorn.2": "leaves, branch, plate, bowl, pot, pine cone"}
SEED_SHIFT = {"decor.acorn.1": 50, "decor.acorn.2": 50, "decor.seed.1": 50}  # fresh seeds after a prompt rewrite
for _l in (mushrooms, decor):
    for _i, _a in enumerate(_l):
        _a["seedOffset"] = _i * 100 + SEED_SHIFT.get(_a["id"], 0)
        if _a["id"] in NEG_EXTRA:
            _a["negExtra"] = NEG_EXTRA[_a["id"]]

# Seeds chosen from the contact sheets (id -> (seed, cut overrides)).
PICKS = {
    "decor.acorn.1": (2000, {}), "decor.twig.1": (2902, {}), "decor.bone.1": (3201, {}), "decor.shell.1": (3305, {}),
    "decor.snail.1": (2401, {}), "decor.beetle.1": (2500, {}), "decor.beetle.2": (2600, {}),
    "decor.leaf.1": (2201, {}), "decor.leaf.2": (2303, {}), "decor.seed.2": (2802, {}),
    "decor.pebble.1": (3002, {}), "decor.pebble.2": (3102, {}), "decor.potsherd.1": (3500, {}),
    "decor.ammonite.1": (3602, {}), "decor.shell.2": (3403, {}),
    "mushroom.common.1": (1001, {}),
    "mushroom.common.2": (1103, {"basecut": 0.06}),
    "mushroom.common.3": (1201, {"tol": 11, "soft": 30}),
    "mushroom.fly_agaric.1": (1301, {"basecut": 0.14}),
    "mushroom.fly_agaric.2": (1400, {"basecut": 0.13}),
    "mushroom.porcini.1": (1505, {"basecut": 0.09}),
    "mushroom.porcini.2": (1601, {"basecut": 0.05}),
    "mushroom.chanterelle.1": (1705, {"basecut": 0.20}),
    "mushroom.saffron_milk_cap.1": (1902, {"basecut": 0.07}),
    "mushroom.saffron_milk_cap.2": (2009, {"basecut": 0.05}),
    "mushroom.chanterelle.2": (1811, {"basecut": 0.05}),
}
for _l in (mushrooms, decor):
    for _a in _l:
        if _a["id"] in PICKS:
            _a["picked"] = PICKS[_a["id"]][0]
            if PICKS[_a["id"]][1]:
                _a["cut"] = PICKS[_a["id"]][1]

data = {
    "version": 1,
    "notes": "Single source of truth for generate.py / cutout.py. `picked` = chosen seed per asset (null until chosen). Candidate seeds = seedBase + 0..candidates-1.",
    "model": {"base": "stabilityai/stable-diffusion-xl-base-1.0", "variant": "fp16", "vae": "madebyollin/sdxl-vae-fp16-fix", "lora": None},
    "defaults": {"steps": 28, "guidance": 6.5, "scheduler": "dpmpp_2m_karras", "candidates": 6},
    "styles": {
        "decor": {
            "suffix": "vintage naturalist illustration, fine sepia pen and ink outlines, cross-hatching, delicate watercolor wash, muted colors, single specimen, pure white background",
            "negative": "beige, cream background, gradient, several objects, cluster, group, splatter, stains, ground, soil, grass, shadow, text, signature, watermark, border, frame, page, photograph, 3d render, cropped",
        },
        "specimen": {
            "suffix": "vintage naturalist illustration, fine sepia pen and ink outlines, cross-hatching, delicate watercolor wash, muted colors, single specimen, bare stem base, pure white background",
            "negative": NEG,
        },
        "plate": {
            "suffix": "19th century naturalist atlas plate, scientific cross-section illustration, fine sepia ink linework, cross-hatching, delicate watercolor wash, muted earthy colors, aged paper",
            "negative": "photograph, photo, 3d render, text, letters, numbers, signature, watermark, caption, label, border, frame, blurry, oversaturated, neon, cartoon, anime",
        },
    },
    "sets": {
        "mushrooms": {"style": "specimen", "width": 1024, "height": 1024, "seedBase": 1000, "assets": mushrooms},
        "decor": {"style": "decor", "width": 1024, "height": 1024, "seedBase": 2000, "candidates": 4, "assets": decor},
        "frontispiece": {"style": "plate", "width": 1280, "height": 832, "seedBase": 3000, "candidates": 8, "assets": [dict(
            id="plate.frontispiece", group="plate", type="frontispiece", file="assets/art/frontispiece.webp", target=[1400, None], crop=[0.03, 0.025, 0.97, 0.925], picked=3004, cut=dict(gamma=1.35, sat=0.95, vig0=0.86, vig1=1.03),
            subject="cross-section of a forest floor, three mushrooms and an acorn on the surface, below ground tree roots and pale white mycelium threads branching through the soil, centered composition")]},
    },
}
out = pathlib.Path(__file__).with_name("prompts.json")
out.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
print("wrote", out)
