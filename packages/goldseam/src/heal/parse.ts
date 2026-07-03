// Strict parsing of the model reply. Models fence JSON despite
// instructions; tolerate exactly that and nothing else.

import { RepairReply } from './types';

export class ReplyParseError extends Error {}

export function parseRepairReply(raw: string): RepairReply {
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
  const reply = parsed as RepairReply;

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
  if (typeof reply.confidence !== 'number' || reply.confidence < 0 || reply.confidence > 1) {
    throw new ReplyParseError('confidence must be a number in [0, 1]');
  }
  return reply;
}
