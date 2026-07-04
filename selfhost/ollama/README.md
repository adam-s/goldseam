# Run goldseam's model locally with Ollama

Heal your tests with a model running on **your own machine** through
[Ollama](https://ollama.com). Nothing leaves your network, there is no API
key, and it costs nothing to run. This is goldseam's air-gapped path.

Ollama needs no deploy step or provisioning script — that is the whole point
of it. Two commands stand up the server; goldseam talks to it through its
`ollama:` runner.

## Before you start

1. **Install Ollama** from [ollama.com](https://ollama.com) (macOS, Linux, or
   Windows).
2. Have room for the model. A 14B model needs roughly 10–16 GB of RAM or
   VRAM; smaller models need less.

## Steps

1. **Pull a model** — Qwen2.5 14B is the one goldseam has healed with:
   ```bash
   ollama pull qwen2.5:14b
   ```
2. **Start the server.** The Ollama desktop app runs it for you; from a
   terminal, `ollama serve` (it listens on `http://127.0.0.1:11434`).
3. **Point goldseam at it** with the `ollama:` runner:
   ```bash
   npx goldseam heal --model ollama:qwen2.5:14b
   ```
   Or set it once for both heal and authoring in `goldseam.config.mjs`:
   ```js
   // goldseam.config.mjs
   export default { model: 'ollama:qwen2.5:14b' };
   ```

Before the heal batch runs, goldseam checks the server is reachable and tells
you what to fix if it isn't.

## Running Ollama on another machine

Point goldseam at a remote (or GPU-box) Ollama with `OLLAMA_HOST`:

```bash
export OLLAMA_HOST=http://gpu-box.local:11434
npx goldseam heal --model ollama:qwen2.5:14b
```

## Which models work

- **Qwen2.5 14B** heals id/class selectors reliably and has been proven
  end-to-end through the full verification ladder, zero network egress.
- goldseam turns on Ollama's **JSON-constrained decoding** (`format: "json"`)
  automatically, because local models pick the right edit but otherwise flub
  the JSON escaping.
- Smaller models can still mangle long attribute-quoted selectors. When that
  happens the edit validator rejects the garbage and the heal fails honestly
  rather than applying it — so a weak model costs you a missed heal, never a
  wrong one.

## Want a rented GPU instead?

If you don't have the local hardware, the [Modal recipe](../modal/README.md)
serves the same class of model on a GPU you rent by the second.
