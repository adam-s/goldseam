# Self-host goldseam's model on Modal

Run the model that heals your tests on **your own** GPU, rented by the
second from [Modal](https://modal.com). No vendor cloud sees your DOM, you
pay only while a heal is actually running, and goldseam talks to it through
the plain `openai:` runner it already has.

**What you get:** a private, OpenAI-compatible endpoint serving
`Qwen/Qwen2.5-14B-Instruct` — the same 14B goldseam heals with locally over
Ollama — that stops itself (and stops billing) 15 minutes after the last
request.

---

## Before you start (one time, ~5 minutes)

1. **A Modal account** — free to create, and it comes with monthly free
   credits. Sign up at [modal.com](https://modal.com).
2. **Python 3.10+** (`python3 --version`).
3. **Install the Modal CLI in an isolated environment** — this avoids
   clashing with your system Python (and dodges the "externally-managed-
   environment" error macOS throws at a plain `pip install`):
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate        # Windows: .venv\Scripts\activate
   pip install modal
   modal token new                  # opens your browser to authenticate
   ```
   Keep this shell activated for the `modal` commands below (re-run
   `source .venv/bin/activate` in a new terminal). Prefer a global CLI?
   `pipx install modal` installs it once, available everywhere, no
   activating.

That's the whole setup. Everything below is copy-paste.

---

## Step 1 — Get this file

This deploys [`goldseam_model.py`](goldseam_model.py) from this folder.

## Step 2 — Create your private API key

The endpoint is locked with a key so only you can call it. This command
generates a random one and stores it as a Modal secret (it never touches
your code):

```bash
modal secret create goldseam-vllm GOLDSEAM_VLLM_API_KEY=$(openssl rand -hex 16)
```

You'll pass this same key to goldseam in Step 4. To see it again later:
`modal secret list` won't show the value — so if you need it, run the
`openssl` part alone first and paste the result into both places.

> Prefer to pick your own key? Replace `$(openssl rand -hex 16)` with any
> string, e.g. `GOLDSEAM_VLLM_API_KEY=my-secret-key`.

## Step 3 — Deploy

```bash
modal deploy selfhost/modal/goldseam_model.py
```

Modal builds the image and prints a URL ending in `.modal.run`, like:

```
✓ Created web endpoint => https://yourname--goldseam-model-serve.modal.run
```

**Copy that URL.** The first request downloads the model (~28 GB, a few
minutes); every request after is fast because the weights are cached.

Sanity-check it's alive (add `/health`):

```bash
curl https://yourname--goldseam-model-serve.modal.run/health
```

## Step 4 — Point goldseam at it

goldseam's `openai:` runner speaks to any OpenAI-compatible endpoint. Set
two env vars — **the base URL is your Modal URL plus `/v1`** — and the key
from Step 2:

```bash
export OPENAI_BASE_URL="https://yourname--goldseam-model-serve.modal.run/v1"
export OPENAI_API_KEY="<the key you generated in Step 2>"
```

Then heal (or author) with the `openai:` runner naming the served model:

```bash
npx goldseam heal --model "openai:Qwen/Qwen2.5-14B-Instruct"
```

Or set it once for both heal and authoring in `goldseam.config.mjs` (see the
package README) so you don't repeat the flag:

```js
// goldseam.config.mjs
export default {
  model: 'openai:Qwen/Qwen2.5-14B-Instruct',
  // OPENAI_BASE_URL and OPENAI_API_KEY still come from the environment.
};
```

That's it — your suite now heals on a model you host.

---

## Cost & control

- **You pay per second the GPU is running**, not per token. A heal keeps the
  container warm for `scaledown_window` (15 min) after the last request, then
  Modal stops it and billing goes to **$0**. Check current GPU rates on
  Modal's pricing page — an L40S is a low-single-digit dollars/hour, so a
  burst of heals is cents.
- **Stop it immediately** (don't wait for the idle window):
  ```bash
  modal app stop goldseam-model
  ```
- **See what's running / logs:**
  ```bash
  modal app list
  modal app logs goldseam-model
  ```

## Tuning (all in `goldseam_model.py`, well-commented)

- **Bigger model?** Change `MODEL_NAME` and bump `gpu=` (`"A100-80GB"`,
  `"H100"`). For a model too big for one card, raise the GPU count and add
  `--tensor-parallel-size`.
- **Pin the version** for reproducible deploys: set `MODEL_REVISION` to a
  commit hash from the model's Hugging Face page instead of `"main"`.
- **Snappier first heal?** Add `min_containers=1` to the `@app.function` args
  to keep one GPU always warm — but you then pay for idle time, so only for a
  heavy CI pipeline.

## Troubleshooting

- **`401 Unauthorized` from goldseam** — `OPENAI_API_KEY` doesn't match the
  secret you created in Step 2, or `OPENAI_BASE_URL` is missing the `/v1`
  suffix.
- **First heal times out** — the initial weight download can exceed a
  request timeout. Warm it once with the `curl .../health` check, or hit
  `curl .../v1/models` and wait for a JSON reply before healing.
- **JSON escaping errors on a heal** — smaller models occasionally mangle the
  edit JSON. goldseam's validator rejects the bad edit and fails the heal
  honestly rather than applying garbage; retry, or use a larger model. (The
  `ollama:` runner constrains decoding to JSON; the `openai:` path currently
  does not.)

---

## Honest status

This is a **deployment recipe**, pinned to Modal's API and vLLM 0.21 as of
2026-07. It has **not** been run in goldseam's CI (CI makes no cloud model
calls, by design). If Modal's API has changed, compare against their
[vLLM example](https://modal.com/docs/examples/vllm_inference). Once you've
run a heal through it, you've proven the `openai:` path end-to-end on a model
you own — which is the whole point.
