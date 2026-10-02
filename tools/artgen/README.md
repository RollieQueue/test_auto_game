# artgen — local illustration pipeline («Корни и нити»)

Generate → cut out → grade → manifest. Everything runs locally on the GPU; nothing is installed system-wide.

```
prompts.json ──generate.py──▶ .tools/raw/<set>/<asset id>/<seed>.png      (raw candidates, git-ignored)
                 cutout.py --sheets ──▶ .tools/sheets/<set>-N.png            (contact sheets: raw + cut-out on paper / soil)
                 (look, pick the best seed, write it into prompts.json "picked")
                 cutout.py --build ──▶ assets/art/<group>/*.webp + manifest.json
assets/art/gallery.html shows the result on warm paper and on dark soil.
```

## Where things live (isolation)

| What | Where |
| --- | --- |
| venv, model weights, caches | `<main project>\.tools\` (git-ignored): `artgen-venv`, `hf` (HF_HOME), `torch` (TORCH_HOME), `raw`, `sheets` |
| scripts, prompts, README | `tools/artgen/` |
| final images, manifest, gallery | `assets/art/` |

`_env.ps1` sets `HF_HOME`, `TORCH_HOME`, `PIP_CACHE_DIR`, `HF_HUB_DISABLE_TELEMETRY`, `PYTHONNOUSERSITE` and the venv path for every command.
The default tools folder is the main checkout's `.tools` (so it survives git worktrees); override with `ARTGEN_TOOLS`.
Nothing is written to `%USERPROFILE%\.cache`, the user site, the registry or PATH.

## Set up from scratch (once, ~30 min, mostly downloads)

```powershell
powershell -ExecutionPolicy Bypass -File tools\artgen\setup.ps1      # venv + torch (CUDA 12.6) + diffusers & friends
tools\artgen\artgen.bat download.py                                   # SDXL base fp16 (~7 GB) + fp16-fix VAE into .tools\hf
```

Requirements: Python 3.11 (`-Base D:\anaconda\python.exe` by default), NVIDIA GPU with ≥ 8 GB, ~15 GB disk.
Pins that matter on this machine (RTX 4060 Laptop 8 GB, 16 GB RAM, Windows 10):

* `torch==2.7.1+cu126` — torch 2.14.1 fails with `WinError 1114` on `c10.dll` here.
* no `sentencepiece` — its wheel crashes the interpreter on import (access violation) and SDXL does not need it.
* after setup you can delete `.tools\pip-cache` (a fresh `setup.ps1` re-creates it) — it is several GB of wheels.

## Generating

```powershell
tools\artgen\artgen.bat generate.py --set mushrooms                   # every candidate of the set (existing files are skipped)
tools\artgen\artgen.bat generate.py --set decor --only decor.acorn.1 --candidates 8
tools\artgen\artgen.bat generate.py --set mushrooms --picked          # regenerate only the picked seeds (e.g. on a new machine)
tools\artgen\artgen.bat cutout.py --set mushrooms --sheets            # contact sheets for picking
tools\artgen\artgen.bat cutout.py --set mushrooms --build             # picked seeds -> assets/art + manifest.json
tools\artgen\run_all.ps1 mushrooms decor frontispiece                 # generate + sheets for several sets
```

Model: **SDXL base 1.0, fp16** (+ `madebyollin/sdxl-vae-fp16-fix`, MIT, avoids black images from the fp16 VAE), DPM++ 2M Karras, 28 steps, CFG 6.5,
1024×1024 (frontispiece 1280×832). Licence: CreativeML Open RAIL++-M (outputs are free to use).
Why SDXL base: it already knows the 19th-century atlas look, fits 8 GB in fp16 without quantisation and has no gating.

Memory plan (this is what made it fast): stage 1 loads *only* the text encoders, encodes all prompts of the run, frees them;
stage 2 keeps UNet + VAE fully on the GPU. `enable_model_cpu_offload()` thrashed (140–190 s/image) on 16 GB RAM; this takes ~20–30 s/image.

Timing (RTX 4060 Laptop): model load ≈ 2.5 min + text encoding ≈ 35 s once per run; **≈ 20–30 s per 1024² image** (28 steps, ~1.7 it/s).

## Prompts and seeds

`prompts.json` is the record of every setting: model, steps/CFG, the shared style suffix + negative prompt (`styles`), per-set canvas size and
`seedBase`, per asset the `subject`, `anchor` mode, target `height`, `worldSize`, optional `cut` overrides and the **`picked` seed**.
Candidate seeds are `seedBase + 0 … candidates-1`. `make_prompts.py` is the table that writes `prompts.json` (it keeps existing `picked` values).
CLIP reads 77 tokens: put the subject first and keep subject + style short (generate.py warns when a prompt is truncated).

## Cut-out (cutout.py)

1. Background colour = median of the image border; colour distance to it per pixel.
2. Flood fill **from the border** over `distance < tol` (connectivity, not a global threshold: pale watercolour enclosed by the outline survives);
   a 2 px opening seals hairline gaps in the ink outline so the fill cannot leak inside.
3. Soft alpha ramp (`tol … tol+soft`) next to the removed background; colour de-fringing (`(I − (1−α)·bg)/α`) removes the white halo.
4. Specks/stray blobs smaller than 4 % of the main body are removed.
5. Optional per-asset `cut` options: `basecut` (slice off the lowest fraction — grass and wash splashes around the stem — and fade the edge so the
   mushroom grows out of the soil), `holes` (also remove enclosed pure-paper holes), `tol`, `soft`, `sat`.
6. Grade: ink black → `#3a2a1e`, paper white → `#efe4cc`, colours muted 15 %. Trim to content (+3 px), premultiplied area downscale, light sharpen, WebP q90.
7. Anchor: `bottom` = centre of the lowest rows (stipe base), `center` = alpha centroid (decor that the game rotates).
8. Frontispiece: paper tone is normalised to `#efe4cc`, then a ragged elliptical vignette fades the alpha to 0 at the edges.

