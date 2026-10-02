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
    M(1, "chanterelle", "a single chanterelle mushroom, side view, golden yellow wavy funnel-shaped cap with a lobed rim, forked blunt ridges running down the stem"),
    M(2, "chanterelle", "a single chanterelle mushroom, side view, apricot yellow trumpet-shaped cap with a wavy rim, false gills forking down a tapering stem"),
    M(1, "saffron_milk_cap", "a single lone saffron milk cap mushroom, side view, orange concave cap with concentric rings, short stout stem, standing upright"),
    M(2, "saffron_milk_cap", "a single lone saffron milk cap mushroom, side view, orange funnel cap with darker rings"),
]
for m in mushrooms:
    m.update(anchor="bottom", height=320, worldSize=46 if m["type"] == "common" else 52)

decor = [
    D(1, "acorn", "one oak acorn, glossy brown nut with a textured scaly cap, side view", ws=20, h=128),
    D(2, "acorn", "a single acorn nut sitting in its scaly cup, glossy brown nut, standing upright, nothing else", "bottom", 20, 128),
    D(1, "leaf", "one fallen oak leaf, brown autumn colours, lying flat", ws=30, h=160),
    D(2, "leaf", "one fallen birch leaf, yellow, lying flat", ws=24, h=112),
    D(1, "snail", "one garden snail with a spiral shell, side view, crawling", "bottom", 24, 144),
    D(1, "beetle", "one ground beetle, dorsal view, glossy dark body, six legs", ws=22, h=128),
    D(2, "beetle", "one stag beetle, dorsal view, large mandibles, six legs", ws=26, h=144),
    D(1, "seed", "one winged seed, a small round brown seed with a single wide translucent papery wing, like a maple key, helicopter seed", ws=22, h=128),
    D(2, "seed", "one pine cone seed with a thin wing", ws=18, h=112),
    D(1, "twig", "one bare dry fallen twig with a few small side branches, lying horizontally", ws=34, h=112),
    D(1, "pebble", "one smooth rounded pebble with a pale mineral vein", ws=22, h=128),
    D(2, "pebble", "one small angular flint stone, chipped", ws=22, h=128),
    D(1, "bone", "one single long bone, a weathered animal femur with knobbed ends", ws=30, h=128),
    D(1, "shell", "one empty pale garden snail shell, spiral coil with a round opening, side view, no animal", ws=24, h=128),
    D(2, "shell", "one fossil scallop shell, fan shaped with ridges", ws=24, h=128),
    D(1, "potsherd", "one fragment of ancient pottery, potsherd, with a painted pattern", ws=26, h=128),
    D(1, "ammonite", "one fossil ammonite, spiral ribbed shell", ws=28, h=144),
]

NEG = ("beige, cream background, gradient, grass, moss, fern, leaves, twigs, insects, several mushrooms, cluster, group, splatter, stains, ground, soil, "
       "shadow, text, signature, watermark, border, frame, page, photograph, 3d render, cropped")

NEG_EXTRA = {"decor.twig.1": "leaves, foliage", "decor.bone.1": "skull, skeleton, teeth, head", "decor.seed.1": "feather, plume, fluff, hair, dandelion, bird, insect, flower, leaves, branch, several seeds",
             "decor.acorn.1": "leaves, branch, twig, plate, bowl, stalk, pine cone", "decor.acorn.2": "leaves, oak leaf, branch, twig, plate, bowl, pot, pine cone, several acorns",
             "mushroom.chanterelle.1": "bolete, fly agaric, round dome cap, flat cap, pores, ring, collar, grass",
             "mushroom.chanterelle.2": "bolete, fly agaric, round dome cap, flat cap, pores, ring, collar, grass",
             "decor.shell.1": "mushroom, fungus, bracket, clam, scallop, snail body, tentacles, foot"}
