# One-time toolchain setup. Everything goes to <project>\.tools (ignored by git); nothing global is touched.
# Usage: powershell -ExecutionPolicy Bypass -File tools\artgen\setup.ps1 [-Base D:\anaconda\python.exe]
param([string]$Base = "D:\anaconda\python.exe", [string]$Torch = "https://download.pytorch.org/whl/cu126")
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_env.ps1"
New-Item -ItemType Directory -Force $ArtRoot, $env:HF_HOME, $env:PIP_CACHE_DIR, $env:TORCH_HOME | Out-Null
if (-not (Test-Path $VenvPython)) { & $Base -m venv (Join-Path $ArtRoot "artgen-venv") }
& $VenvPython -m pip install --upgrade pip
# NB: torch 2.14.1 fails to load c10.dll on this machine (WinError 1114); 2.7.1 works.
& $VenvPython -m pip install torch==2.7.1 torchvision==0.22.1 --index-url $Torch
& $VenvPython -m pip install diffusers transformers accelerate safetensors pillow numpy scipy opencv-python-headless protobuf onnxruntime==1.20.1   # NB: onnxruntime 1.30 crashes on import here
& $VenvPython -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0))"
