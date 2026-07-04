import { RepairRunner } from '../src/heal/types';

/** Deterministic RepairRunner for engine/stage tests: replays `replies` in
 * order (the last one repeats) and counts calls, so a test can assert both
 * WHAT was proposed and HOW MANY model calls were spent. */
export function stubRunner(replies: string[]): RepairRunner & { calls: number } {
  const runner = {
    id: 'cmd:stub',
    calls: 0,
    async repair(): Promise<string> {
      const reply = replies[Math.min(runner.calls, replies.length - 1)];
      runner.calls++;
      return reply;
    },
  };
  return runner;
}
