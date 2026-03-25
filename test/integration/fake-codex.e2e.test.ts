import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../../src/cli-app.js';
import { MaxAttemptsExceededError } from '../../src/application/supervisor.js';
import {
  createFakeCodexHarness,
  type FakeCodexHarness
} from './support/fake-codex-harness.js';
import {
  completeFromProtocol,
  defineFakeCodexScenario,
  goalContract,
  incompleteResponse,
  initialStep,
  recordSessionOnly,
  resumeWithLastStep,
  resumeWithSessionStep
} from './support/fake-codex-dsl.js';

const activeHarnesses: FakeCodexHarness[] = [];
const SESSION_ID = '11111111-1111-1111-1111-111111111111';

afterEach(async () => {
  await Promise.all(activeHarnesses.map((harness) => harness.cleanup()));
  activeHarnesses.length = 0;
});

describe('runCli + fake codex integration', () => {
  it(
    '会完成 initial -> resume(sessionId) -> 完成审查 -> 最终确认 的端到端流程，且不覆盖默认 config.toml',
    async () => {
      const harness = await registerHarness(
        createFakeCodexHarness(
          defineFakeCodexScenario({
            goal: goalContract({
              initialPromptIncludes: ['请执行一个多阶段长任务。'],
              resumePromptIncludes: ['Prompt SHA-256']
            }),
            steps: [
              initialStep(
                incompleteResponse({
                  sessionId: SESSION_ID,
                  lastMessage: '第一阶段完成，继续续跑'
                })
              ),
              resumeWithSessionStep(SESSION_ID, completeFromProtocol()),
              resumeWithSessionStep(
                SESSION_ID,
                completeFromProtocol(),
                ['Failure kind: completion-review-required']
              )
            ]
          })
        )
      );

      const exitCode = await runCli(
        [
          harness.promptFile,
          '--workdir',
          harness.repoDir,
          '--state-dir',
          harness.runnerStateDir,
          '--interval-seconds',
          '1',
          '--skip-git-repo-check'
        ],
        harness.env
      );

      const invocations = await harness.readInvocations();
      const state = await harness.readRunnerState();

      expect(exitCode).toBe(0);
      expect(invocations).toHaveLength(3);
      expect(invocations[0]?.mode).toBe('initial');
      expect(invocations[1]?.mode).toBe('resume');
      expect(invocations[2]?.mode).toBe('resume');
      expect(invocations[1]?.sessionId).toBe(SESSION_ID);
      expect(invocations[2]?.sessionId).toBe(SESSION_ID);
      expect(
        invocations.every((invocation) => invocation.hasConfigOverride === false)
      ).toBe(true);
      expect(state.sessionId).toBe(SESSION_ID);
      expect(typeof state.completedAt).toBe('string');
    },
    10_000
  );

  it(
    '在拿不到 sessionId 时会退回 resume --last，并仍然执行完成审查轮次',
    async () => {
      const harness = await registerHarness(
        createFakeCodexHarness(
          defineFakeCodexScenario({
            goal: goalContract({
              resumePromptIncludes: ['Original user request']
            }),
            steps: [
              initialStep(
                recordSessionOnly({
                  recordedSessionId: '22222222-2222-2222-2222-222222222222',
                  lastMessage: '没有 session id，但任务还没结束'
                })
              ),
              resumeWithLastStep(completeFromProtocol()),
              resumeWithLastStep(
                completeFromProtocol(),
                ['Failure kind: completion-review-required']
              )
            ]
          })
        )
      );

      await runCli(
        [
          harness.promptFile,
          '--workdir',
          harness.repoDir,
          '--state-dir',
          harness.runnerStateDir,
          '--interval-seconds',
          '1',
          '--skip-git-repo-check'
        ],
        harness.env
      );

      const invocations = await harness.readInvocations();

      expect(invocations).toHaveLength(3);
      expect(invocations[1]?.usesLast).toBe(true);
      expect(invocations[2]?.usesLast).toBe(true);
      expect(invocations[2]?.prompt).toContain(
        'Failure kind: completion-review-required'
      );
    },
    10_000
  );

  it(
    '会在守护器重启后从 stateDir 恢复并继续完成审查流程',
    async () => {
      const harness = await registerHarness(
        createFakeCodexHarness(
          defineFakeCodexScenario({
            steps: [
              initialStep(
                incompleteResponse({
                  sessionId: SESSION_ID,
                  lastMessage: '第一轮未完成'
                })
              ),
              resumeWithSessionStep(SESSION_ID, completeFromProtocol()),
              resumeWithSessionStep(
                SESSION_ID,
                completeFromProtocol(),
                ['Failure kind: completion-review-required']
              )
            ]
          })
        )
      );

      await expect(
        runCli(
          [
            harness.promptFile,
            '--workdir',
            harness.repoDir,
            '--state-dir',
            harness.runnerStateDir,
            '--max-attempts',
            '1',
            '--interval-seconds',
            '1',
            '--skip-git-repo-check'
          ],
          harness.env
        )
      ).rejects.toBeInstanceOf(MaxAttemptsExceededError);

      const secondRunExitCode = await runCli(
        [
          harness.promptFile,
          '--workdir',
          harness.repoDir,
          '--state-dir',
          harness.runnerStateDir,
          '--interval-seconds',
          '1',
          '--skip-git-repo-check'
        ],
        harness.env
      );

      const invocations = await harness.readInvocations();

      expect(secondRunExitCode).toBe(0);
      expect(invocations).toHaveLength(3);
      expect(invocations[1]?.mode).toBe('resume');
      expect(invocations[2]?.mode).toBe('resume');
      expect(invocations[2]?.prompt).toContain(
        'Failure kind: completion-review-required'
      );
    },
    10_000
  );

  it(
    '当 fake codex 非零退出且未完成时，守护器会继续重试直到通过完成审查',
    async () => {
      const harness = await registerHarness(
        createFakeCodexHarness(
          defineFakeCodexScenario({
            steps: [
              initialStep(
                incompleteResponse({
                  sessionId: SESSION_ID,
                  lastMessage: '第一轮失败但未完成',
                  exitCode: 17
                })
              ),
              resumeWithSessionStep(SESSION_ID, completeFromProtocol()),
              resumeWithSessionStep(
                SESSION_ID,
                completeFromProtocol(),
                ['Failure kind: completion-review-required']
              )
            ]
          })
        )
      );

      const exitCode = await runCli(
        [
          '--prompt-text',
          '直接执行最终目标，不要停在阶段结果。',
          '--workdir',
          harness.repoDir,
          '--state-dir',
          harness.runnerStateDir,
          '--interval-seconds',
          '1'
        ],
        harness.env
      );

      const invocations = await harness.readInvocations();
      const state = await harness.readRunnerState();

      expect(exitCode).toBe(0);
      expect(invocations).toHaveLength(3);
      expect(state.lastExitCode).toBe(0);
      expect(state.failureKind).toBeUndefined();
    },
    10_000
  );

  it(
    '会把上一轮提取出的 Goal Ledger 注入下一轮 resume prompt',
    async () => {
      const harness = await registerHarness(
        createFakeCodexHarness(
          defineFakeCodexScenario({
            steps: [
              initialStep(
                incompleteResponse({
                  sessionId: SESSION_ID,
                  lastMessage: [
                    '已完成：',
                    '- 已补齐完成审查测试',
                    '未完成：',
                    '- 继续收缩 CLI 选项',
                    '阻塞项：',
                    '- README 尚未同步'
                  ].join('\n')
                })
              ),
              resumeWithSessionStep(SESSION_ID, completeFromProtocol()),
              resumeWithSessionStep(
                SESSION_ID,
                completeFromProtocol(),
                [
                  '已补齐完成审查测试',
                  '继续收缩 CLI 选项',
                  'README 尚未同步'
                ]
              )
            ]
          })
        )
      );

      const exitCode = await runCli(
        [
          '--prompt-text',
          '继续完成最终目标，并保持防漂移上下文。',
          '--workdir',
          harness.repoDir,
          '--state-dir',
          harness.runnerStateDir,
          '--interval-seconds',
          '1'
        ],
        harness.env
      );

      const invocations = await harness.readInvocations();
      const state = await harness.readRunnerState();

      expect(exitCode).toBe(0);
      expect(invocations).toHaveLength(3);
      expect(invocations[1]?.prompt).toContain('已补齐完成审查测试');
      expect(invocations[1]?.prompt).toContain('继续收缩 CLI 选项');
      expect(invocations[1]?.prompt).toContain('README 尚未同步');
      expect(state.goalLedger).toEqual(
        expect.objectContaining({
          completedItems: ['已补齐完成审查测试'],
          pendingItems: ['继续收缩 CLI 选项']
        })
      );
      expect(
        (state.goalLedger as {
          blockedItems: string[];
        }).blockedItems
      ).toEqual(
        expect.arrayContaining([
          'README 尚未同步',
          '已触发完成审查轮次，下一轮必须重新核对原始目标与当前状态。'
        ])
      );
    },
    10_000
  );
});

async function registerHarness(
  harnessPromise: Promise<FakeCodexHarness>
): Promise<FakeCodexHarness> {
  const harness = await harnessPromise;
  activeHarnesses.push(harness);

  return harness;
}
