import { stat } from 'node:fs/promises';
import { Writable } from 'node:stream';

import { runSupervisor } from './application/supervisor.js';
import { resolvePromptText } from './application/read-prompt.js';
import {
  isAiHelpRequest,
  isHelpRequest,
  isVersionRequest,
  readPackageVersion,
  renderAiHelpText,
  renderHelpText
} from './config/cli-meta.js';
import { parseCliOptions } from './config/options.js';
import { createCompletionProtocol } from './domain/completion-protocol.js';
import type { FailureKind } from './domain/failure-taxonomy.js';
import { createGoalContract } from './domain/goal-contract.js';
import { renderGoalLedgerBlock } from './domain/goal-ledger.js';
import { ExecaCodexExecutor } from './infrastructure/codex/codex-executor.js';
import { createCliProgressReporter } from './infrastructure/progress/cli-progress-reporter.js';
import { FileStateStore } from './infrastructure/state/state-store.js';

export interface CliRuntime {
  readonly stdout: Writable;
  readonly stderr: Writable & {
    readonly isTTY?: boolean;
    readonly columns?: number;
  };
  readonly now?: () => Date;
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  runtime: CliRuntime = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  if (isAiHelpRequest(argv)) {
    runtime.stdout.write(`${renderAiHelpText()}\n`);
    return 0;
  }

  if (isHelpRequest(argv)) {
    runtime.stdout.write(`${renderHelpText()}\n`);
    return 0;
  }

  if (isVersionRequest(argv)) {
    runtime.stdout.write(`${await readPackageVersion()}\n`);
    return 0;
  }

  const options = parseCliOptions({
    argv,
    cwd: process.cwd(),
    env
  });

  await ensureDirectoryExists(options.workdir);

  const promptText = await resolvePromptText(
    {
      ...(options.promptSource === undefined
        ? {}
        : { promptSource: options.promptSource }),
      ...(options.promptText === undefined
        ? {}
        : { promptText: options.promptText })
    },
    process.cwd()
  );

  if (promptText.trim().length === 0) {
    throw new Error('初始 prompt 不能为空。');
  }

  const goalContract = createGoalContract(promptText);
  const protocol = createCompletionProtocol({
    confirmText: options.confirmText
  });
  const initialPrompt = [
    goalContract.buildInitialPrompt(protocol.instructions).trimEnd(),
    '',
    renderLoopReviewBlock(),
    ''
  ].join('\n');
  const resumePrompt = buildResumePrompt({
    goalContract,
    resumeTextBase: options.resumeTextBase,
    protocolInstructions: protocol.instructions,
    goalLedgerBlock: renderGoalLedgerBlock(undefined)
  });
  const store = await FileStateStore.open({
    workdir: options.workdir,
    goalContract,
    initialPrompt,
    resumePrompt,
    protocol,
    now: runtime.now ?? (() => new Date()),
    ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir })
  });
  const progressReporter = createCliProgressReporter({
    stream: runtime.stderr,
    format: options.progressFormat,
    ...(runtime.now === undefined ? {} : { now: runtime.now })
  });
  const executor = new ExecaCodexExecutor({
    codexBin: options.codexBin,
    fullAuto: options.fullAuto,
    dangerouslyBypass: options.dangerouslyBypass,
    skipGitRepoCheck: options.skipGitRepoCheck,
    environment: env,
    ...(options.model === undefined ? {} : { model: options.model })
  });

  await store.appendRunnerLog(`stateDir=${store.paths.stateDir}`);
  await store.appendRunnerLog(`workdir=${options.workdir}`);
  await store.appendRunnerLog(`promptSha256=${goalContract.promptSha256}`);

  try {
    await runSupervisor({
      executor,
      store,
      protocol,
      intervalSeconds: options.intervalSeconds,
      ...(options.maxAttempts === undefined
        ? {}
        : { maxAttempts: options.maxAttempts }),
      initialPrompt,
      resumePrompt,
      resumePromptBuilder: ({ failureKind, failureSummary, goalLedger }) =>
        buildResumePrompt({
          goalContract,
          resumeTextBase: options.resumeTextBase,
          protocolInstructions: protocol.instructions,
          goalLedgerBlock: renderGoalLedgerBlock(goalLedger),
          ...(failureKind === undefined ? {} : { failureKind }),
          ...(failureSummary === undefined ? {} : { failureSummary })
        }),
      workdir: options.workdir,
      progressReporter
    });
  } finally {
    progressReporter.close();
  }

  return 0;
}

async function ensureDirectoryExists(directory: string): Promise<void> {
  const result = await stat(directory);

  if (!result.isDirectory()) {
    throw new Error(`WORKDIR 不是目录：${directory}`);
  }
}

function buildResumePrompt(input: {
  readonly goalContract: ReturnType<typeof createGoalContract>;
  readonly resumeTextBase: string;
  readonly protocolInstructions: string;
  readonly goalLedgerBlock: string;
  readonly failureKind?: FailureKind;
  readonly failureSummary?: string;
}): string {
  return [
    input.goalContract
      .buildResumePrompt(
        input.resumeTextBase,
        input.protocolInstructions,
        input.goalLedgerBlock
      )
      .trimEnd(),
    '',
    renderLoopReviewBlock(),
    ...(input.failureKind === undefined
      ? []
      : [
          '',
          ...renderFailurePromptBlock(
            input.failureKind,
            input.failureSummary
          )
        ]),
    ''
  ].join('\n');
}

function renderFailurePromptBlock(
  failureKind: FailureKind,
  failureSummary: string | undefined
): string[] {
  return [
    'Previous attempt status:',
    `Failure kind: ${failureKind}`,
    ...(failureSummary === undefined ? [] : [failureSummary]),
    failureInstruction(failureKind)
  ];
}

function failureInstruction(failureKind: FailureKind): string {
  if (failureKind === 'completion-review-required') {
    return 'A previous attempt requested completion. Perform a fresh audit of the original request, current workspace state, and goal ledger. If anything remains unfinished or uncertain, continue working and do not use the completion protocol. Only if the task is still complete after that audit may the completion protocol be used again.';
  }

  if (failureKind === 'execution-failed') {
    return 'Previous attempt exited before completion. Resume from the current repository state instead of restarting.';
  }

  return 'The previous attempt did not satisfy the completion protocol. Continue unfinished work instead of summarizing partial progress as complete.';
}

function renderLoopReviewBlock(): string {
  return [
    'Loop review contract:',
    '1. The loop does not accept the first completion claim immediately.',
    '2. After a completion attempt, the next resumed turn must re-check the original request, current workspace state, and goal ledger from scratch.',
    '3. If anything remains unfinished or uncertain, continue working and do not use the completion protocol.',
    '4. Only if the task is still complete after that fresh audit may the completion protocol be used again.'
  ].join('\n');
}
