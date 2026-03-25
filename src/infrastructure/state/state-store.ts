import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
  appendFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CompletionProtocol } from '../../domain/completion-protocol.js';
import type { GoalContract } from '../../domain/goal-contract.js';
import { createEmptyGoalLedger } from '../../domain/goal-ledger.js';
import { STATE_DIR_PREFIX } from '../../config/product.js';
import type {
  RunMetadata,
  RunPaths,
  RunStateStore
} from '../../application/types.js';
import type { GoalLedgerSnapshot } from '../../domain/goal-ledger.js';

const STATE_SCHEMA_VERSION = 4;

export interface FileStateStoreOpenOptions {
  readonly stateDir?: string;
  readonly workdir: string;
  readonly goalContract: GoalContract;
  readonly initialPrompt: string;
  readonly resumePrompt: string;
  readonly protocol: CompletionProtocol;
  readonly now: () => Date;
}

export class FileStateStore implements RunStateStore {
  static async open(
    options: FileStateStoreOpenOptions
  ): Promise<FileStateStore> {
    const stateDir =
      options.stateDir === undefined
        ? await mkdtemp(join(tmpdir(), `${STATE_DIR_PREFIX}-`))
        : resolve(options.stateDir);
    const paths = buildPaths(stateDir);

    await mkdir(paths.stateDir, { recursive: true });
    await mkdir(paths.attemptsDir, { recursive: true });

    const promptSha256 = options.goalContract.promptSha256;
    const existingMetadata = await loadExistingMetadata(paths.stateFile);
    const nowIso = options.now().toISOString();
    const metadata = existingMetadata
      ? rebuildExistingMetadata(existingMetadata, {
          workdir: options.workdir,
          promptSha256,
          protocol: options.protocol,
          nowIso
        })
      : createNewMetadata({
          workdir: options.workdir,
          stateDir: paths.stateDir,
          promptSha256,
          protocol: options.protocol,
          nowIso
        });

    const shouldStartWithResume =
      existingMetadata !== null &&
      (metadata.sessionId !== undefined || metadata.attemptCount > 0);

    await writeFile(paths.originalPromptFile, options.goalContract.originalPrompt, 'utf8');
    await writeFile(paths.initialPromptFile, options.initialPrompt, 'utf8');
    await writeFile(paths.resumePromptFile, options.resumePrompt, 'utf8');
    await writeFile(paths.stateFile, JSON.stringify(metadata, null, 2), 'utf8');

    return new FileStateStore(paths, metadata, shouldStartWithResume, options.now);
  }

  readonly paths: RunPaths;
  metadata: RunMetadata;
  readonly shouldStartWithResume: boolean;

  private readonly now: () => Date;

  private constructor(
    paths: RunPaths,
    metadata: RunMetadata,
    shouldStartWithResume: boolean,
    now: () => Date
  ) {
    this.paths = paths;
    this.metadata = metadata;
    this.shouldStartWithResume = shouldStartWithResume;
    this.now = now;
  }

  async readLastMessage(): Promise<string | null> {
    try {
      return await readFile(this.paths.lastMessageFile, 'utf8');
    } catch (error) {
      if (isFileMissingError(error)) {
        return null;
      }

      throw error;
    }
  }

