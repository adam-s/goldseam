"""
Deploy a PRIVATE, OpenAI-compatible LLM endpoint on Modal for goldseam.

Serves Qwen2.5-14B-Instruct with vLLM. goldseam's `openai:` runner talks to
it directly — no code change, just a base URL + an API key. Pay-per-second
while a heal is running, $0 while idle (Modal stops the container after
`scaledown_window`).

Follows Modal's official vLLM example
(https://modal.com/docs/examples/vllm_inference), pinned to their API as of
2026-07. If Modal's API has moved since, diff this file against that page.

Full copy-paste walkthrough — no coding agent required: ./README.md
"""

import os
import subprocess

import modal

# ── What to serve ──────────────────────────────────────────────────────────
# The same 14B we proved locally over Ollama — heals id/class selectors well.
# Swap for any vLLM-supported model; bump the GPU below if it's bigger.
MODEL_NAME = "Qwen/Qwen2.5-14B-Instruct"
# Pin a specific Hugging Face commit for reproducible deploys. "main" tracks
# the latest; copy a commit hash from the model's HF "Files and versions" tab
# once you've settled on one.
MODEL_REVISION = "main"

VLLM_PORT = 8000
MINUTES = 60  # seconds

# ── Container image: CUDA + vLLM ───────────────────────────────────────────
vllm_image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])  # drop the base image's entrypoint so Modal runs ours
    .uv_pip_install("vllm==0.21.0", "huggingface_hub[hf_transfer]==0.26.2")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})  # fast weight downloads
)

# Persist weights + vLLM's compile cache across runs: the first boot downloads
# ~28 GB, every boot after is fast.
hf_cache_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("vllm-cache", create_if_missing=True)

app = modal.App("goldseam-model")


@app.function(
    image=vllm_image,
    # L40S (48 GB) is ample for a 14B and cheaper than an A100/H100. For a
    # larger model, bump to "A100-80GB" or "H100" (and raise N_GPU +
    # --tensor-parallel-size if it won't fit on one card).
    gpu="L40S",
    # Stay warm 15 min after the last request, then stop. You pay $0 while
    # idle; the next request cold-starts (fast, thanks to the cache volumes).
    scaledown_window=15 * MINUTES,
    timeout=10 * MINUTES,
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
    # The API key lives in a Modal secret, never in this file. Create it once:
    #   modal secret create goldseam-vllm GOLDSEAM_VLLM_API_KEY=$(openssl rand -hex 16)
    secrets=[modal.Secret.from_name("goldseam-vllm")],
)
@modal.concurrent(max_inputs=32)  # one container serves many heals at once
@modal.web_server(port=VLLM_PORT, startup_timeout=10 * MINUTES)
def serve():
    # `--api-key` makes the endpoint private: clients must send
    # `Authorization: Bearer <key>`, which is exactly what goldseam's openai:
    # runner does with OPENAI_API_KEY.
    api_key = os.environ["GOLDSEAM_VLLM_API_KEY"]
    cmd = [
        "vllm", "serve", MODEL_NAME,
        "--revision", MODEL_REVISION,
        "--served-model-name", MODEL_NAME,
        "--host", "0.0.0.0",
        "--port", str(VLLM_PORT),
        "--api-key", api_key,
        "--uvicorn-log-level", "info",
    ]
    # Popen (not run): return immediately so Modal's web_server health-check
    # can start polling the port while vLLM finishes loading weights.
    subprocess.Popen(" ".join(cmd), shell=True)
