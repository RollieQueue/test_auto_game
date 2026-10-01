# Dot-source me: sets the isolated environment for every artgen command.
# The toolchain lives in the MAIN project's git-ignored .tools folder (survives worktrees).
$script:ArtRoot = if ($env:ARTGEN_TOOLS) { $env:ARTGEN_TOOLS } else { "C:\Users\Roman Andreevich\Desktop\test_web_game\test_auto_game\.tools" }
$env:HF_HOME = Join-Path $ArtRoot "hf"
$env:PIP_CACHE_DIR = Join-Path $ArtRoot "pip-cache"
$env:TORCH_HOME = Join-Path $ArtRoot "torch"
$env:HF_HUB_DISABLE_TELEMETRY = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
$env:PYTHONNOUSERSITE = "1"
$env:PYTHONPYCACHEPREFIX = Join-Path $ArtRoot "pycache"
$env:U2NET_HOME = Join-Path $ArtRoot "u2net"
$env:ARTGEN_TOOLS = $ArtRoot
$script:VenvPython = Join-Path $ArtRoot "artgen-venv\Scripts\python.exe"