SEED_SHIFT = {"decor.acorn.1": 50, "decor.acorn.2": 60, "decor.seed.1": 70, "decor.shell.1": 60, "mushroom.chanterelle.1": 60, "mushroom.chanterelle.2": 60}  # fresh seeds after a prompt rewrite
for _l in (mushrooms, decor):
    for _i, _a in enumerate(_l):
        _a["seedOffset"] = _i * 100 + SEED_SHIFT.get(_a["id"], 0)
        if _a["id"] in NEG_EXTRA:
            _a["negExtra"] = NEG_EXTRA[_a["id"]]

# Seeds chosen from the contact sheets (id -> (seed, cut overrides)).
PICKS = {
    "decor.acorn.1": (2000, {}), "decor.twig.1": (2902, {}), "decor.bone.1": (3201, {}), "decor.shell.1": (3366, {}),
    "decor.snail.1": (2401, {}), "decor.beetle.1": (2500, {}), "decor.beetle.2": (2600, {}),
    "decor.leaf.1": (2201, {}), "decor.leaf.2": (2303, {}), "decor.seed.2": (2802, {}),
    "decor.pebble.1": (3002, {}), "decor.pebble.2": (3102, {}), "decor.potsherd.1": (3500, {}),
    "decor.ammonite.1": (3602, {}), "decor.shell.2": (3403, {}),
    "decor.seed.1": (2772, {}),
    "decor.acorn.2": (2160, {"basecut": 0.04}),
    "mushroom.common.1": (1001, {}),
    "mushroom.common.2": (1103, {"basecut": 0.06}),
    "mushroom.common.3": (1201, {"tol": 11, "soft": 30}),
    "mushroom.fly_agaric.1": (1301, {"basecut": 0.14}),
    "mushroom.fly_agaric.2": (1400, {"basecut": 0.13}),
    "mushroom.porcini.1": (1505, {"basecut": 0.09}),
    "mushroom.porcini.2": (1601, {"basecut": 0.05}),
    "mushroom.chanterelle.1": (1766, {"basecut": 0.03}),
    "mushroom.saffron_milk_cap.1": (1902, {"basecut": 0.07}),
    "mushroom.saffron_milk_cap.2": (2009, {"basecut": 0.05}),
    "mushroom.chanterelle.2": (1861, {"basecut": 0.03}),
}
for _l in (mushrooms, decor):
    for _a in _l:
        if _a["id"] in PICKS:
            _a["picked"] = PICKS[_a["id"]][0]
            if PICKS[_a["id"]][1]:
                _a["cut"] = PICKS[_a["id"]][1]

# One naturalist plate per find kind (atlas full-screen card). Subject first (CLIP reads 77 tokens), the specimen large and centred, one small detail view beside it.
PL = lambda kind, subject, **kw: dict(id=f"plate.{kind}", group="plate", type=kind, file=f"assets/art/plate/{kind}.webp", target=[768, None],
                                       crop=[0.05, 0.05, 0.95, 0.93], subject=subject, cut=dict(gamma=1.25, sat=0.9, vig0=0.97, vig1=1.1, paper="#f3eddc", maxkb=90), **kw)
