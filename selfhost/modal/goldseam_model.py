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

# goldseam's heal prompt embeds the page's DOM. On a deep page whose heal
# target sits behind un-strippable chrome (a Squarespace mega-nav pushes the
# blog list to char ~144K), the no-anchor DOM window runs ~50K tokens — past
# Qwen2.5's native 32K context. Serve a 64K window via YaRN rope scaling so the
# endpoint accepts those prompts instead of rejecting them with HTTP 400
# ("maximum context length exceeded"), which goldseam surfaces as a failed
# heal. YaRN is Qwen's own recommended long-context method; factor 2.0 doubles
# 32768 -> 65536. Proven end-to-end: a 51K-token epsilon3 heal prompt lands the
# correct edit at this context on an L40S. Raise MAX_MODEL_LEN (and the GPU) if
# you push goldseam's prompt ceiling higher.
MAX_MODEL_LEN = 65536
YARN_FACTOR = 2.0  # 32768 * 2 = 65536

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
    # A100-80GB, not L40S: goldseam's long-context prompts (MAX_MODEL_LEN=64K,
    # for a deep page's DOM window) need ~12 GiB of KV cache on top of the 14B
    # weights, and an L40S (48 GB) leaves only ~11 GiB free at the default
    # utilization — it caps out around 59K tokens and refuses to start at 64K.
    # The 80 GB card fits 64K with tens of GiB to spare. If you only heal
    # shallow pages (prompts under ~30K tokens), drop MAX_MODEL_LEN to 32768 and
    # this fits an L40S again — cheaper, and no rope scaling needed.
    gpu="A100-80GB",
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
    import json

    cmd = [
        "vllm", "serve", MODEL_NAME,
        "--revision", MODEL_REVISION,
        "--served-model-name", MODEL_NAME,
        "--host", "0.0.0.0",
        "--port", str(VLLM_PORT),
        "--api-key", api_key,
        # Long context for goldseam's deep-page prompts (see MAX_MODEL_LEN).
        # --hf-overrides injects the YaRN rope config Qwen2.5 needs above 32K
        # (the version-robust form; the older --rope-scaling flag was removed).
        "--max-model-len", str(MAX_MODEL_LEN),
        "--hf-overrides", json.dumps({
            "rope_scaling": {
                "rope_type": "yarn",
                "factor": YARN_FACTOR,
                "original_max_position_embeddings": 32768,
            }
        }),
        "--uvicorn-log-level", "info",
    ]
    # Popen (not run): return immediately so Modal's web_server health-check
    # can start polling the port while vLLM finishes loading weights. List
    # form, no shell: the API key is an argv element, never spliced into a
    # shell string where a space or `$`/`;` could break or execute it.
    subprocess.Popen(cmd)
