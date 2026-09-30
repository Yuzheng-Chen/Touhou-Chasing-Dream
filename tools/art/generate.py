"""Generate card illustrations through a running ComfyUI server.

Usage (with the ComfyUI venv python, server on 127.0.0.1:8188):
    python tools/art/generate.py                 # everything missing
    python tools/art/generate.py freeload rumor  # specific ids (regenerates)
    python tools/art/generate.py --force         # regenerate all
    python tools/art/generate.py --seed-offset 7 expose   # try another seed

Prompts live in prompts.json: {"id": {"prompt": "...", "size": "portrait|wide", "seed": 123}}.
Outputs: packages/client/public/art/cards/<id>.webp (portrait) or .../art/bg/<id>.webp (wide).
"""
from __future__ import annotations

import io
import json
import sys
import time
import urllib.request
import uuid
import zlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PROMPTS = Path(__file__).with_name("prompts.json")
OUT_CARDS = ROOT / "packages/client/public/art/cards"
OUT_BG = ROOT / "packages/client/public/art/bg"
SERVER = "http://127.0.0.1:8188"
CKPT = "animagine-xl-4.0-opt.safetensors"

STYLE = (
    "touhou, anime illustration, beautiful detailed eyes, intricate details, soft rim lighting, "
    "vibrant colors, depth of field, detailed background, "
    "masterpiece, high score, great score, absurdres"
)
NEGATIVE = (
    "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, "
    "cropped, worst quality, low quality, low score, bad score, average score, signature, "
    "watermark, username, blurry, jpeg artifacts, logo, nsfw, speech bubble"
)
SIZES = {"portrait": (832, 1216), "wide": (1536, 640), "square": (1024, 1024)}
OUT_WIDTH = {"portrait": 640, "wide": 1920, "square": 768}


def workflow(prompt: str, seed: int, w: int, h: int) -> dict:
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{prompt}, {STYLE}", "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["4", 1]}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": 28, "cfg": 5.0, "sampler_name": "euler_ancestral",
                "scheduler": "normal", "denoise": 1.0,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "tcd", "images": ["8", 0]}},
    }


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(SERVER + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def get(path: str) -> bytes:
    with urllib.request.urlopen(SERVER + path) as r:
        return r.read()


def render(prompt: str, seed: int, size: str) -> Image.Image:
    w, h = SIZES[size]
    pid = post("/prompt", {"prompt": workflow(prompt, seed, w, h), "client_id": str(uuid.uuid4())})["prompt_id"]
    while True:
        hist = json.loads(get(f"/history/{pid}"))
        if pid in hist:
            outputs = hist[pid]["outputs"]
            img = next(iter(outputs.values()))["images"][0]
            data = get(f"/view?filename={img['filename']}&subfolder={img['subfolder']}&type={img['type']}")
            return Image.open(io.BytesIO(data)).convert("RGB")
        time.sleep(0.5)


def main(argv: list[str]) -> None:
    force = "--force" in argv
    offset = 0
    if "--seed-offset" in argv:
        i = argv.index("--seed-offset")
        offset = int(argv[i + 1])
        del argv[i : i + 2]
    ids = [a for a in argv if not a.startswith("--")]
    specs: dict = json.loads(PROMPTS.read_text(encoding="utf-8"))
    OUT_CARDS.mkdir(parents=True, exist_ok=True)
    OUT_BG.mkdir(parents=True, exist_ok=True)

    todo = ids or list(specs)
    for n, cid in enumerate(todo, 1):
        spec = specs[cid]
        size = spec.get("size", "portrait")
        out = (OUT_BG if size == "wide" else OUT_CARDS) / f"{cid}.webp"
        if out.exists() and not (force or ids):
            continue
        seed = spec.get("seed", zlib.crc32(cid.encode())) + offset
        t0 = time.time()
        img = render(spec["prompt"], seed, size)
        tw = OUT_WIDTH[size]
        img = img.resize((tw, round(img.height * tw / img.width)), Image.LANCZOS)
        img.save(out, "WEBP", quality=84, method=6)
        print(f"[{n}/{len(todo)}] {cid} seed={seed} {time.time() - t0:.1f}s -> {out.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