plates = [
    PL("acorn", "oak acorn, a glossy nut in a scaly cup, one large specimen in the middle, a small cross-section of an acorn beside it"),
    PL("leaf", "a fallen oak leaf with brown veins, one large specimen in the middle, a small detail of leaf veins beside it"),
    PL("twig", "a dry bare twig with side shoots and bark, one large specimen in the middle, a small cross-section of the wood beside it"),
    PL("seed", "a pair of maple samara seed keys, round brown seeds with long papery wings, one large specimen in the middle, a small single seed beside it"),
    PL("snail", "a garden snail with a banded spiral shell, side view, one large specimen in the middle, a small view of the shell from above beside it"),
    PL("beetle", "a ground beetle, glossy dark body, six legs, dorsal view, one large specimen in the middle, a small head and antenna detail beside it"),
    PL("pebble", "mineralogy plate, three river pebbles of different shapes with white quartz veins and mineral bands, seen from several sides, grey and ochre stone"),
    PL("bone", "zoology plate, tiny skull of a field mouse, long flat snout, two large incisor teeth, lower jaw bone, side view, one skull in the middle, two small jaw bones beside it"),
    PL("shell", "an empty land snail shell, round glossy whorls, aperture with a thin lip, three-quarter view, one large specimen in the middle, a small view from above beside it"),
    PL("potsherd", "a curved clay pot shard with a thick rough broken edge, orange terracotta, incised herringbone lines and a row of dots, shown from outside and in profile, museum catalogue drawing"),
    PL("ammonite", "a fossil ammonite, ribbed spiral shell, one large specimen in the middle, a small cross-section of the spiral beside it"),
]
PLATE_NEG = {"plate.seed": "butterfly, moth, insect, wings of an insect, leaf, feather, cone, needles", "plate.pebble": "cross, relief, carving, engraving, slab, platform, base, egg, bird, eggs, nest, gem, crystal",
             "plate.bone": "human skull, big round skull, brain case, ape, long bone, femur, skeleton, bird, vase, column, funnel, tool, mushroom, branch, wood, horn", "plate.shell": "animal, body, tentacles, nautilus, fossil, ammonite",
             "plate.potsherd": "whole pot, vase, jar, bowl, plate, dish, disc, complete vessel, handle, parchment, paper, scroll, map, manuscript, leaf, tiles, mosaic"}
PLATE_SHIFT = {k: 40 for k in PLATE_NEG}
PLATE_SHIFT.update({"plate.seed": 80})  # fresh seeds after a prompt rewrite; the first round's picks stay valid by seed
PLATE_SHIFT.update({"plate.pebble": 120, "plate.bone": 280, "plate.potsherd": 220})  # ART-3: new seeds for the redo of the three weak plates
for _i, _a in enumerate(plates):
    _a["seedOffset"] = _i * 100 + PLATE_SHIFT.get(_a["id"], 0)
    if _a["id"] in PLATE_NEG:
        _a["negExtra"] = PLATE_NEG[_a["id"]]
        _a["candidates"] = 8
PLATE_CROP = {"plate.bone": [0.04, 0.03, 0.96, 0.88], "plate.potsherd": [0.05, 0.05, 0.95, 0.90], "plate.beetle": [0.05, 0.02, 0.95, 0.94], "plate.ammonite": [0.03, 0.03, 0.99, 0.95]}
for _a in plates:
    if _a["id"] in PLATE_CROP:
        _a["crop"] = PLATE_CROP[_a["id"]]
PLATE_PICKS = {"plate.seed": 5303, "plate.bone": 5883, "plate.acorn": 5003, "plate.leaf": 5101, "plate.twig": 5205, "plate.snail": 5402, "plate.beetle": 5501, "plate.pebble": 5721, "plate.shell": 5847, "plate.potsherd": 6127, "plate.ammonite": 6001}
for _a in plates:
    if PLATE_PICKS.get(_a["id"]) is not None:
        _a["picked"] = PLATE_PICKS[_a["id"]]

# ART-3: the honey-fungus rival (old stump + two honey-fungus tufts) and a pine samara. Own set so its styles may allow moss / clusters.
rival = [
    dict(id="decor.stump.1", group="decor", type="stump", style="stump", anchor="bottommid", worldSize=70, height=256, seedOffset=400,
         negExtra="forest, trees, landscape, background scenery, table, soil, ground, pedestal",
         subject="an old sawn tree stump covered in green moss, flat top with growth rings, weathered bark, gnarled roots spreading at the base, side view"),
    dict(id="mushroom.honey.1", group="mushroom", type="honey", style="tuft", anchor="bottom", worldSize=50, height=320, seedOffset=100,
         subject="a tuft of honey fungus Armillaria mellea, honey-brown caps with dark scales, pale gills, ring on the stem, stems fused at the base, side view"),
    dict(id="mushroom.honey.2", group="mushroom", type="honey", style="tuft", anchor="bottom", worldSize=50, height=320, seedOffset=200,
         subject="a young bunch of honey mushrooms, rounded honey-yellow scaly caps, slender stems with a ring, clustered and joined at the base, side view"),
    # decor.seed.3 (Scots pine samara) was tried with 3 prompt rounds x 8 seeds: SDXL draws fans/oars/pods, never a seed with one wing -> dropped.
]

