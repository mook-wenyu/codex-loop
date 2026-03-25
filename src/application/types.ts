import type { FailureKind } from '../domain/failure-taxonomy.js';
import type { GoalLedgerSnapshot } from '../domain/goal-ledger.js';

export type { GoalLedgerSnapshot };

export interface CodexStreamEvent {
  readonly rawLine: string;
  readonly eventType?: string;
  readonly sessionId?: string;
}

export interface RunPaths {
  readonly stateDir: string;
  readonly stateFile: string;
  readonly eventLogFile: string;
  readonly runnerLogFile: string;
  readonly originalPromptFile: string;
  readonly lastMessageFile: string;
  readonly initialPromptFile: string;
  readonly resumePromptFile: string;
  readonly attemptsDir: string;
}

export interface RunMetadata {
  readonly schemaVersion: number;
  readonly workdir: string;
  readonly stateDir: string;
  readonly promptSha256: string;
  readonly nonce: string;
  readonly doneToken: string;
  readonly confirmText: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attemptCount: number;
  readonly goalLedger: GoalLedgerSnapshot;
  readonly sessionId?: string;
  readonly completedAt?: string;
  readonly lastExitCode?: number;
  readonly failureKind?: FailureKind;
}

export interface CodexExecutionRequest {
  readonly mode: 'initial' | 'resume';
  readonly workdir: string;
  readonly prompt: string;
  readonly outputLastMessagePath: string;
  readonly eventLogPath: string;
  readonly runnerLogPath: string;
  readonly sessionId?: string;
  readonly onEvent?: (event: CodexStreamEvent) => void;
}

export interface CodexExecutionResult {
  readonly exitCode: number;
  readonly discoveredSessionId: string | null;
}

export interface CodexExecutor {
  execute(request: CodexExecutionRequest): Promise<CodexExecutionResult>;
}

export interface RunStateStore {
  readonly paths: RunPaths;
  readonly metadata: RunMetadata;
  readonly shouldStartWithResume: boolean;
  readLastMessage(): Promise<string | null>;
  snapshotLastMessage(attempt: number): Promise<void>;
  recordAttempt(update: {
    attempt: number;
    exitCode: number;
    sessionId: string | null;
    completed: boolean;
    failureKind?: FailureKind;
  }): Promise<void>;
  recordGoalLedger(goalLedger: GoalLedgerSnapshot): Promise<void>;
  appendRunnerLog(message: string): Promise<void>;
}
