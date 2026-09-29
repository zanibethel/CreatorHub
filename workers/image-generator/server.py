import base64
import io
import os
import threading
import time
from typing import Optional

import torch
from diffusers import DiffusionPipeline
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_ID = os.getenv(
    "MODEL_ID",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
)
MODEL_LABEL = os.getenv("MODEL_LABEL", MODEL_ID)
MAX_DIMENSION = int(os.getenv("MAX_DIMENSION", "768"))

app = FastAPI(title="CreatorHub Local Image Worker", version="0.1.0")
_pipe: Optional[DiffusionPipeline] = None
_pipe_lock = threading.Lock()


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    width: int = Field(default=512, ge=256, le=1024)
    height: int = Field(default=512, ge=256, le=1024)
    count: int = Field(default=1, ge=1, le=1)


def device_info():
    if torch.cuda.is_available():
        return {
            "device": "cuda",
            "gpu": torch.cuda.get_device_name(0),
            "vramBytes": torch.cuda.get_device_properties(0).total_memory,
        }

    mps = getattr(torch.backends, "mps", None)
    if mps and mps.is_available():
        return {"device": "mps", "gpu": "Apple Metal", "vramBytes": None}

    return {"device": "cpu", "gpu": None, "vramBytes": None}


def load_pipeline():
    global _pipe
    if _pipe is not None:
        return _pipe

    info = device_info()
    device = info["device"]
    dtype = torch.float16 if device == "cuda" else torch.float32

    pipe = DiffusionPipeline.from_pretrained(MODEL_ID, torch_dtype=dtype)
    pipe = pipe.to(device)

    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()

    _pipe = pipe
    return pipe


@app.get("/health")
def health():
    info = device_info()
    return {
        "ok": True,
        "model": MODEL_ID,
        "modelLabel": MODEL_LABEL,
        **info,
        "loaded": _pipe is not None,
    }


@app.post("/generate")
def generate(request: GenerateRequest):
    width = min((request.width // 64) * 64, MAX_DIMENSION)
    height = min((request.height // 64) * 64, MAX_DIMENSION)
    if width < 256 or height < 256:
        raise HTTPException(status_code=400, detail="Requested dimensions are too small.")

    started = time.perf_counter()
    with _pipe_lock:
        pipe = load_pipeline()
        is_flux_schnell = "flux.1-schnell" in MODEL_ID.lower()
        result = pipe(
            request.prompt,
            width=width,
            height=height,
            num_inference_steps=4 if is_flux_schnell else 20,
            guidance_scale=0.0 if is_flux_schnell else 7.0,
        )

    image = result.images[0]
    output = io.BytesIO()
    image.save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    info = device_info()

    return {
        "ok": True,
        "image": f"data:image/png;base64,{encoded}",
        "model": MODEL_ID,
        "modelLabel": MODEL_LABEL,
        "device": info["device"],
        "gpu": info["gpu"],
        "width": width,
        "height": height,
        "durationMs": round((time.perf_counter() - started) * 1000),
    }
