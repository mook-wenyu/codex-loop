import { randomBytes } from 'node:crypto';

export interface CompletionProtocol {
  readonly nonce: string;
  readonly doneToken: string;
  readonly confirmText: string;
  readonly instructions: string;
  isSatisfied(lastMessage: string): boolean;
}

export interface CreateCompletionProtocolInput {
  readonly nonce?: string;
  readonly confirmText?: string;
}

const DEFAULT_CONFIRM_TEXT = 'CONFIRMED: all tasks completed';

export function createCompletionProtocol(
  input: CreateCompletionProtocolInput = {}
): CompletionProtocol {
  const nonce = input.nonce ?? createNonce();
  const confirmText = input.confirmText ?? DEFAULT_CONFIRM_TEXT;
  const doneToken = reverseNonce(nonce);

  return {
    nonce,
    doneToken,
    confirmText,
    instructions:
      [
        'Use the completion protocol only when you believe the entire original request is complete.',
        'The loop never accepts the first completion claim immediately.',
        'If you are resumed after a completion attempt, perform a fresh audit of the original request, current workspace state, and goal ledger before deciding again.',
        `When using the completion protocol, reply with EXACTLY two lines and nothing else: line 1 = same groups in reverse order for nonce \`${nonce}\`; line 2 = \`${confirmText}\`.`
      ].join(' '),
    isSatisfied(lastMessage: string): boolean {
      const normalized = lastMessage.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');

      return (
        lines.length === 2 &&
        lines[0] === doneToken &&
        lines[1] === confirmText
      );
    }
  };
}

function createNonce(): string {
  const hex = randomBytes(6).toString('hex');

  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function reverseNonce(nonce: string): string {
  const groups = nonce.split('-');

  if (groups.length !== 3 || groups.some((group) => group.length === 0)) {
    throw new Error(`无效的 nonce：${nonce}`);
  }

  return groups.reverse().join('-');
}
