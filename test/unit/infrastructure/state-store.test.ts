import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCompletionProtocol } from '../../../src/domain/completion-protocol.js';
import { createGoalContract } from '../../../src/domain/goal-contract.js';
import { FileStateStore } from '../../../src/infrastructure/state/state-store.js';

const createdDirectories: string[] = [];
const fixedNow = new Date('2026-03-25T07:30:00.000Z');

describe('FileStateStore', () => {
  afterEach(async () => {
    await Promise.all(
      createdDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
    createdDirectories.length = 0;
  });

  it('会为新任务创建结构化状态目录与状态文件', async () => {
    const root = await createTempDirectory();
    const stateDir = join(root, 'state');
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });
    const goalContract = createGoalContract('hello world');

    const store = await FileStateStore.open({
      stateDir,
      workdir: join(root, 'repo'),
      goalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    const stateFile = await readFile(store.paths.stateFile, 'utf8');
    const originalPrompt = await readFile(store.paths.originalPromptFile, 'utf8');
    const initialPrompt = await readFile(store.paths.initialPromptFile, 'utf8');
    const resumePrompt = await readFile(store.paths.resumePromptFile, 'utf8');

    expect(store.shouldStartWithResume).toBe(false);
    expect(store.metadata.doneToken).toBe('ef90-1234-abcd');
    expect(store.metadata.createdAt).toBe(fixedNow.toISOString());
    expect(store.metadata.goalLedger.pendingItems).toEqual([]);
    expect(
      'verificationPolicy' in
        (store.metadata as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(originalPrompt).toBe('hello world');
    expect(initialPrompt).toBe('initial prompt');
    expect(resumePrompt).toBe('resume prompt');
    expect(stateFile).toContain('"schemaVersion": 4');
  });

  it('会在 prompt 摘要不一致时拒绝复用状态目录', async () => {
    const root = await createTempDirectory();
    const stateDir = join(root, 'state');
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });
    const firstGoalContract = createGoalContract('first prompt');

    await FileStateStore.open({
      stateDir,
      workdir: join(root, 'repo'),
      goalContract: firstGoalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    await expect(
      FileStateStore.open({
        stateDir,
        workdir: join(root, 'repo'),
        goalContract: createGoalContract('second prompt'),
        initialPrompt: 'initial prompt',
        resumePrompt: 'resume prompt',
        protocol,
        now: () => fixedNow
      })
    ).rejects.toThrow(/prompt 摘要/i);
  });

  it('会在 workdir 不一致时拒绝复用状态目录', async () => {
    const root = await createTempDirectory();
    const stateDir = join(root, 'state');
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });
    const goalContract = createGoalContract('same prompt');

    await FileStateStore.open({
      stateDir,
      workdir: join(root, 'repo-a'),
      goalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    await expect(
      FileStateStore.open({
        stateDir,
        workdir: join(root, 'repo-b'),
        goalContract,
        initialPrompt: 'initial prompt',
        resumePrompt: 'resume prompt',
        protocol,
        now: () => fixedNow
      })
    ).rejects.toThrow(/workdir/i);
  });

  it('只会在真正完成后拒绝继续；完成审查中的状态仍允许 resume', async () => {
    const root = await createTempDirectory();
    const stateDir = join(root, 'state');
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });
    const goalContract = createGoalContract('same prompt');

    const store = await FileStateStore.open({
      stateDir,
      workdir: join(root, 'repo'),
      goalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    await store.recordAttempt({
      attempt: 1,
      exitCode: 0,
      sessionId: '11111111-1111-1111-1111-111111111111',
      completed: false,
      failureKind: 'completion-review-required'
    });

    const reopened = await FileStateStore.open({
      stateDir,
      workdir: join(root, 'repo'),
      goalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    expect(reopened.shouldStartWithResume).toBe(true);
    expect(reopened.metadata.completedAt).toBeUndefined();
    expect(reopened.metadata.failureKind).toBe('completion-review-required');

    await reopened.recordAttempt({
      attempt: 2,
      exitCode: 0,
      sessionId: null,
      completed: true
    });

    await expect(
      FileStateStore.open({
        stateDir,
        workdir: join(root, 'repo'),
        goalContract,
        initialPrompt: 'initial prompt',
        resumePrompt: 'resume prompt',
        protocol,
        now: () => fixedNow
      })
    ).rejects.toThrow(/已完成/i);
  });

  it('会在已有 sessionId 时以 resume 模式启动，并为快照写入 attempts 目录', async () => {
    const root = await createTempDirectory();
    const stateDir = join(root, 'state');
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });
    const goalContract = createGoalContract('first prompt');

    const store = await FileStateStore.open({
      stateDir,
      workdir: join(root, 'repo'),
      goalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    await store.recordAttempt({
      attempt: 1,
      exitCode: 1,
      sessionId: '11111111-1111-1111-1111-111111111111',
      completed: false
    });
    await writeFile(store.paths.lastMessageFile, 'last message', 'utf8');

    const reopened = await FileStateStore.open({
      stateDir,
      workdir: join(root, 'repo'),
      goalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    await reopened.snapshotLastMessage(1);

    const snapshot = await readFile(
      join(reopened.paths.attemptsDir, 'attempt-0001.last.txt'),
      'utf8'
    );

    expect(reopened.shouldStartWithResume).toBe(true);
    expect(reopened.metadata.sessionId).toBe(
      '11111111-1111-1111-1111-111111111111'
    );
    expect(snapshot).toBe('last message');
  });

  it('在 last message 文件不存在时会返回 null，并支持自动创建临时 stateDir', async () => {
    const root = await createTempDirectory();
    const protocol = createCompletionProtocol({
      nonce: 'abcd-1234-ef90',
      confirmText: 'CONFIRMED: done'
    });
    const goalContract = createGoalContract('prompt');

    const store = await FileStateStore.open({
      workdir: join(root, 'repo'),
      goalContract,
      initialPrompt: 'initial prompt',
      resumePrompt: 'resume prompt',
      protocol,
      now: () => fixedNow
    });

    await expect(store.readLastMessage()).resolves.toBeNull();
    await expect(store.snapshotLastMessage(1)).resolves.toBeUndefined();
    await expect(readFile(store.paths.runnerLogFile, 'utf8')).rejects.toThrow();

    await store.appendRunnerLog('hello');

    await expect(readFile(store.paths.runnerLogFile, 'utf8')).resolves.toContain(
      'hello'
    );
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-loop-'));
  createdDirectories.push(directory);

  return directory;
}