## Adding an asset

Add a line in `make_prompts.py` (`M(...)` mushroom / `D(...)` decor), run `make_prompts.py`, generate with `--only <id>`, look at the sheet,
set `"picked": <seed>` in `prompts.json` (and a `cut` override if needed), then `cutout.py --set <set> --build --only <id>`.
Open `assets/art/gallery.html` (`node tools/serve.mjs --port 5177 --no-open`, then `http://127.0.0.1:5177/assets/art/gallery.html`).

## Disk

See the final size in the task report; roughly: venv 6–7 GB (torch CUDA), SDXL fp16 + VAE 7 GB, raw candidates ~1 MB each.
`assets/art` stays under 10 MB.

## Atlas plates (`--set plates`)

One naturalist plate per find kind (`assets/art/plate/<kind>.webp`, group `plate`, type = kind), shown on the atlas full-screen card
(`plateByKind()` in `src/ui/atlas-logic.js`). Style `naturalist` (no text/frame in the prompt, text is garbage in SDXL), 1024² raw,
cropped (`crop`, drops printed frames/captions), paper normalised to `#f3eddc` (`cut.paper`: the card's `mix-blend-mode: multiply`
over its cream frame hides the paper), ragged vignette on the corners, WebP ≤ `cut.maxkb` (90 KB; quality is lowered until it fits).
Picks live in `make_prompts.py` (`PLATE_PICKS`, `PLATE_CROP`, `PLATE_SHIFT` = fresh seeds after a prompt rewrite).
`cutout.py --sheets --fresh` shows only the seeds of the current prompt (older seeds stay in `.tools/raw`).

## Known gaps

* `decor.seed.1`: SDXL turns "winged seed" into insects/feathers; the pick (2772) is a leaf-like winged seed, not a pine samara. The `seed` plate shows a Scots pine twig with a cone and loose seeds instead.
* Plate subjects ignore "small detail view beside it" most of the time (acorn, pine have one). ART-3 redo: `pebble` (several river pebbles with bands/veins) and `potsherd` (terracotta shard with incised lines and dots) now read right; `bone` is a small-mammal skull with lower jaw and incisors (SDXL keeps drawing human skulls or live mice for "vole"; seed 5883 of the first round was the only convincing one).
* Pine samara (`decor.seed.3`) was tried in three prompt rounds (24 seeds): SDXL draws fans, oars, pods and pine twigs, never a seed with one wing. Not delivered.
* Trees (stretch goal) were not generated.

## Rival set (`--set rival`, ART-3)

`decor.stump.1` (anchor `bottommid` = horizontal middle of the silhouette at the lowest row, worldSize 70 = height), `mushroom.honey.1/2` (anchor `bottom`, worldSize 50).
An asset may carry its own `style` (generate.py): the rival styles `stump` / `tuft` drop the moss / ground / cluster negatives of `decor` / `specimen`.
Cut option `holes` with `hole_dist` (colour distance, default 7) and `hole_area` (fraction of the image, default 0.01) removes paper that is enclosed between stems and roots;
tufts need `hole_dist` ~20 and `hole_area` ~0.0015, otherwise a cream backing shows on dark soil.
