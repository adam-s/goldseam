"""
Deploy a PRIVATE, OpenAI-compatible LLM endpoint on Modal for goldseam.

Serves Qwen2.5-14B-Instruct with vLLM. goldseam's `openai:` runner talks to
it directly — no code change, only a base URL and an API key. Pay-per-second
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

# Qwen2.5's native 32K context is enough for goldseam. Deep pages USED to send a
# ~50K-token no-anchor DOM window (a Squarespace mega-nav pushes the blog list to
# char ~144K), which needed YaRN rope scaling to 64K and an A100. goldseam's
# offline candidate-ranking now hands the model a compact shortlist and windows
# the DOM on the ranked candidate, so that same deep heal is a ~5K-token prompt —
# it fits native 32K with room to spare, on a cheaper L40S, no rope scaling.
# Proven: the local 14B heals the epsilon3 case from the ~5K-token prompt.
MAX_MODEL_LEN = 32768

# ── Container image: CUDA + vLLM ───────────────────────────────────────────
# Versions proven end-to-end (a goldseam heal landed the correct edit on this
# exact combo on an L40S): CUDA 12.8.1 + vLLM 0.11.0 + transformers 4.57.0.
# (vLLM < 0.7 crashed on Qwen2.5's rope_scaling; this combo handles it.)
vllm_image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])  # drop the base image's entrypoint so Modal runs ours
    .uv_pip_install("vllm==0.11.0", "transformers==4.57.0", "huggingface_hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# Persist weights + vLLM's compile cache across runs: the first boot downloads
# ~28 GB, every boot after is fast.
hf_cache_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("vllm-cache", create_if_missing=True)

app = modal.App("goldseam-model")


@app.function(
    image=vllm_image,
    # L40S (48 GB) is ample for a 14B at native 32K context and cheaper than an
    # A100 — goldseam's ranking rung keeps prompts small (~5K tokens even for a
    # deep page), so there is no need for the 64K/A100 setup a raw deep DOM
    # window used to require. Bump to A100-80GB only for a larger model.
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
    # The endpoint is private: clients must send `Authorization: Bearer <key>`,
    # which is exactly what goldseam's openai: runner does with OPENAI_API_KEY.
    # Pass the key through the VLLM_API_KEY ENV var, not the --api-key flag:
    # vLLM logs its parsed argument Namespace at startup, so an --api-key argv
    # element lands in the container logs in cleartext. The env var reaches vLLM
    # the same way but never appears in argv or that startup log.
    api_key = os.environ["GOLDSEAM_VLLM_API_KEY"]

    cmd = [
        "vllm", "serve", MODEL_NAME,
        "--revision", MODEL_REVISION,
        "--served-model-name", MODEL_NAME,
        "--host", "0.0.0.0",
        "--port", str(VLLM_PORT),
        # Native 32K context is enough — goldseam's ranking rung keeps prompts
        # small, so no YaRN rope scaling is needed (see MAX_MODEL_LEN).
        "--max-model-len", str(MAX_MODEL_LEN),
        # warning, not info: the info-level startup log echoes the parsed args;
        # keeping it quiet is defense-in-depth for the key now in the env.
        "--uvicorn-log-level", "warning",
    ]
    # Popen (not run): return immediately so Modal's web_server health-check can
    # start polling the port while vLLM finishes loading weights. List form, no
    # shell. The key rides in the environment, never in argv.
    subprocess.Popen(cmd, env={**os.environ, "VLLM_API_KEY": api_key})
