import { describe, expect, it } from 'vitest';

import {
  decodeCodexEventChunk,
  flushCodexEventCarry
} from '../../../src/infrastructure/codex/codex-event-stream.js';

describe('decodeCodexEventChunk', () => {
  it('会从完整 JSONL 事件中提取事件类型与 session id', () => {
    const output = decodeCodexEventChunk(
      '',
      [
        '{"type":"session.started","session_id":"11111111-1111-1111-1111-111111111111"}',
        '{"type":"message.delta"}',
        ''
      ].join('\n')
    );

    expect(output.carry).toBe('');
    expect(output.events).toEqual([
      {
        rawLine:
          '{"type":"session.started","session_id":"11111111-1111-1111-1111-111111111111"}',
        eventType: 'session.started',
        sessionId: '11111111-1111-1111-1111-111111111111'
      },
      {
        rawLine: '{"type":"message.delta"}',
        eventType: 'message.delta'
      }
    ]);
  });

  it('会保留未结束行并在下一块补全后解析', () => {
    const firstChunk = decodeCodexEventChunk(
      '',
      '{"type":"thread.started","session_id":"22222222-2222-2222-2222-2222'
    );
    const secondChunk = decodeCodexEventChunk(
      firstChunk.carry,
      '22222222"}\n{"type":"turn.completed"}\n'
    );

    expect(firstChunk.events).toEqual([]);
    expect(secondChunk.carry).toBe('');
    expect(secondChunk.events).toEqual([
      {
        rawLine:
          '{"type":"thread.started","session_id":"22222222-2222-2222-2222-222222222222"}',
        eventType: 'thread.started',
        sessionId: '22222222-2222-2222-2222-222222222222'
      },
      {
        rawLine: '{"type":"turn.completed"}',
        eventType: 'turn.completed'
      }
    ]);
  });
});

describe('flushCodexEventCarry', () => {
  it('会在进程结束时处理没有换行结尾的最后一条事件', () => {
    expect(
      flushCodexEventCarry(
        '{"type":"conversation.started","conversation_id":"33333333-3333-3333-3333-333333333333"}'
      )
    ).toEqual([
      {
        rawLine:
          '{"type":"conversation.started","conversation_id":"33333333-3333-3333-3333-333333333333"}',
        eventType: 'conversation.started',
        sessionId: '33333333-3333-3333-3333-333333333333'
      }
    ]);
  });

  it('会忽略仅包含空白的尾部缓存', () => {
    expect(flushCodexEventCarry('   \n\t')).toEqual([]);
  });
});
