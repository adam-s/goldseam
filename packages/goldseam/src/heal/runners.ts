// Model runners. Anything that maps a rendered prompt to raw reply text is
// a runner; the engine never knows which model (or whether a model at all)
// produced the reply. Every failure here is mapped to an ACTIONABLE message:
// the model is bring-your-own, so "not installed / not running / wrong key"
// are the common cases and each names its own fix.

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { delimiter, join } from 'path';
import { RepairRunner } from './types';

export class RunnerError extends Error {}

/** The one-line menu of alternatives, appended to "your model is unreachable"
 * errors so the fix is always in front of the user. */
const OTHER_MODELS = 'choose another model with --model ollama:<model> | openai:<model> | cmd:<executable> (or set `model` in goldseam.config.mjs)';

function run(command: string, args: string[], stdin: string, notFoundHint?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errOut += d));
    // A child that exits before draining a large prompt raises EPIPE on the
    // stdin socket; swallow it so the close handler reports the real cause.
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      reject(new RunnerError(code === 'ENOENT' && notFoundHint ? notFoundHint : `${command}: ${e.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new RunnerError(`${command} exited ${code}: ${errOut.slice(0, 400)}`));
      } else resolve(out);
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

const CLAUDE_MISSING = `the Claude Code CLI (\`claude\`) isn't on your PATH — install it, or ${OTHER_MODELS}`;

/** `claude` / `claude:<model>` — the Claude Code CLI in print mode. */
function claudeRunner(model: string): RepairRunner {
  return {
    id: `claude:${model}`,
    async repair(prompt: string): Promise<string> {
      const out = await run('claude', ['-p', '--output-format', 'json', '--model', model], prompt, CLAUDE_MISSING);
      let wrapper: { result?: string; is_error?: boolean };
      try {
        wrapper = JSON.parse(out) as { result?: string; is_error?: boolean };
      } catch (e) {
        throw new RunnerError(`claude output was not the expected JSON wrapper: ${e instanceof Error ? e.message : e}`);
      }
      // A parsed wrapper with is_error carries the real error in `result` —
      // surface it instead of a generic "no result".
      if (wrapper.is_error) {
        throw new RunnerError(`claude returned an error: ${wrapper.result ?? '(no detail)'}`);
      }
      if (typeof wrapper.result !== 'string') {
        throw new RunnerError('claude reply carried no result text');
      }
      return wrapper.result;
    },
  };
}

/** `cmd:<executable [args…]>` — prompt on stdin, reply on stdout. The escape hatch. */
function cmdRunner(commandLine: string): RepairRunner {
  const [executable, ...args] = commandLine.split(/\s+/);
  return {
    id: `cmd:${commandLine}`,
    repair: (prompt: string) =>
      run(executable, args, prompt, `cmd runner: executable "${executable}" not found on PATH`),
  };
}

/** POST JSON, return parsed body. Local-model prompts are big and slow —
 * generous default timeout, overridable via GOLDSEAM_HTTP_TIMEOUT_MS. A
 * non-numeric env value falls back to the default rather than aborting at 0ms. */
async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const configured = Number(process.env.GOLDSEAM_HTTP_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 300_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new RunnerError(`${url} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof RunnerError) throw e;
    throw new RunnerError(`could not reach ${url}: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
}

const OLLAMA_DEFAULT_HOST = 'http://127.0.0.1:11434';

/** Size Ollama's context window to the prompt. Ollama defaults `num_ctx` to
 * ~4K (2K on some builds) and SILENTLY truncates anything longer — so a
 * deep-page heal prompt (a Squarespace blog's DOM window runs ~50K tokens) is
 * cut to the first few thousand tokens and the model never sees the heal
 * target, then "gives up". That is a silent lie: the pipeline reports give-up
 * for a target it never showed the model. Sizing the context to the prompt
 * makes the give-up honest — the model saw everything we sent.
 *
 * Estimate tokens by chars/3 (deliberately generous vs the ~chars/4 English
 * average, because HTML/JSON tokenizes denser and UNDER-sizing re-introduces
 * the silent truncation) plus output headroom, floored so small prompts still
 * get a sane window and capped so we never request an absurd allocation. Ollama
 * itself clamps the request to the model's trained maximum, so a short-context
 * model is no worse off than before; a long-context model now works. Override
 * the cap with GOLDSEAM_OLLAMA_NUM_CTX for unusual hardware. */
export function ollamaNumCtx(prompt: string): number {
  const override = Number(process.env.GOLDSEAM_OLLAMA_NUM_CTX);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  const estTokens = Math.ceil(prompt.length / 3) + 2048;
  return Math.min(131_072, Math.max(8_192, estTokens));
}

/** `ollama:<model>` — local HTTP, zero egress: the air-gapped story
 * (cypress#33927 / #32673). Host via OLLAMA_HOST (default localhost). */
function ollamaRunner(model: string): RepairRunner {
  const host = process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST;
  return {
    id: `ollama:${model}`,
    async repair(prompt: string): Promise<string> {
      let reply: { response?: string };
      try {
        reply = (await postJson(
          `${host}/api/generate`,
          // format:'json' = ollama's constrained decoding — local models
          // reliably pick the right edit but flub JSON escaping without it
          // (probed: qwen2.5-14b escaped oldString's quotes, not newString's,
          // three attempts straight). num_ctx sized to the prompt so a deep
          // capture is never silently truncated below the heal target.
          { model, prompt, stream: false, format: 'json', options: { temperature: 0, num_ctx: ollamaNumCtx(prompt) } },
          {},
        )) as { response?: string };
      } catch (e) {
        throw connectionHint(e, `no Ollama server reachable at ${host} — run \`ollama serve\` and \`ollama pull ${model}\`, or ${OTHER_MODELS}`);
      }
      if (typeof reply.response !== 'string') {
        throw new RunnerError('ollama reply carried no response text');
      }
      return reply.response;
    },
  };
}

/** The reply contract goldseam's parser accepts (parse.ts): either an edits[]
 * proposal with a confidence, or a giveUp. Handed to the endpoint as a
 * response_format json_schema so a weaker model emits VALID, correctly-shaped
 * JSON instead of prose-wrapped or mis-escaped text. Both branches are optional
 * so the model picks one; goldseam validates strictly afterward. Measured on
 * vLLM + Qwen2.5-14B: bare decoding mis-escapes the edit JSON, and — worse —
 * `response_format: json_object` sends the constrained decoder into a runaway
 * that fills max_tokens with whitespace (finish_reason=length, unparseable).
 * The explicit schema fixes both: fast, valid, and the correct edit. */
const REPAIR_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          oldString: { type: 'string' },
          newString: { type: 'string' },
        },
        required: ['file', 'oldString', 'newString'],
      },
    },
    giveUp: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
} as const;