HOLES = {"holes": True, "hole_dist": 20, "hole_area": 0.0015}  # paper enclosed between stems / roots becomes transparent
RIVAL_PICKS = {"decor.stump.1": (6405, {**HOLES, "hole_dist": 16, "tol": 28, "soft": 30, "basecut": 0.04}),
               "mushroom.honey.1": (6104, {**HOLES, "basecut": 0.12}), "mushroom.honey.2": (6200, HOLES)}
for _a in rival:
    if _a["id"] in RIVAL_PICKS:
        _a["picked"] = RIVAL_PICKS[_a["id"]][0]
        if RIVAL_PICKS[_a["id"]][1]:
            _a["cut"] = RIVAL_PICKS[_a["id"]][1]

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
        "naturalist": {
            "suffix": "19th century naturalist atlas plate, fine sepia ink linework, cross-hatching, soft watercolor wash, muted earthy colors, plain cream paper",
            "negative": "text, letters, words, numbers, captions, labels, signature, watermark, border, frame, photograph, 3d render, cartoon, anime, oversaturated, several specimens, grid, collage, ground, soil, hands",
        },
        "stump": {
            "suffix": "vintage naturalist illustration, fine sepia pen and ink outlines, cross-hatching, delicate watercolor wash, muted colors, single specimen, pure white background",
            "negative": "beige, cream background, gradient, several objects, splatter, stains, grass, flowers, mushrooms, tree trunk, branches, leaves, shadow, text, signature, watermark, border, frame, page, photograph, 3d render, cropped",
        },
        "tuft": {
            "suffix": "vintage naturalist illustration, fine sepia pen and ink outlines, cross-hatching, delicate watercolor wash, muted colors, bare stem base, pure white background",
            "negative": "beige, cream background, gradient, grass, moss, fern, leaves, twigs, insects, splatter, stains, ground, soil, shadow, wood, log, bark, text, signature, watermark, border, frame, page, photograph, 3d render, cropped",
        },
        "plate": {
            "suffix": "19th century naturalist atlas plate, scientific cross-section illustration, fine sepia ink linework, cross-hatching, delicate watercolor wash, muted earthy colors, aged paper",
            "negative": "photograph, photo, 3d render, text, letters, numbers, signature, watermark, caption, label, border, frame, blurry, oversaturated, neon, cartoon, anime",
        },
    },
    "sets": {
        "mushrooms": {"style": "specimen", "width": 1024, "height": 1024, "seedBase": 1000, "assets": mushrooms},
        "decor": {"style": "decor", "width": 1024, "height": 1024, "seedBase": 2000, "candidates": 4, "assets": decor},
        "rival": {"style": "decor", "width": 1024, "height": 1024, "seedBase": 6000, "candidates": 8, "assets": rival},
        "plates": {"style": "naturalist", "width": 1024, "height": 1024, "seedBase": 5000, "candidates": 6, "assets": plates},
        "frontispiece": {"style": "plate", "width": 1280, "height": 832, "seedBase": 3000, "candidates": 8, "assets": [dict(
            id="plate.frontispiece", group="plate", type="frontispiece", file="assets/art/frontispiece.webp", target=[1400, None], crop=[0.03, 0.025, 0.97, 0.925], picked=3004, cut=dict(gamma=1.35, sat=0.95, vig0=0.86, vig1=1.03),
            subject="cross-section of a forest floor, three mushrooms and an acorn on the surface, below ground tree roots and pale white mycelium threads branching through the soil, centered composition")]},
    },
}
out = pathlib.Path(__file__).with_name("prompts.json")
out.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
print("wrote", out)
