import { extractLatestSessionId } from '../../domain/session-id.js';
import type { CodexStreamEvent } from '../../application/types.js';

export interface DecodedCodexEventChunk {
  readonly events: readonly CodexStreamEvent[];
  readonly carry: string;
}

export function decodeCodexEventChunk(
  carry: string,
  chunkText: string
): DecodedCodexEventChunk {
  const combined = `${carry}${chunkText}`;
  const lines = combined.split(/\r?\n/u);
  const trailingLine = combined.endsWith('\n') ? '' : (lines.pop() ?? '');

  return {
    carry: trailingLine,
    events: lines.flatMap((line) => decodeCodexEventLine(line))
  };
}

export function flushCodexEventCarry(
  carry: string
): readonly CodexStreamEvent[] {
  return decodeCodexEventLine(carry);
}

function decodeCodexEventLine(rawLine: string): readonly CodexStreamEvent[] {
  const normalizedLine = rawLine.trim();

  if (normalizedLine.length === 0) {
    return [];
  }

  const eventType = readEventType(normalizedLine);
  const sessionId = extractLatestSessionId(normalizedLine);

  return [
    {
      rawLine: normalizedLine,
      ...(eventType === undefined ? {} : { eventType }),
      ...(sessionId === null ? {} : { sessionId })
    }
  ];
}

function readEventType(rawLine: string): string | undefined {
  try {
    const parsed = JSON.parse(rawLine) as {
      readonly type?: unknown;
    };

    return typeof parsed.type === 'string' ? parsed.type : undefined;
  } catch {
    return undefined;
  }
}
