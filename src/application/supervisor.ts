import { setTimeout as sleepFor } from 'node:timers/promises';

import { evaluateCompletionGate } from './completion-gate.js';
import {
  noopProgressReporter,
  type ProgressReporter
} from './progress.js';
import type { CompletionProtocol } from '../domain/completion-protocol.js';
import type { FailureKind } from '../domain/failure-taxonomy.js';
import {
  updateGoalLedger,
  type GoalLedgerSnapshot
} from '../domain/goal-ledger.js';
import type {
  CodexExecutor,
  CodexExecutionRequest,
  RunMetadata,
  RunStateStore
} from './types.js';

interface FailureContext {
  readonly kind: FailureKind;
  readonly summary: string;
}

export interface RunSupervisorOptions {
  readonly executor: CodexExecutor;
  readonly store: RunStateStore;
  readonly protocol: CompletionProtocol;
  readonly intervalSeconds: number;
  readonly maxAttempts?: number;
  readonly initialPrompt: string;
  readonly resumePrompt: string;
  readonly resumePromptBuilder?: (input: {
    readonly basePrompt: string;
    readonly failureKind?: FailureKind;
    readonly failureSummary?: string;
    readonly goalLedger: GoalLedgerSnapshot;
  }) => string;
  readonly workdir: string;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly progressReporter?: ProgressReporter;
}

export class MaxAttemptsExceededError extends Error {
  constructor(maxAttempts: number) {
    super(`已达到最大尝试次数：${maxAttempts}`);
    this.name = 'MaxAttemptsExceededError';
  }
}

export async function runSupervisor(
  options: RunSupervisorOptions
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const progressReporter = options.progressReporter ?? noopProgressReporter;
  let attempt = 0;
  let shouldResume = options.store.shouldStartWithResume;
  let failureContext = restoreFailureContext(options.store.metadata);

  await options.store.appendRunnerLog(
    `启动守护循环，初始模式=${shouldResume ? 'resume' : 'initial'}`
  );
  progressReporter.report({
    type: 'run-started',
    initialMode: shouldResume ? 'resume' : 'initial',
    stateDir: options.store.paths.stateDir,
    workdir: options.workdir
  });

  while (true) {
    if (
      options.maxAttempts !== undefined &&
      attempt >= options.maxAttempts
    ) {
      progressReporter.report({
        type: 'max-attempts-exceeded',
        attempt,
        maxAttempts: options.maxAttempts
      });
      throw new MaxAttemptsExceededError(options.maxAttempts);
    }

    attempt += 1;
    const request = buildExecutionRequest({
      attempt,
      shouldResume,
      options,
      ...(failureContext === undefined ? {} : { failureContext })
    });

    await options.store.appendRunnerLog(
      `开始第 ${attempt} 轮，模式=${request.mode}`
    );
    progressReporter.report({
      type: 'attempt-started',
      attempt,
      mode: request.mode
    });

    const result = await options.executor.execute(request);

    await options.store.snapshotLastMessage(attempt);
    const lastMessage = await options.store.readLastMessage();
    const previousFailureKind = options.store.metadata.failureKind;
    const completionRequested =
      lastMessage !== null && options.protocol.isSatisfied(lastMessage);
    const completionGate = completionRequested
      ? evaluateCompletionGate({
          previousFailureKind
        })
      : undefined;
    const completed = completionGate?.status === 'confirmed';
    const nextFailureKind = completed
      ? undefined
      : completionRequested
        ? completionGate?.failureKind
        : classifyIncompleteFailure(result.exitCode);
    const failureSummary =
      completionRequested && completionGate !== undefined
        ? completionGate.summary
        : buildFailureSummary(
            nextFailureKind ?? 'completion-missing',
            result.exitCode
          );

    await options.store.recordAttempt({
      attempt,
      exitCode: result.exitCode,
      sessionId: result.discoveredSessionId,
      completed,
      ...(nextFailureKind === undefined ? {} : { failureKind: nextFailureKind })
    });

    await options.store.recordGoalLedger(
      updateGoalLedger({
        previous: options.store.metadata.goalLedger,
        assistantMessage: lastMessage,
        completionSatisfied: completed,
        ...(nextFailureKind === undefined
          ? {}
          : {
              failureKind: nextFailureKind,
              failureSummary
            })
      })
    );

    if (completed) {
      progressReporter.report({
        type: 'attempt-finished',
        attempt,
        mode: request.mode,
        exitCode: result.exitCode,
        completionRequested,
        completed,
        ...(nextFailureKind === undefined
          ? {}
          : { failureKind: nextFailureKind })
      });
      progressReporter.report({
        type: 'run-completed',
        attempt
      });
      await options.store.appendRunnerLog(
        `第 ${attempt} 轮在完成审查后再次命中完成协议，停止守护循环`
      );
      return;
    } else {
      progressReporter.report({
        type: 'attempt-finished',
        attempt,
        mode: request.mode,
        exitCode: result.exitCode,
        completionRequested,
        completed,
        ...(nextFailureKind === undefined
          ? {}
          : { failureKind: nextFailureKind })
      });
      const unresolvedFailureKind = nextFailureKind ?? 'completion-missing';

      failureContext = {
        kind: unresolvedFailureKind,
        summary: failureSummary
      };

      await options.store.appendRunnerLog(
        completionRequested
          ? `第 ${attempt} 轮首次命中完成协议，进入完成审查轮次`
          : unresolvedFailureKind === 'execution-failed'
          ? `第 ${attempt} 轮 Codex 非零退出且未命中完成协议，视为执行失败，继续续跑`
          : `第 ${attempt} 轮未命中完成协议，继续续跑`
      );
    }

    if (
      options.maxAttempts !== undefined &&
      attempt >= options.maxAttempts
    ) {
      progressReporter.report({
        type: 'max-attempts-exceeded',
        attempt,
        maxAttempts: options.maxAttempts
      });
      throw new MaxAttemptsExceededError(options.maxAttempts);
    }

    await options.store.appendRunnerLog(
      `第 ${attempt} 轮未完成，${options.intervalSeconds} 秒后继续`
    );
    progressReporter.report({
      type: 'sleep-started',
      attempt,
      seconds: options.intervalSeconds
    });
    await sleep(options.intervalSeconds * 1000);
    shouldResume = true;
  }
}

