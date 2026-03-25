import { describe, expect, it } from 'vitest';

import { createCompletionProtocol } from '../../../src/domain/completion-protocol.js';

describe('createCompletionProtocol', () => {
  it('会基于 nonce 生成反转的 done token', () => {
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });

    expect(protocol.nonce).toBe('abcd-1234-ef90');
    expect(protocol.doneToken).toBe('ef90-1234-abcd');
  });

  it('会生成包含 nonce 与确认文本的完成协议说明', () => {
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });

    expect(protocol.instructions).toContain('abcd-1234-ef90');
    expect(protocol.instructions).toContain('CONFIRMED: done');
  });

  it('只在消息严格等于两行时判定完成', () => {
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });

    expect(protocol.isSatisfied('ef90-1234-abcd\nCONFIRMED: done')).toBe(true);
    expect(protocol.isSatisfied('ef90-1234-abcd\nCONFIRMED: done\nextra')).toBe(false);
    expect(protocol.isSatisfied('ef90-1234-abcd\nwrong')).toBe(false);
  });

  it('在未提供 nonce 时会自动生成合法 nonce', () => {
    const protocol = createCompletionProtocol();

    expect(protocol.nonce).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(protocol.doneToken).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
  });

  it('会拒绝非法 nonce', () => {
    expect(() =>
      createCompletionProtocol({
        nonce: 'invalid'
      })
    ).toThrow(/无效的 nonce/);
  });
});
