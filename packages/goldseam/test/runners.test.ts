// Runner matrix: spec resolution + HTTP request/reply shapes against a
// local stub server (deterministic — no real models, CI-safe).

import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRunner, RunnerError } from '../src/heal/runners';

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
      });
    } finally {
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
    }
  });
});