function buildExecutionRequest(input: {
  attempt: number;
  shouldResume: boolean;
  options: RunSupervisorOptions;
  failureContext?: FailureContext;
}): CodexExecutionRequest {
  const { options, shouldResume, failureContext } = input;

  return {
    mode: shouldResume ? 'resume' : 'initial',
    workdir: options.workdir,
    prompt: shouldResume
      ? (options.resumePromptBuilder?.({
          basePrompt: options.resumePrompt,
          ...(failureContext === undefined
            ? {}
            : {
                failureKind: failureContext.kind,
                failureSummary: failureContext.summary
              }),
          goalLedger: options.store.metadata.goalLedger
        }) ?? options.resumePrompt)
      : options.initialPrompt,
    outputLastMessagePath: options.store.paths.lastMessageFile,
    eventLogPath: options.store.paths.eventLogFile,
    runnerLogPath: options.store.paths.runnerLogFile,
    onEvent: (event) => {
      const sessionId = event.sessionId;

      options.progressReporter?.report({
        type: 'codex-event',
        attempt: input.attempt,
        ...(event.eventType === undefined
          ? {}
          : { eventType: event.eventType }),
        ...(sessionId === undefined ? {} : { sessionId })
      });
    },
    ...(shouldResume && options.store.metadata.sessionId
      ? { sessionId: options.store.metadata.sessionId }
      : {})
  };
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await sleepFor(milliseconds);
}

function classifyIncompleteFailure(exitCode: number): FailureKind {
  return exitCode === 0 ? 'completion-missing' : 'execution-failed';
}

function buildFailureSummary(
  failureKind: FailureKind,
  exitCode: number | undefined
): string {
  if (failureKind === 'completion-review-required') {
    return [
      'A completion attempt was detected, but the loop requires one fresh audit turn before stopping.',
      'Resume the same session and re-check the original request, current workspace state, and goal ledger from scratch.',
      'Only if everything is still complete after that audit may the completion protocol be used again.'
    ].join('\n');
  }

  if (failureKind === 'execution-failed') {
    return `Previous attempt exited with code ${exitCode ?? 'unknown'} before satisfying the completion protocol.`;
  }

  return 'Previous attempt did not satisfy the completion protocol yet. Continue the unfinished work from the current repository state.';
}

function restoreFailureContext(
  metadata: RunMetadata
): FailureContext | undefined {
  if (metadata.failureKind === undefined) {
    return undefined;
  }

  return {
    kind: metadata.failureKind,
    summary: buildFailureSummary(metadata.failureKind, metadata.lastExitCode)
  };
}
