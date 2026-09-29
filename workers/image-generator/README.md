# CreatorHub local image worker

This folder is the first proof-of-concept renderer for CreatorHub-owned image
generation.

## Goal

Run image generation on hardware we control before paying a per-image API.

The first target is intentionally small:

- one image at a time
- default 512x512
- Stable Diffusion 1.5 by default
- CUDA if an NVIDIA GPU is available
- CPU fallback for proof-of-concept testing

The worker binds to localhost for the first hardware test. Do not expose it
directly to the public internet.

## Why Stable Diffusion 1.5 first

It is much smaller than the newer FLUX/Qwen families and gives us the best
chance of proving local generation on low-end hardware. Once the machine is
known, MODEL_ID can be changed to a stronger compatible model.

Default model:

stable-diffusion-v1-5/stable-diffusion-v1-5

Later stronger-GPU candidate:

black-forest-labs/FLUX.1-schnell

## Windows quick start

Install Python 3.11 or newer, then open PowerShell in this folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn server:app --host 127.0.0.1 --port 8000
```

The first generation downloads the model, so it can take substantially longer
than later runs.

## Check detected hardware

With the worker running:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Expected response includes:

- device: cuda, mps, or cpu
- GPU name when available
- GPU VRAM when CUDA is available
- currently configured model

## Generate one test image

```powershell
$body = @{
  prompt = "a simple studio portrait, soft lighting, photographic"
  width = 512
  height = 512
  count = 1
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/generate `
  -ContentType "application/json" `
  -Body $body
```

The response includes a PNG data URL and render duration.

## Next layer

After local hardware is proven, add a secure authenticated relay/worker
contract so CreatorHub and CoOperative can reach the renderer. That transport
can point to the same worker running on:

- the mini PC
- a home GPU system
- Hugging Face GPU Jobs
- RunPod/serverless GPU

Paid cloud fallback must remain explicit rather than automatic.
