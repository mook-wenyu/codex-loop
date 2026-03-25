import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ExecaCodexExecutor } from '../../../src/infrastructure/codex/codex-executor.js';
import {
  createFakeCodexHarness,
  type FakeCodexHarness
} from '../../integration/support/fake-codex-harness.js';
import {
  defineFakeCodexScenario,
  incompleteResponse,
  initialStep
} from '../../integration/support/fake-codex-dsl.js';

const activeHarnesses: FakeCodexHarness[] = [];
afterEach(async () => {
  await Promise.all(activeHarnesses.map((harness) => harness.cleanup()));
  activeHarnesses.length = 0;
});

describe('ExecaCodexExecutor', () => {
  it('会把 stdout JSONL 事件透传给观察器并提取 session id', async () => {
    const harness = await registerHarness(
      createFakeCodexHarness(
        defineFakeCodexScenario({
          steps: [
            initialStep(
              incompleteResponse({
                sessionId: '11111111-1111-1111-1111-111111111111',
                lastMessage: '第一轮未完成'
              })
            )
          ]
        })
      )
    );
    const executor = new ExecaCodexExecutor({
      codexBin: 'codex',
      fullAuto: false,
      dangerouslyBypass: true,
      skipGitRepoCheck: true,
      environment: harness.env
    });
    const observedEvents: string[] = [];

    const result = await executor.execute({
      mode: 'initial',
      workdir: harness.repoDir,
      prompt: '继续执行',
      outputLastMessagePath: join(harness.runnerStateDir, 'last-message.txt'),
      eventLogPath: join(harness.runnerStateDir, 'events.jsonl'),
      runnerLogPath: join(harness.runnerStateDir, 'runner.log'),
      onEvent: (event) => {
        observedEvents.push(event.eventType ?? event.rawLine);
      }
    });

    expect(result).toEqual({
      exitCode: 0,
      discoveredSessionId: '11111111-1111-1111-1111-111111111111'
    });
    expect(observedEvents).toContain('session.started');
    await expect(
      readFile(join(harness.runnerStateDir, 'events.jsonl'), 'utf8')
    ).resolves.toContain('session.started');
  });

});

async function registerHarness(
  harnessPromise: Promise<FakeCodexHarness>
): Promise<FakeCodexHarness> {
  const harness = await harnessPromise;
  activeHarnesses.push(harness);

  return harness;
}
