"""Pre-download the model weights into <tools>\\hf (HF_HOME) so generation can start offline. ~7 GB."""
import json, pathlib
from huggingface_hub import snapshot_download

cfg = json.loads((pathlib.Path(__file__).with_name("prompts.json")).read_text(encoding="utf-8"))
m = cfg["model"]
p = snapshot_download(m["base"], allow_patterns=[
    "model_index.json", "*/config.json", "scheduler/*.json", "tokenizer*/*",
    "text_encoder/*.fp16.safetensors", "text_encoder_2/*.fp16.safetensors",
    "unet/*.fp16.safetensors", "vae/*.fp16.safetensors",
])
print("base:", p)
print("vae:", snapshot_download(m["vae"], allow_patterns=["config.json", "*.safetensors"]))

# IS-Net "general use" salient-object matte (ONNX, 170 MB): tells cutout.py where the specimen is.
import os, urllib.request
tools = pathlib.Path(os.environ.get("ARTGEN_TOOLS", r"C:\Users\Roman Andreevich\Desktop\test_web_game\test_auto_game\.tools"))
dst = tools / "models" / "isnet-general-use.onnx"
if not dst.exists():
    dst.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve("https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx", dst)
print("isnet:", dst)