  async snapshotLastMessage(attempt: number): Promise<void> {
    try {
      const snapshotPath = join(
        this.paths.attemptsDir,
        `attempt-${attempt.toString().padStart(4, '0')}.last.txt`
      );

      await copyFile(this.paths.lastMessageFile, snapshotPath);
    } catch (error) {
      if (!isFileMissingError(error)) {
        throw error;
      }
    }
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
    const updatedAt = this.now().toISOString();
    const nextMetadata: RunMetadata = {
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

    this.metadata = nextMetadata;
    await writeFile(
      this.paths.stateFile,
      JSON.stringify(this.metadata, null, 2),
      'utf8'
    );
  }

  async recordGoalLedger(goalLedger: GoalLedgerSnapshot): Promise<void> {
    this.metadata = {
      ...this.metadata,
      updatedAt: this.now().toISOString(),
      goalLedger: {
        ...goalLedger,
        updatedAt: goalLedger.updatedAt ?? this.now().toISOString()
      }
    };

    await writeFile(
      this.paths.stateFile,
      JSON.stringify(this.metadata, null, 2),
      'utf8'
    );
  }

  async appendRunnerLog(message: string): Promise<void> {
    const line = `[${this.now().toISOString()}] ${message}\n`;
    await appendFile(this.paths.runnerLogFile, line, 'utf8');
  }
}

function buildPaths(stateDir: string): RunPaths {
  return {
    stateDir,
    stateFile: join(stateDir, 'state.json'),
    eventLogFile: join(stateDir, 'events.jsonl'),
    runnerLogFile: join(stateDir, 'runner.log'),
    originalPromptFile: join(stateDir, 'original-prompt.txt'),
    lastMessageFile: join(stateDir, 'last-message.txt'),
    initialPromptFile: join(stateDir, 'initial-prompt.txt'),
    resumePromptFile: join(stateDir, 'resume-prompt.txt'),
    attemptsDir: join(stateDir, 'attempts')
  };
}

async function loadExistingMetadata(
  stateFile: string
): Promise<RunMetadata | null> {
  try {
    await stat(stateFile);
  } catch (error) {
    if (isFileMissingError(error)) {
      return null;
    }

    throw error;
  }

  const content = await readFile(stateFile, 'utf8');
  return JSON.parse(content) as RunMetadata;
}

function createNewMetadata(input: {
  workdir: string;
  stateDir: string;
  promptSha256: string;
  protocol: CompletionProtocol;
  nowIso: string;
}): RunMetadata {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    workdir: input.workdir,
    stateDir: input.stateDir,
    promptSha256: input.promptSha256,
    nonce: input.protocol.nonce,
    doneToken: input.protocol.doneToken,
    confirmText: input.protocol.confirmText,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    attemptCount: 0,
    goalLedger: {
      ...createEmptyGoalLedger(),
      updatedAt: input.nowIso
    }
  };
}

function rebuildExistingMetadata(
  existing: RunMetadata,
  input: {
    workdir: string;
    promptSha256: string;
    protocol: CompletionProtocol;
    nowIso: string;
  }
): RunMetadata {
  if (existing.promptSha256 !== input.promptSha256) {
    throw new Error('stateDir 中的 prompt 摘要与当前任务不一致，拒绝继续。');
  }

  if (existing.workdir !== input.workdir) {
    throw new Error('stateDir 绑定的 workdir 与当前参数不一致，拒绝继续。');
  }

  if (existing.completedAt !== undefined) {
    throw new Error('该状态目录对应的任务已完成，请使用新的 stateDir。');
  }

  const { failureKind: _legacyFailureKind, ...legacyMetadata } =
    stripLegacyVerificationFields(existing);
  const normalizedFailureKind = normalizeFailureKind(existing.failureKind);

  return {
    ...legacyMetadata,
    schemaVersion: STATE_SCHEMA_VERSION,
    nonce: input.protocol.nonce,
    doneToken: input.protocol.doneToken,
    confirmText: input.protocol.confirmText,
    updatedAt: input.nowIso,
    goalLedger: normalizeGoalLedger(existing.goalLedger, input.nowIso),
    ...(normalizedFailureKind === undefined
      ? {}
      : { failureKind: normalizedFailureKind })
  };
}

function normalizeGoalLedger(
  goalLedger: GoalLedgerSnapshot | undefined,
  nowIso: string
): GoalLedgerSnapshot {
  if (goalLedger === undefined) {
    return {
      ...createEmptyGoalLedger(),
      updatedAt: nowIso
    };
  }

  return {
    ...createEmptyGoalLedger(),
    ...goalLedger,
    updatedAt: goalLedger.updatedAt ?? nowIso
  };
}

function stripLegacyVerificationFields(
  metadata: RunMetadata
): Omit<RunMetadata, 'goalLedger'> & {
  readonly goalLedger?: GoalLedgerSnapshot;
} {
  const clone = { ...metadata } as Record<string, unknown>;

  delete clone.verificationPolicy;
  delete clone.verificationHistory;
  delete clone.lastVerification;

  return clone as Omit<RunMetadata, 'goalLedger'> & {
    readonly goalLedger?: GoalLedgerSnapshot;
  };
}

function normalizeFailureKind(
  failureKind: unknown
): RunMetadata['failureKind'] | undefined {
  if (
    failureKind === 'execution-failed' ||
    failureKind === 'completion-missing' ||
    failureKind === 'completion-review-required'
  ) {
    return failureKind;
  }

  return undefined;
}

function isFileMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
