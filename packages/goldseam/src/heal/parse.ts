// Strict parsing of the model reply. Models fence JSON despite
// instructions; tolerate exactly that and nothing else.

import { RepairReply } from './types';

export class ReplyParseError extends Error {}

/** Fence-tolerant JSON-object parse — shared by every model reply path. */
export function parseJsonBlock(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ReplyParseError(`reply is not valid JSON: ${text.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ReplyParseError('reply is not a JSON object');
  }
  return parsed;
}

export function parseRepairReply(raw: string): RepairReply {
  const reply = parseJsonBlock(raw) as RepairReply;

  if (reply.giveUp) {
    if (typeof reply.giveUp.reason !== 'string' || !reply.giveUp.reason) {
      throw new ReplyParseError('giveUp.reason must be a non-empty string');
    }
    return reply;
  }
  if (!Array.isArray(reply.edits) || reply.edits.length === 0) {
    throw new ReplyParseError('reply must contain edits[] or giveUp');
  }
  for (const edit of reply.edits) {
    for (const key of ['file', 'oldString', 'newString'] as const) {
      if (typeof edit[key] !== 'string' || edit[key].length === 0) {
        throw new ReplyParseError(`edit.${key} must be a non-empty string`);
      }
    }
  }
  // Lenient input, strict meaning: smaller models misplace metadata INSIDE
  // the edit objects (probed: qwen2.5-14b nested confidence/reasoning in
  // edits[0]). Hoist when the top level lacks them — min confidence across
  // edits, first reasoning — then validate strictly as usual.
  if (reply.confidence === undefined && Array.isArray(reply.edits)) {
    const nested = (reply.edits as unknown as Array<Record<string, unknown>>)
      .map((e) => (typeof e.confidence === 'string' ? Number(e.confidence) : e.confidence))
      .filter((c): c is number => typeof c === 'number' && !Number.isNaN(c));
    if (nested.length > 0) reply.confidence = Math.min(...nested);
    if (reply.reasoning === undefined) {
      const r = (reply.edits as unknown as Array<Record<string, unknown>>).find((e) => typeof e.reasoning === 'string');
      if (r) reply.reasoning = r.reasoning as string;
    }
  }
  // Smaller models under JSON-constrained decoding also stringify numbers
  // ("0.9") — unambiguous, so coerce. Anything non-numeric still rejects.
  if (typeof reply.confidence === 'string' && /^\d*\.?\d+$/.test(reply.confidence)) {
    reply.confidence = Number(reply.confidence);
  }
  if (typeof reply.confidence !== 'number' || reply.confidence < 0 || reply.confidence > 1) {
    throw new ReplyParseError('confidence must be a number in [0, 1]');
  }
  return reply;
}
