// Runner matrix: spec resolution + HTTP request/reply shapes against a
// local stub server (deterministic — no real models, CI-safe).

import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ollamaNumCtx, resolveRunner, RunnerError } from '../src/heal/runners';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function stub(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => handler(req, body, res));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
    });
  });
}

describe('resolveRunner specs', () => {
  it('resolves every documented family and rejects the rest', () => {
    expect(resolveRunner('claude').id).toBe('claude:sonnet');
    expect(resolveRunner('ollama:qwen2.5:14b-instruct').id).toBe('ollama:qwen2.5:14b-instruct');
    expect(resolveRunner('openai:qwen-vllm').id).toBe('openai:qwen-vllm');
    expect(() => resolveRunner('bard:1')).toThrow(RunnerError);
  });
});

describe('ollama runner', () => {
  it('POSTs /api/generate non-streaming at temperature 0 and returns response', async () => {
    let seen: Record<string, unknown> = {};
    const url = await stub((req, body, res) => {
      seen = { url: req.url, ...JSON.parse(body) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ response: '{"giveUp":{"reason":"stub"}}' }));
    });
    process.env.OLLAMA_HOST = url;
    try {
      const out = await resolveRunner('ollama:qwen2.5:7b-instruct').repair('PROMPT');
      expect(out).toContain('giveUp');
      expect(seen).toMatchObject({
        url: '/api/generate',
        model: 'qwen2.5:7b-instruct',
        prompt: 'PROMPT',
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      });
      // num_ctx is sized to the prompt (never left at ollama's silently-
      // truncating ~4K default) — a short prompt gets the floor.
      expect((seen.options as { num_ctx?: number }).num_ctx).toBe(8_192);
    } finally {
      delete process.env.OLLAMA_HOST;
    }
  });

  it('turns HTTP errors into RunnerError with the status', async () => {
    const url = await stub((_req, _body, res) => {
      res.statusCode = 404;
      res.end('model not found');
    });
    process.env.OLLAMA_HOST = url;
    try {
      await expect(resolveRunner('ollama:nope').repair('x')).rejects.toThrow(/HTTP 404/);
    } finally {
      delete process.env.OLLAMA_HOST;
    }
  });
});

describe('openai-compatible runner', () => {
  it('POSTs chat/completions with bearer auth and returns the content', async () => {
    let seen: Record<string, unknown> = {};
    let auth: string | undefined;
    const url = await stub((req, body, res) => {
      auth = req.headers.authorization;
      seen = { url: req.url, ...JSON.parse(body) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'REPLY' } }] }));
    });
    process.env.OPENAI_BASE_URL = `${url}/v1`;
    process.env.OPENAI_API_KEY = 'sk-test';
    try {
      const out = await resolveRunner('openai:qwen-14b').repair('PROMPT');
      expect(out).toBe('REPLY');
      expect(auth).toBe('Bearer sk-test');
      expect(seen).toMatchObject({
        url: '/v1/chat/completions',
        model: 'qwen-14b',
        temperature: 0,
        messages: [{ role: 'user', content: 'PROMPT' }],
        max_tokens: 8192, // bounded so a tiny-default endpoint can't truncate the edit JSON
        // schema-constrained JSON (json_object makes vLLM's decoder run away)
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'goldseam_repair', schema: { type: 'object' } },
        },
      });
    } finally {
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('degrades to an unconstrained request when the endpoint rejects json_schema', async () => {
    // An endpoint that does not support response_format json_schema 400s; the
    // runner must retry ONCE without it rather than fail every capture.
    const bodies: Array<Record<string, unknown>> = [];
    const url = await stub((_req, body, res) => {
      const json = JSON.parse(body);
      bodies.push(json);
      if (json.response_format) {
        res.statusCode = 400;
        res.end('response_format json_schema is not supported by this model');
      } else {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'DEGRADED' } }] }));
      }
    });
    process.env.OPENAI_BASE_URL = `${url}/v1`;
    try {
      const out = await resolveRunner('openai:x').repair('PROMPT');
      expect(out).toBe('DEGRADED'); // second (unconstrained) attempt succeeded
      expect(bodies).toHaveLength(2);
      expect(bodies[0].response_format).toBeTruthy(); // first tried the schema
      expect(bodies[1].response_format).toBeUndefined(); // retry dropped it
      // everything else preserved on the retry — crucially the prompt bytes,
      // so a degrade that silently dropped/altered the prompt would fail here
      expect(bodies[1].messages).toEqual(bodies[0].messages);
      expect(bodies[1].model).toBe(bodies[0].model);
      expect(bodies[1].temperature).toBe(0);
      expect(bodies[1].max_tokens).toBe(8192);
    } finally {
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('does NOT degrade on a non-schema 400 (e.g. context length) — surfaces it', async () => {
    let calls = 0;
    const url = await stub((_req, _body, res) => {
      calls++;
      res.statusCode = 400;
      res.end("This model's maximum context length is 8192 tokens");
    });
    process.env.OPENAI_BASE_URL = `${url}/v1`;
    try {
      await expect(resolveRunner('openai:x').repair('PROMPT')).rejects.toThrow(/HTTP 400/);
      expect(calls).toBe(1); // no pointless retry a context-length error can't fix
    } finally {
      delete process.env.OPENAI_BASE_URL;
    }
  });
});

describe('ollamaNumCtx — sizes the context to the prompt (no silent truncation)', () => {
  it('floors small prompts and never returns ollama\'s truncating default', () => {
    expect(ollamaNumCtx('x')).toBe(8_192);
    expect(ollamaNumCtx('x'.repeat(1000))).toBe(8_192);
  });
  it('grows past the floor for a deep-page prompt so the target is never cut', () => {
    // ~200K chars (a Squarespace-depth DOM window) -> well past the 4K default.
    const ctx = ollamaNumCtx('x'.repeat(200_000));
    expect(ctx).toBeGreaterThan(60_000);
    expect(ctx).toBeLessThanOrEqual(131_072);
  });
  it('caps an enormous prompt and honors the env override', () => {
    expect(ollamaNumCtx('x'.repeat(10_000_000))).toBe(131_072); // hard cap
    process.env.GOLDSEAM_OLLAMA_NUM_CTX = '16384';
    try {
      expect(ollamaNumCtx('x'.repeat(200_000))).toBe(16_384); // override wins
    } finally {
      delete process.env.GOLDSEAM_OLLAMA_NUM_CTX;
    }
  });

  it('ignores an invalid env override (0 / negative / non-numeric) and sizes normally', () => {
    // A `> 0`-to-`>= 0` slip would let GOLDSEAM_OLLAMA_NUM_CTX=0 return num_ctx:0
    // — catastrophic silent truncation, the exact failure this function prevents.
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.GOLDSEAM_OLLAMA_NUM_CTX = bad;
      try {
        expect(ollamaNumCtx('x'.repeat(1000))).toBe(8_192); // fell through to sizing, never 0/NaN
      } finally {
        delete process.env.GOLDSEAM_OLLAMA_NUM_CTX;
      }
    }
  });
});
