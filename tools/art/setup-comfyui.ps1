# Installs ComfyUI + Animagine XL 4.0 locally for card-art generation.
# Idempotent: safe to re-run. Requires tools on PATH (git, python 3.12).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = if ($env:COMFY_ROOT) { $env:COMFY_ROOT } else { "$env:USERPROFILE\ComfyUI" }
$tools = "$env:USERPROFILE\tools"
$env:Path = "$tools\python312;$tools\python312\Scripts;$tools\git\cmd;$env:Path"

if (-not (Test-Path "$root\main.py")) {
    git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git $root
}
if (-not (Test-Path "$root\venv\Scripts\python.exe")) {
    python -m venv "$root\venv"
}
$py = "$root\venv\Scripts\python.exe"
& $py -m pip install --upgrade pip -q
# cu126 matches NVIDIA driver 560+; recent ComfyUI needs a recent torch (cu124 wheels are too old).
& $py -m pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126 -q
& $py -m pip install -r "$root\requirements.txt" -q

$ckpt = "$root\models\checkpoints\animagine-xl-4.0-opt.safetensors"
if (-not (Test-Path $ckpt)) {
    Write-Host 'Downloading Animagine XL 4.0 (~7GB)...'
    curl.exe -L --retry 5 -o "$ckpt.part" 'https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors'
    Move-Item "$ckpt.part" $ckpt
}
& $py -c "import torch; print('CUDA', torch.cuda.is_available(), torch.cuda.get_device_name(0))"
Write-Host "ComfyUI ready at $root. Start with: $py $root\main.py --listen 127.0.0.1 --port 8188"
