import { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../../src/cli-app.js';
import {
  createFakeCodexHarness,
  type FakeCodexHarness
} from './support/fake-codex-harness.js';
import {
  completeFromProtocol,
  defineFakeCodexScenario,
  incompleteResponse,
  initialStep,
  resumeWithSessionStep
} from './support/fake-codex-dsl.js';

const activeHarnesses: FakeCodexHarness[] = [];
const SESSION_ID = '11111111-1111-1111-1111-111111111111';

afterEach(async () => {
  await Promise.all(activeHarnesses.map((harness) => harness.cleanup()));
  activeHarnesses.length = 0;
});

describe('CLI progress reporter', () => {
  it(
    '会在非 TTY 环境下输出阶段化进度日志',
    async () => {
      const harness = await registerHarness(
        createFakeCodexHarness(
          defineFakeCodexScenario({
            steps: [
              initialStep(
                incompleteResponse({
                  sessionId: SESSION_ID,
                  lastMessage: '第一轮还没完成'
                })
              ),
              resumeWithSessionStep(SESSION_ID, completeFromProtocol()),
              resumeWithSessionStep(SESSION_ID, completeFromProtocol())
            ]
          })
        )
      );
      const stderr = new MemoryCliStream(false);

      const exitCode = await runCli(
        [
          '--prompt-text',
          '继续执行，直到真正完成。',
          '--workdir',
          harness.repoDir,
          '--state-dir',
          harness.runnerStateDir,
          '--interval-seconds',
          '1'
        ],
        harness.env,
        {
          stdout: new MemoryCliStream(false),
          stderr
        }
      );

      expect(exitCode).toBe(0);
      expect(stderr.text()).toContain('状态目录：');
      expect(stderr.text()).toContain('第 1 轮开始（initial）');
      expect(stderr.text()).toContain('等待 1 秒后继续续跑');
      expect(stderr.text()).toContain('第 2 轮开始（resume）');
      expect(stderr.text()).toContain('任务完成：共执行 3 轮');
    },
    10_000
  );
});

class MemoryCliStream extends Writable {
  readonly chunks: string[] = [];
  readonly isTTY: boolean;
  readonly columns = 120;

  constructor(isTTY: boolean) {
    super();
    this.isTTY = isTTY;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(
      typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    );
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

async function registerHarness(
  harnessPromise: Promise<FakeCodexHarness>
): Promise<FakeCodexHarness> {
  const harness = await harnessPromise;
  activeHarnesses.push(harness);

  return harness;
}
