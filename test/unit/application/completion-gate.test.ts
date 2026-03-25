import { describe, expect, it } from 'vitest';

import { evaluateCompletionGate } from '../../../src/application/completion-gate.js';

describe('evaluateCompletionGate', () => {
  it('首次命中完成协议时不会立即结束，而是进入完成审查轮次', () => {
    const outcome = evaluateCompletionGate({
      previousFailureKind: undefined
    });

    expect(outcome.status).toBe('retry');
    expect(outcome.failureKind).toBe('completion-review-required');
    expect(outcome.summary).toContain('fresh audit');
  });

  it('在完成审查轮次再次命中完成协议时才真正确认完成', () => {
    const outcome = evaluateCompletionGate({
      previousFailureKind: 'completion-review-required'
    });

    expect(outcome.status).toBe('confirmed');
    expect(outcome.failureKind).toBeUndefined();
  });
});
