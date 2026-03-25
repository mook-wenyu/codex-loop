import { createHash } from 'node:crypto';

export interface GoalContract {
  readonly originalPrompt: string;
  readonly promptSha256: string;
  renderBlock(): string;
  buildInitialPrompt(protocolInstructions: string): string;
  buildResumePrompt(
    resumeTextBase: string,
    protocolInstructions: string,
    goalLedgerBlock?: string
  ): string;
}

export function createGoalContract(originalPrompt: string): GoalContract {
  const promptSha256 = createHash('sha256')
    .update(originalPrompt, 'utf8')
    .digest('hex');

  return {
    originalPrompt,
    promptSha256,
    renderBlock(): string {
      return [
        'Original user request (authoritative, do not narrow or reinterpret):',
        `Prompt SHA-256: ${promptSha256}`,
        '<<<ORIGINAL_USER_REQUEST',
        originalPrompt,
        'ORIGINAL_USER_REQUEST'
      ].join('\n');
    },
    buildInitialPrompt(protocolInstructions: string): string {
      return [
        originalPrompt,
        '',
        `Prompt SHA-256: ${promptSha256}`,
        '',
        protocolInstructions,
        ''
      ].join('\n');
    },
    buildResumePrompt(
      resumeTextBase: string,
      protocolInstructions: string,
      goalLedgerBlock?: string
    ): string {
      return [
        resumeTextBase,
        '',
        'The original user request below remains authoritative for this resumed run.',
        'Do not narrow the goal to only the latest partial result or stage output.',
        this.renderBlock(),
        ...(goalLedgerBlock === undefined ? [] : ['', goalLedgerBlock]),
        '',
        protocolInstructions,
        ''
      ].join('\n');
    }
  };
}
