import type { FailureKind } from '../domain/failure-taxonomy.js';

export type ProgressEvent =
  | {
      readonly type: 'run-started';
      readonly initialMode: 'initial' | 'resume';
      readonly stateDir: string;
      readonly workdir: string;
    }
  | {
      readonly type: 'attempt-started';
      readonly attempt: number;
      readonly mode: 'initial' | 'resume';
    }
  | {
      readonly type: 'codex-event';
      readonly attempt: number;
      readonly eventType?: string;
      readonly sessionId?: string;
    }
  | {
      readonly type: 'attempt-finished';
      readonly attempt: number;
      readonly mode: 'initial' | 'resume';
      readonly exitCode: number;
      readonly completionRequested: boolean;
      readonly completed: boolean;
      readonly failureKind?: FailureKind;
    }
  | {
      readonly type: 'sleep-started';
      readonly attempt: number;
      readonly seconds: number;
    }
  | {
      readonly type: 'run-completed';
      readonly attempt: number;
    }
  | {
      readonly type: 'max-attempts-exceeded';
      readonly attempt: number;
      readonly maxAttempts: number;
    };

export interface ProgressReporter {
  report(event: ProgressEvent): void;
  close(): void;
}

export const noopProgressReporter: ProgressReporter = {
  report() {},
  close() {}
};
