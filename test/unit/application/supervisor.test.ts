import { describe, expect, it, vi } from 'vitest';

import { createCompletionProtocol } from '../../../src/domain/completion-protocol.js';
import {
  createEmptyGoalLedger,
  type GoalLedgerSnapshot
} from '../../../src/domain/goal-ledger.js';
import {
  MaxAttemptsExceededError,
  runSupervisor
} from '../../../src/application/supervisor.js';
import type {
  ProgressEvent,
  ProgressReporter
} from '../../../src/application/progress.js';
import type {
  CodexExecutionRequest,
  CodexExecutionResult,
  RunMetadata,
  RunPaths,
  RunStateStore
} from '../../../src/application/types.js';

class InMemoryStateStore implements RunStateStore {
  readonly paths: RunPaths = {
    stateDir: '/state',
    stateFile: '/state/state.json',
    eventLogFile: '/state/events.jsonl',
    runnerLogFile: '/state/runner.log',
    originalPromptFile: '/state/original-prompt.txt',
    lastMessageFile: '/state/last-message.txt',
    initialPromptFile: '/state/initial-prompt.txt',
    resumePromptFile: '/state/resume-prompt.txt',
    attemptsDir: '/state/attempts'
  };

  metadata: RunMetadata = {
    schemaVersion: 4,
    workdir: '/repo',
    stateDir: '/state',
    promptSha256: 'prompt-hash',
    nonce: 'abcd-1234-ef90',
    doneToken: 'ef90-1234-abcd',
    confirmText: 'CONFIRMED: done',
    createdAt: '2026-03-25T07:30:00.000Z',
    updatedAt: '2026-03-25T07:30:00.000Z',
    attemptCount: 0,
    goalLedger: createEmptyGoalLedger()
  };

  shouldStartWithResume = false;
  lastMessage: string | null = null;
  snapshots: number[] = [];
  runnerLogs: string[] = [];

  async readLastMessage(): Promise<string | null> {
    return this.lastMessage;
  }

  async snapshotLastMessage(attempt: number): Promise<void> {
    this.snapshots.push(attempt);
  }

  async recordAttempt(update: {
    attempt: number;
    exitCode: number;
    sessionId: string | null;
    completed: boolean;
    failureKind?: RunMetadata['failureKind'];
  }): Promise<void> {
    const {
      completedAt: _completedAt,
      failureKind: _failureKind,
      ...currentMetadata
    } = this.metadata;
    const updatedAt = '2026-03-25T07:31:00.000Z';

    this.metadata = {
      ...currentMetadata,
      attemptCount: update.attempt,
      updatedAt,
      lastExitCode: update.exitCode,
      ...(update.sessionId === null ? {} : { sessionId: update.sessionId }),
      ...(update.completed ? { completedAt: updatedAt } : {}),
      ...(update.failureKind === undefined
        ? {}
        : { failureKind: update.failureKind })
    };
  }

  async recordGoalLedger(goalLedger: GoalLedgerSnapshot): Promise<void> {
    this.metadata = {
      ...this.metadata,
      updatedAt: '2026-03-25T07:31:00.000Z',
      goalLedger
    };
  }

  async appendRunnerLog(message: string): Promise<void> {
    this.runnerLogs.push(message);
  }
}

function createSupervisorInput(input: {
  store?: InMemoryStateStore;
  executor: {
    execute(request: CodexExecutionRequest): Promise<CodexExecutionResult>;
  };
  sleep?: (milliseconds: number) => Promise<void>;
  resumePromptBuilder?: (input: {
    basePrompt: string;
    failureKind?: RunMetadata['failureKind'];
    failureSummary?: string;
    goalLedger: GoalLedgerSnapshot;
  }) => string;
  maxAttempts?: number;
  progressReporter?: ProgressReporter;
}) {
  const protocol = createCompletionProtocol({
    nonce: 'abcd-1234-ef90',
    confirmText: 'CONFIRMED: done'
  });
  const store = input.store ?? new InMemoryStateStore();

  return {
    store,
    options: {
      executor: input.executor,
      store,
      protocol,
      intervalSeconds: 3,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      workdir: '/repo',
      ...(input.maxAttempts === undefined
        ? {}
        : { maxAttempts: input.maxAttempts }),
      ...(input.sleep === undefined ? {} : { sleep: input.sleep }),
      ...(input.resumePromptBuilder === undefined
        ? {}
        : { resumePromptBuilder: input.resumePromptBuilder }),
      ...(input.progressReporter === undefined
        ? {}
        : { progressReporter: input.progressReporter })
    }
  } as const;
}

