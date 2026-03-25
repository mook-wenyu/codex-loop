const SESSION_ID_PATTERN =
  /"(session_id|conversation_id|thread_id)"\s*:\s*"([0-9a-fA-F-]{36})"/g;

export function extractLatestSessionId(eventsText: string): string | null {
  let latestSessionId: string | null = null;

  for (const match of eventsText.matchAll(SESSION_ID_PATTERN)) {
    latestSessionId = match[2] ?? null;
  }

  return latestSessionId;
}
