"""Generate raw candidate illustrations with SDXL (fp16) from prompts.json.

  python tools/artgen/generate.py --set mushrooms            # all candidates of every asset (skips existing files)
  python tools/artgen/generate.py --set decor --only decor.acorn.1 --candidates 4
  python tools/artgen/generate.py --set mushrooms --picked   # only the picked seeds (regenerate a finished set)

Raw images go to <tools>/raw/<set>/<asset id>/<seed>.png (never into git). Run it through artgen.bat / run.ps1 so
the isolated environment (HF_HOME, venv, ...) is set.

Memory plan for 8 GB VRAM / 16 GB RAM: stage 1 loads only the text encoders on the GPU, encodes every prompt of the
run and frees them; stage 2 keeps UNet + VAE fully on the GPU (no CPU offload, which thrashed on this machine).
"""
import argparse, gc, json, os, pathlib, time

HERE = pathlib.Path(__file__).resolve().parent
TOOLS = pathlib.Path(os.environ.get("ARTGEN_TOOLS", r"C:\Users\Roman Andreevich\Desktop\test_web_game\test_auto_game\.tools"))
RAW = TOOLS / "raw"


def load_config():
    return json.loads((HERE / "prompts.json").read_text(encoding="utf-8"))


def seeds_for(cfg, st, asset, picked_only, n_override):
    if picked_only:
        return [asset["picked"]] if asset.get("picked") is not None else []
    n = n_override or asset.get("candidates") or st.get("candidates") or cfg["defaults"]["candidates"]
    return [st["seedBase"] + asset.get("seedOffset", 0) + i for i in range(n)]


def build_prompt(cfg, st, asset):
    style = cfg["styles"][asset.get("style") or st["style"]]  # an asset may pick its own style (rival set)
    negative = style["negative"]
    if asset.get("negExtra"):  # per-asset exclusions go first: CLIP only reads the first 77 tokens
        negative = f"{asset['negExtra']}, {negative}"
    return f"{asset['subject']}, {style['suffix']}", negative


def encode_all(cfg, prompts):
    import torch
    from diffusers import StableDiffusionXLPipeline

    m = cfg["model"]
    pipe = StableDiffusionXLPipeline.from_pretrained(
        m["base"], unet=None, vae=None, torch_dtype=torch.float16, variant=m["variant"], use_safetensors=True).to("cuda")
    out = {}
    with torch.no_grad():
        for key, (prompt, negative) in prompts.items():
            n_tok = len(pipe.tokenizer(prompt).input_ids)
            if n_tok > 77:
                print(f"  warning: {key} prompt is {n_tok} tokens, tail is truncated", flush=True)
            pe, npe, pp, npp = pipe.encode_prompt(prompt=prompt, negative_prompt=negative, device="cuda",
                                                  num_images_per_prompt=1, do_classifier_free_guidance=True)
            out[key] = tuple(t.cpu() for t in (pe, npe, pp, npp))
    del pipe
    gc.collect()
    torch.cuda.empty_cache()
    return out


def load_unet_pipeline(cfg):
    import torch
    from diffusers import AutoencoderKL, StableDiffusionXLPipeline, DPMSolverMultistepScheduler

    m = cfg["model"]
    vae = AutoencoderKL.from_pretrained(m["vae"], torch_dtype=torch.float16)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        m["base"], vae=vae, text_encoder=None, text_encoder_2=None, tokenizer=None, tokenizer_2=None,
        torch_dtype=torch.float16, variant=m["variant"], use_safetensors=True)
    if cfg["defaults"]["scheduler"] == "dpmpp_2m_karras":
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(
            pipe.scheduler.config, algorithm_type="dpmsolver++", use_karras_sigmas=True)
    if m.get("lora"):
        pipe.load_lora_weights(m["lora"]["repo"], weight_name=m["lora"].get("file"))
        pipe.fuse_lora(lora_scale=m["lora"].get("scale", 0.8))
    pipe.to("cuda")
    pipe.vae.enable_tiling()
    pipe.vae.enable_slicing()
    return pipe


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True, help="mushrooms | decor | frontispiece | trees")
    ap.add_argument("--only", help="comma-separated asset ids")
    ap.add_argument("--candidates", type=int, help="override candidate count")
    ap.add_argument("--picked", action="store_true", help="only the picked seeds")
    ap.add_argument("--steps", type=int)
    ap.add_argument("--guidance", type=float)
    ap.add_argument("--force", action="store_true", help="regenerate existing files")
    ap.add_argument("--dry", action="store_true", help="print prompts only")
    args = ap.parse_args()

    cfg = load_config()
    st = cfg["sets"][args.set]
    only = set(args.only.split(",")) if args.only else None
    jobs = []
    for a in st["assets"]:
        if only and a["id"] not in only:
            continue
        for seed in seeds_for(cfg, st, a, args.picked, args.candidates):
            path = RAW / args.set / a["id"] / f"{seed}.png"
            if args.force or not path.exists():
                jobs.append((a, seed, path))
    print(f"{len(jobs)} images to generate", flush=True)
    if args.dry:
        for a, seed, path in jobs[:3]:
            print(a["id"], seed, build_prompt(cfg, st, a))
        return
    if not jobs:
        return

    import torch
    prompts = {a["id"]: build_prompt(cfg, st, a) for a, _, _ in jobs}
    t0 = time.time()
    embeds = encode_all(cfg, prompts)
    print(f"text encoded in {time.time() - t0:.0f}s", flush=True)
    t0 = time.time()
    pipe = load_unet_pipeline(cfg)
    print(f"unet loaded in {time.time() - t0:.0f}s", flush=True)
    steps = args.steps or cfg["defaults"]["steps"]
    guidance = args.guidance or cfg["defaults"]["guidance"]
    t_all = time.time()
    for i, (a, seed, path) in enumerate(jobs):
        pe, npe, pp, npp = (t.to("cuda") for t in embeds[a["id"]])
        t0 = time.time()
        gen = torch.Generator("cpu").manual_seed(int(seed))
        img = pipe(prompt_embeds=pe, negative_prompt_embeds=npe, pooled_prompt_embeds=pp, negative_pooled_prompt_embeds=npp,
                   width=st["width"], height=st["height"], num_inference_steps=steps, guidance_scale=guidance,
                   generator=gen).images[0]
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
        print(f"[{i + 1}/{len(jobs)}] {a['id']} seed {seed}: {time.time() - t0:.1f}s", flush=True)
    print(f"done in {time.time() - t_all:.0f}s", flush=True)


if __name__ == "__main__":
    main()
