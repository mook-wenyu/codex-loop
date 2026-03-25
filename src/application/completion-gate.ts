import type { FailureKind } from '../domain/failure-taxonomy.js';

export interface CompletionGateOutcome {
  readonly status: 'confirmed' | 'retry';
  readonly summary: string;
  readonly failureKind?: FailureKind;
}

export function evaluateCompletionGate(input: {
  readonly previousFailureKind: FailureKind | undefined;
}): CompletionGateOutcome {
  if (input.previousFailureKind === 'completion-review-required') {
    return {
      status: 'confirmed',
      summary:
        'Completion was requested again after a fresh audit turn. The loop accepts completion now.'
    };
  }

  return {
    status: 'retry',
    summary: [
      'A completion attempt was detected, but the loop requires one fresh audit turn before stopping.',
      'Resume the same session, re-check the original request, current workspace state, and goal ledger from scratch.',
      'If anything remains unfinished or uncertain, continue working and do not use the completion protocol.',
      'Only if everything is still complete after that audit may the completion protocol be used again.'
    ].join('\n'),
    failureKind: 'completion-review-required'
  };
}
