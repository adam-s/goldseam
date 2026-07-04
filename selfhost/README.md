# Self-host the model

goldseam brings your own model — it never calls a vendor cloud of its own.
These recipes cover running the model on hardware you control. For the full
runner reference (how `--model` and `goldseam.config.mjs` pick a model), see
the [package README](../packages/goldseam/README.md).

| Option | When | Guide |
| --- | --- | --- |
| **Ollama** | Local, simplest, free, fully air-gapped | [ollama/](ollama/README.md) |
| **Modal** | No local GPU — rent one by the second | [modal/](modal/README.md) |
| **Your own vLLM / LM Studio / endpoint** | You already run an OpenAI-compatible server | point the `openai:` runner at it via `OPENAI_BASE_URL` + `OPENAI_API_KEY` |

The `openai:` runner speaks to any OpenAI-compatible endpoint, so the third
row needs no recipe — set the two environment variables and use
`--model openai:<model>`.