/** `openai:<model>` — any OpenAI-compatible chat endpoint (OpenAI proper,
 * a self-hosted vLLM/Modal `serve` deployment, LM Studio, …). Base URL via
 * OPENAI_BASE_URL (default api.openai.com), key via OPENAI_API_KEY. */
function openaiRunner(model: string): RepairRunner {
  const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const key = process.env.OPENAI_API_KEY;
  return {
    id: `openai:${model}`,
    async repair(prompt: string): Promise<string> {
      let reply: { choices?: Array<{ message?: { content?: string } }> };
      try {
        reply = (await postJson(
          `${base}/chat/completions`,
          {
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            // Bounded so an endpoint that defaults max_tokens to a tiny value
            // (some do) can't truncate a multi-occurrence edit reply mid-JSON;
            // generous enough for the largest heal (8 edits + a reasoning
            // paragraph) with room to spare.
            max_tokens: 4096,
            // Constrained decoding to goldseam's reply schema (see
            // REPAIR_REPLY_SCHEMA) — the openai-path analog of the ollama
            // runner's format:'json', but schema-shaped because plain
            // json_object makes vLLM's decoder run away. vLLM/OpenAI/LM Studio
            // honor json_schema; an endpoint that doesn't answers with a clear
            // HTTP 400 rather than silent garbage.
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'goldseam_repair', schema: REPAIR_REPLY_SCHEMA },
            },
          },
          key ? { authorization: `Bearer ${key}` } : {},
        )) as { choices?: Array<{ message?: { content?: string } }> };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/HTTP 401|HTTP 403/.test(msg)) {
          throw new RunnerError(`${base} rejected the API key — check OPENAI_API_KEY${key ? '' : ' (it is unset)'}`);
        }
        throw connectionHint(e, `could not reach the OpenAI-compatible endpoint at ${base} — check OPENAI_BASE_URL, or ${OTHER_MODELS}`);
      }
      const content = reply.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new RunnerError('openai-compatible reply carried no message content');
      }
      return content;
    },
  };
}

/** Prepend actionable guidance when the error is a connection failure; pass
 * other errors (HTTP status, bad JSON) through unchanged. */
function connectionHint(e: unknown, guidance: string): RunnerError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/could not reach|ECONNREFUSED|fetch failed|ENOTFOUND|aborted|timed out/i.test(msg)) {
    return new RunnerError(`${guidance}\n(${msg})`);
  }
  return e instanceof RunnerError ? e : new RunnerError(msg);
}

export function resolveRunner(spec: string): RepairRunner {
  if (spec === 'claude') return claudeRunner('sonnet'); // dev/benchmark default: Sonnet 5
  if (spec.startsWith('claude:')) return claudeRunner(spec.slice('claude:'.length));
  if (spec.startsWith('cmd:')) return cmdRunner(spec.slice('cmd:'.length));
  if (spec.startsWith('ollama:')) return ollamaRunner(spec.slice('ollama:'.length));
  if (spec.startsWith('openai:')) return openaiRunner(spec.slice('openai:'.length));
  throw new RunnerError(
    `unknown model runner "${spec}" (expected claude, claude:<model>, ollama:<model>, openai:<model>, or cmd:<executable>)`,
  );
}

/** Is `exe` resolvable on PATH (or an existing explicit path)? */
function onPath(exe: string): boolean {
  if (exe.includes('/')) return existsSync(exe);
  const dirs = (process.env.PATH ?? '').split(delimiter);
  return dirs.some((d) => d && existsSync(join(d, exe)));
}

/** Cheap, no-cost reachability check for a runner, run ONCE before a heal
 * batch so an unusable model fails fast with one clear message instead of a
 * cryptic error per capture. Costs no model tokens: it checks the binary is
 * on PATH (claude/cmd) or the server answers a metadata endpoint (ollama).
 * The openai path has no free probe — a bad key/endpoint surfaces as a mapped
 * error on the first real call. */
export async function preflightRunner(spec: string): Promise<void> {
  if (spec === 'claude' || spec.startsWith('claude:')) {
    if (!onPath('claude')) throw new RunnerError(CLAUDE_MISSING);
    return;
  }
  if (spec.startsWith('cmd:')) {
    const exe = spec.slice('cmd:'.length).trim().split(/\s+/)[0];
    if (exe && !onPath(exe)) throw new RunnerError(`cmd runner: executable "${exe}" not found on PATH`);
    return;
  }
  if (spec.startsWith('ollama:')) {
    const host = process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST;
    const model = spec.slice('ollama:'.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      throw new RunnerError(
        `no Ollama server reachable at ${host} — run \`ollama serve\` and \`ollama pull ${model}\`, or ${OTHER_MODELS}\n(${e instanceof Error ? e.message : e})`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
