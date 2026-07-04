// Model runners. Anything that maps a rendered prompt to raw reply text is
// a runner; the engine never knows which model (or whether a model at all)
// produced the reply.

import { spawn } from 'child_process';
import { RepairRunner } from './types';

export class RunnerError extends Error {}

function run(command: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errOut += d));
    child.on('error', (e) => reject(new RunnerError(`${command}: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new RunnerError(`${command} exited ${code}: ${errOut.slice(0, 400)}`));
      } else resolve(out);
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** `claude` / `claude:<model>` — the Claude Code CLI in print mode. */
function claudeRunner(model: string): RepairRunner {
  return {
    id: `claude:${model}`,
    async repair(prompt: string): Promise<string> {
      const out = await run('claude', ['-p', '--output-format', 'json', '--model', model], prompt);
      try {
        const wrapper = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (wrapper.is_error || typeof wrapper.result !== 'string') {
          throw new Error('wrapper carried an error or no result');
        }
        return wrapper.result;
      } catch (e) {
        throw new RunnerError(`claude output was not the expected JSON wrapper: ${e instanceof Error ? e.message : e}`);
      }
    },
  };
}

/** `cmd:<executable [args…]>` — prompt on stdin, reply JSON on stdout. The escape hatch. */
function cmdRunner(commandLine: string): RepairRunner {
  const [executable, ...args] = commandLine.split(/\s+/);
  return {
    id: `cmd:${commandLine}`,
    repair: (prompt: string) => run(executable, args, prompt),
  };
}

/** POST JSON, return parsed body. Local-model prompts are big and slow —
 * generous default timeout, overridable via GOLDSEAM_HTTP_TIMEOUT_MS. */
async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const timeoutMs = Number(process.env.GOLDSEAM_HTTP_TIMEOUT_MS ?? 300_000);
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
    throw new RunnerError(`${url}: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
}

/** `ollama:<model>` — local HTTP, zero egress: the air-gapped story
 * (cypress#33927 / #32673). Host via OLLAMA_HOST (default localhost). */
function ollamaRunner(model: string): RepairRunner {
  const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  return {
    id: `ollama:${model}`,
    async repair(prompt: string): Promise<string> {
      const reply = (await postJson(
        `${host}/api/generate`,
        // format:'json' = ollama's constrained decoding — local models
        // reliably pick the right edit but flub JSON escaping without it
        // (probed: qwen2.5-14b escaped oldString's quotes, not newString's,
        // three attempts straight).
        { model, prompt, stream: false, format: 'json', options: { temperature: 0 } },
        {},
      )) as { response?: string };
      if (typeof reply.response !== 'string') {
        throw new RunnerError('ollama reply carried no response text');
      }
      return reply.response;
    },
  };
}

/** `openai:<model>` — any OpenAI-compatible chat endpoint (OpenAI proper,
 * a Modal/vLLM `serve` deployment, LM Studio, …). Base URL via
 * OPENAI_BASE_URL (default api.openai.com), key via OPENAI_API_KEY. */
function openaiRunner(model: string): RepairRunner {
  const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const key = process.env.OPENAI_API_KEY;
  return {
    id: `openai:${model}`,
    async repair(prompt: string): Promise<string> {
      const reply = (await postJson(
        `${base}/chat/completions`,
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0 },
        key ? { authorization: `Bearer ${key}` } : {},
      )) as { choices?: Array<{ message?: { content?: string } }> };
      const content = reply.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new RunnerError('openai-compatible reply carried no message content');
      }
      return content;
    },
  };
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
