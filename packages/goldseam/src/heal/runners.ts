// Model runners. Anything that maps a rendered prompt to raw reply text is
// a runner; the engine never knows which model (or whether a model at all)
// produced the reply. `openai:`/`anthropic:`/`ollama:` HTTP runners land in
// M5 behind this same interface.

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

export function resolveRunner(spec: string): RepairRunner {
  if (spec === 'claude') return claudeRunner('sonnet'); // dev/benchmark default: Sonnet 5
  if (spec.startsWith('claude:')) return claudeRunner(spec.slice('claude:'.length));
  if (spec.startsWith('cmd:')) return cmdRunner(spec.slice('cmd:'.length));
  throw new RunnerError(`unknown model runner "${spec}" (expected claude, claude:<model>, or cmd:<executable>)`);
}