describe('runSupervisor', () => {
  it('首次命中完成协议时不会立即退出，而是进入完成审查轮次；第二次确认后才结束', async () => {
    const sleep = vi.fn(async () => undefined);
    const calls: CodexExecutionRequest[] = [];
    const store = new InMemoryStateStore();
    const executor = {
      async execute(
        request: CodexExecutionRequest
      ): Promise<CodexExecutionResult> {
        calls.push(request);

        if (calls.length === 1) {
          store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
          return {
            exitCode: 0,
            discoveredSessionId: '11111111-1111-1111-1111-111111111111'
          };
        }

        store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
        return {
          exitCode: 0,
          discoveredSessionId: null
        };
      }
    };
    const input = createSupervisorInput({
      store,
      executor,
      sleep,
      resumePromptBuilder: ({ basePrompt, failureKind, failureSummary }) =>
        `${basePrompt}\n\nkind=${failureKind ?? 'none'}\n${failureSummary ?? ''}`
    });

    await runSupervisor(input.options);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.mode).toBe('initial');
    expect(calls[1]?.mode).toBe('resume');
    expect(calls[1]?.sessionId).toBe('11111111-1111-1111-1111-111111111111');
    expect(calls[1]?.prompt).toContain('kind=completion-review-required');
    expect(store.metadata.completedAt).toBe('2026-03-25T07:31:00.000Z');
    expect(store.metadata.failureKind).toBeUndefined();
    expect(store.snapshots).toEqual([1, 2]);
    expect(store.runnerLogs).toContain(
      '第 1 轮首次命中完成协议，进入完成审查轮次'
    );
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('如果完成审查轮次没有再次命中完成协议，会恢复到普通未完成状态并继续续跑', async () => {
    const store = new InMemoryStateStore();
    const calls: CodexExecutionRequest[] = [];
    const executor = {
      async execute(
        request: CodexExecutionRequest
      ): Promise<CodexExecutionResult> {
        calls.push(request);

        if (calls.length === 1) {
          store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
          return {
            exitCode: 0,
            discoveredSessionId: '11111111-1111-1111-1111-111111111111'
          };
        }

        if (calls.length === 2) {
          store.lastMessage = '复核后发现还没做完';
          return {
            exitCode: 0,
            discoveredSessionId: null
          };
        }

        if (calls.length === 3) {
          store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
          return {
            exitCode: 0,
            discoveredSessionId: null
          };
        }

        store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
        return {
          exitCode: 0,
          discoveredSessionId: null
        };
      }
    };
    const input = createSupervisorInput({
      store,
      executor,
      sleep: async () => undefined,
      maxAttempts: 4,
      resumePromptBuilder: ({ basePrompt, failureKind }) =>
        `${basePrompt}\nkind=${failureKind ?? 'none'}`
    });

    await runSupervisor(input.options);

    expect(calls).toHaveLength(4);
    expect(calls[1]?.prompt).toContain('kind=completion-review-required');
    expect(calls[2]?.prompt).toContain('kind=completion-missing');
    expect(store.metadata.completedAt).toBe('2026-03-25T07:31:00.000Z');
  });

  it('在存在历史状态时会从 resume 开始，并允许完成审查中的任务直接确认完成', async () => {
    const store = new InMemoryStateStore();
    store.shouldStartWithResume = true;
    store.metadata = {
      ...store.metadata,
      sessionId: '99999999-9999-9999-9999-999999999999',
      failureKind: 'completion-review-required'
    };
    const executor = {
      async execute(
        request: CodexExecutionRequest
      ): Promise<CodexExecutionResult> {
        store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
        expect(request.mode).toBe('resume');
        expect(request.sessionId).toBe('99999999-9999-9999-9999-999999999999');

        return {
          exitCode: 0,
          discoveredSessionId: null
        };
      }
    };
    const input = createSupervisorInput({
      store,
      executor
    });

    await runSupervisor(input.options);

    expect(store.metadata.completedAt).toBe('2026-03-25T07:31:00.000Z');
    expect(store.metadata.failureKind).toBeUndefined();
  });

  it('在超过最大尝试次数后抛出明确错误，并记录 execution-failed', async () => {
    const sleep = vi.fn(async () => undefined);
    const store = new InMemoryStateStore();
    const executor = {
      async execute(): Promise<CodexExecutionResult> {
        store.lastMessage = '还没完成';

        return {
          exitCode: 1,
          discoveredSessionId: null
        };
      }
    };
    const input = createSupervisorInput({
      store,
      executor,
      sleep,
      maxAttempts: 2
    });

    await expect(runSupervisor(input.options)).rejects.toBeInstanceOf(
      MaxAttemptsExceededError
    );

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(store.metadata.attemptCount).toBe(2);
    expect(store.metadata.failureKind).toBe('execution-failed');
  });

  it('会把上一轮结构化 Goal Ledger 注入下一轮 resume prompt', async () => {
    const store = new InMemoryStateStore();
    const calls: CodexExecutionRequest[] = [];
    const executor = {
      async execute(
        request: CodexExecutionRequest
      ): Promise<CodexExecutionResult> {
        calls.push(request);

        if (calls.length === 1) {
          store.lastMessage = [
            '已完成：',
            '- 已补齐完成审查测试',
            '未完成：',
            '- 继续收缩 CLI 选项',
            '阻塞项：',
            '- README 尚未同步'
          ].join('\n');
          return {
            exitCode: 0,
            discoveredSessionId: '11111111-1111-1111-1111-111111111111'
          };
        }

        store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
        return {
          exitCode: 0,
          discoveredSessionId: null
        };
      }
    };
    const input = createSupervisorInput({
      store,
      executor,
      sleep: async () => undefined,
      maxAttempts: 2,
      resumePromptBuilder: ({ basePrompt, goalLedger }) =>
        [
          basePrompt,
          '',
          'Goal ledger',
          `done=${goalLedger.completedItems.join(' | ')}`,
          `pending=${goalLedger.pendingItems.join(' | ')}`,
          `blocked=${goalLedger.blockedItems.join(' | ')}`
        ].join('\n')
    });

    await expect(runSupervisor(input.options)).rejects.toBeInstanceOf(
      MaxAttemptsExceededError
    );

    expect(calls).toHaveLength(2);
    expect(calls[1]?.prompt).toContain('Goal ledger');
    expect(calls[1]?.prompt).toContain('已补齐完成审查测试');
    expect(calls[1]?.prompt).toContain('继续收缩 CLI 选项');
    expect(calls[1]?.prompt).toContain('README 尚未同步');
  });

  it('会把尝试开始、Codex 事件、等待与最终完成广播给进度报告器', async () => {
    const store = new InMemoryStateStore();
    const progressEvents: ProgressEvent[] = [];
    const progressReporter: ProgressReporter = {
      report(event) {
        progressEvents.push(event);
      },
      close() {}
    };
    const executor = {
      async execute(
        request: CodexExecutionRequest
      ): Promise<CodexExecutionResult> {
        request.onEvent?.({
          rawLine:
            '{"type":"session.started","session_id":"11111111-1111-1111-1111-111111111111"}',
          eventType: 'session.started',
          sessionId: '11111111-1111-1111-1111-111111111111'
        });

        if (
          progressEvents.filter((event) => event.type === 'attempt-started')
            .length === 1
        ) {
          store.lastMessage = '还没完成';
          return {
            exitCode: 0,
            discoveredSessionId: '11111111-1111-1111-1111-111111111111'
          };
        }

        store.lastMessage = 'ef90-1234-abcd\nCONFIRMED: done';
        return {
          exitCode: 0,
          discoveredSessionId: null
        };
      }
    };
    const input = createSupervisorInput({
      store,
      executor,
      sleep: async () => undefined,
      progressReporter
    });

    await runSupervisor(input.options);

    expect(progressEvents).toEqual(
      expect.arrayContaining([
        {
          type: 'run-started',
          initialMode: 'initial',
          stateDir: '/state',
          workdir: '/repo'
        },
        {
          type: 'attempt-started',
          attempt: 1,
          mode: 'initial'
        },
        {
          type: 'codex-event',
          attempt: 1,
          eventType: 'session.started',
          sessionId: '11111111-1111-1111-1111-111111111111'
        },
        {
          type: 'sleep-started',
          attempt: 1,
          seconds: 3
        },
        {
          type: 'attempt-started',
          attempt: 2,
          mode: 'resume'
        },
        {
          type: 'attempt-started',
          attempt: 3,
          mode: 'resume'
        },
        {
          type: 'run-completed',
          attempt: 3
        }
      ])
    );
  });
});
