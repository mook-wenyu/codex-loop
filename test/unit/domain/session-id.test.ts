import { describe, expect, it } from 'vitest';

import { extractLatestSessionId } from '../../../src/domain/session-id.js';

describe('extractLatestSessionId', () => {
  it('会从事件文本中提取最后一个 session id', () => {
    const events = [
      '{"type":"started","session_id":"11111111-1111-1111-1111-111111111111"}',
      '{"type":"continued","conversation_id":"22222222-2222-2222-2222-222222222222"}',
      '{"type":"ended","thread_id":"33333333-3333-3333-3333-333333333333"}'
    ].join('\n');

    expect(extractLatestSessionId(events)).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('在没有 session id 时返回 null', () => {
    expect(extractLatestSessionId('{"type":"message"}')).toBeNull();
  });
});
